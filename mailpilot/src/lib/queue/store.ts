import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { CampaignInfo, Fail, JobContext, JobRow, QueueStore, RecipientRow, SenderInfo } from "./types";

const uniq = <T,>(a: T[]) => [...new Set(a)];
const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };

/** Service-role implementation. Every query is scoped by the job's own ids; the lease guard stops a stale worker from overwriting a newer owner. */
export function supabaseStore(db: SupabaseClient = admin()): QueueStore {
  const guarded = (job: JobRow) => (q: any) => q.eq("id", job.id).eq("locked_by", job.locked_by ?? "").eq("status", "processing"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const event = async (job: JobRow, type: string, payload: object | null) => fail("event", (await db.from("sending_events").insert({ user_id: job.user_id, job_id: job.id, type, provider_payload: payload })).error);
  const leave = { locked_at: null, locked_by: null };
  const apply = async (job: JobRow, patch: Record<string, unknown>) => {
    const { data, error } = await guarded(job)(db.from("sending_jobs").update(patch)).select("id");
    fail("job update", error); return (data?.length ?? 0) === 1;
  };

  return {
    async heartbeat(worker) { fail("heartbeat", (await db.from("worker_heartbeats").upsert({ worker, beat_at: new Date().toISOString() })).error); },
    async housekeeping(leaseSeconds) { fail("housekeeping", (await db.rpc("housekeeping", { p_lease_seconds: leaseSeconds })).error); },
    async claim(p) {
      const { data, error } = await db.rpc("claim_send_jobs", { p_worker: p.worker, p_batch: p.batch, p_sender_per_minute: p.senderPerMinute, p_user_per_day: p.userPerDay });
      fail("claim", error); return (data ?? []) as JobRow[];
    },
    async loadContexts(jobs) {
      if (!jobs.length) return [];
      const [r, c] = await Promise.all([
        db.from("campaign_recipients").select("id,email,rendered_subject,rendered_html,rendered_text,unsubscribe_token,erased_at").in("id", uniq(jobs.map((j) => j.recipient_id))),
        db.from("campaigns").select("id,status,is_marketing,sender_id").in("id", uniq(jobs.map((j) => j.campaign_id)))]);
      fail("recipients", r.error); fail("campaigns", c.error);
      const campaigns = new Map((c.data as CampaignInfo[]).map((x) => [x.id, x]));
      const senderIds = uniq((c.data as CampaignInfo[]).map((x) => x.sender_id).filter((x): x is string => !!x));
      const s = senderIds.length ? await db.from("sender_accounts").select("id,user_id,provider,from_address,display_name,reply_to,status,pause_count").in("id", senderIds) : { data: [], error: null };
      fail("senders", s.error);
      const recipients = new Map((r.data as RecipientRow[]).map((x) => [x.id, x]));
      const senders = new Map((s.data as SenderInfo[]).map((x) => [x.id, x]));
      return jobs.map((job): JobContext => {
        const campaign = campaigns.get(job.campaign_id) ?? null;
        const sender = campaign?.sender_id ? senders.get(campaign.sender_id) ?? null : null;
        return { job, recipient: recipients.get(job.recipient_id) ?? null, campaign, sender: sender && sender.user_id === job.user_id ? sender : null };
      });
    },
    async isSuppressed(userId, email) {
      const { count, error } = await db.from("suppressions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("email", email);
      fail("suppression check", error); return (count ?? 0) > 0;
    },
    async markAttempt(job) { return apply(job, { provider_attempted_at: new Date().toISOString() }); },
    async markAccepted(job, r) {
      const ok = await apply(job, { status: "accepted", accepted_at: new Date().toISOString(), provider_message_id: r.messageId, simulated: r.simulated, attempts: job.attempts + 1, last_error: null, last_error_kind: null, ...leave });
      if (!ok) return false;
      await event(job, "accepted", { provider: job.provider, message_id: r.messageId, simulated: r.simulated });
      if (!r.simulated) fail("usage", (await db.rpc("record_sent", { p_user: job.user_id })).error);
      // A delivery webhook may have arrived before this write: apply anything that was waiting for this message id.
      if (job.provider === "resend" && !r.simulated) await db.rpc("apply_pending_events", { p_provider: "resend", p_message_id: r.messageId });
      await db.from("sender_accounts").update({ pause_count: 0, pause_reason: null, paused_until: null }).eq("id", r.senderId).gt("pause_count", 0); // provider is accepting again
      return true;
    },
    async markRetry(job, r) {
      const runAfter = new Date(Date.now() + r.delaySeconds * 1000).toISOString();
      const ok = await apply(job, { status: "pending", attempts: r.attempts, run_after: runAfter, last_error: r.message, last_error_kind: r.kind, provider_attempted_at: null, ...leave });
      if (ok) await event(job, "retry_scheduled", { attempt: r.attempts, delay_seconds: r.delaySeconds, kind: r.kind, message: r.message });
      return ok;
    },
    async markFailed(job, r: Fail) {
      const ok = await apply(job, { status: "failed", attempts: r.attempts, last_error: r.message, last_error_kind: r.kind, ...leave });
      if (ok) await event(job, "failed", { kind: r.kind, message: r.message, attempts: r.attempts });
      return ok;
    },
    async release(job, r) {
      const ok = await apply(job, { status: "pending", run_after: r.runAfter.toISOString(), last_error: r.message, last_error_kind: r.kind, provider_attempted_at: null, ...leave });
      if (ok) await event(job, r.event, { kind: r.kind, message: r.message, ...r.payload });
      return ok;
    },
    async markTerminal(job, status, r) {
      const ok = await apply(job, { status, last_error: r.message, last_error_kind: r.kind, ...leave });
      if (ok) await event(job, status, { kind: r.kind });
      return ok;
    },
    async pauseSender(senderId, reason, baseMinutes) {
      const { data, error } = await db.rpc("pause_sender", { p_sender: senderId, p_reason: reason, p_base_minutes: baseMinutes });
      fail("pause", error); return new Date(data as string);
    },
    async markSenderNeedsReauth(senderId) { fail("reauth", (await db.from("sender_accounts").update({ status: "needs_reauth" }).eq("id", senderId).eq("status", "connected")).error); },
    async refreshCampaigns(ids) { for (const id of uniq(ids)) fail("refresh", (await db.rpc("refresh_campaign_status", { p_campaign: id })).error); },
    async refreshActive() { fail("refresh", (await db.rpc("refresh_active_campaigns")).error); },
  };
}
