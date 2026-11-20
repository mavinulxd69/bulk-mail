"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { DEFAULT_SEND_RATE, MAX_CAMPAIGN_RENDERED_BYTES, SEND_RATE_CHOICES } from "@/lib/limits";
import { queueConfig } from "@/lib/queue/config";
import { audienceDigest } from "@/lib/queue/digest";
import { enqueueMessages } from "@/lib/queue/enqueue";
import { prepareCampaign } from "@/lib/queue/prepare";
import { CAMPAIGN_COLUMNS, checkCampaignReady, type CampaignRow } from "@/lib/queue/ready";
import { runTick } from "@/lib/queue/worker";

const uuid = z.string().uuid();
async function me() { const sb = await createClient(); const { data: { user } } = await sb.auth.getUser(); if (!user) redirect("/login"); return { sb, user }; }
const page = (id: string) => `/dashboard/campaigns/${id}`;
const go = (id: string, k: "notice" | "error", m: string): never => redirect(`${page(id)}?${k}=${encodeURIComponent(m)}`);
const audit = (user_id: string, action: string, detail: object) => admin().from("audit_logs").insert({ user_id, action, detail });
async function load(sb: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await sb.from("campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle();
  return data as CampaignRow | null;
}

/** Draft -> Awaiting approval. Freezes the content: from here on the browser can no longer edit it, so what is reviewed is what is sent. */
export async function requestApproval(fd: FormData) {
  const { sb, user } = await me();
  const id = uuid.safeParse(fd.get("id")); if (!id.success) return redirect("/dashboard/campaigns");
  const c = await load(sb, id.data);
  if (!c) return redirect("/dashboard/campaigns");
  if (c.status !== "draft") return go(c.id, "error", "Only drafts can be sent for review.");
  const ready = await checkCampaignReady(sb, user, c);
  if (!ready.ok) return go(c.id, "error", ready.message);
  const { data, error } = await admin().from("campaigns").update({ status: "awaiting_approval" }).eq("id", c.id).eq("user_id", user.id).eq("status", "draft").select("id");
  if (error || !data?.length) return go(c.id, "error", "Could not move the campaign to review. Try again.");
  await audit(user.id, "campaign.review_requested", { campaign_id: c.id });
  revalidatePath(page(c.id));
  return go(c.id, "notice", "Review the details below. Nothing is sent until you confirm.");
}

export async function backToDraft(fd: FormData) {
  const { user } = await me();
  const id = uuid.safeParse(fd.get("id")); if (!id.success) return redirect("/dashboard/campaigns");
  const { data } = await admin().from("campaigns").update({ status: "draft" }).eq("id", id.data).eq("user_id", user.id).eq("status", "awaiting_approval").is("queue_started_at", null).select("id");
  if (!data?.length) return go(id.data, "error", "This campaign can't go back to draft any more.");
  revalidatePath(page(id.data));
  return redirect(`/dashboard/compose?campaign=${id.data}`);
}

/**
 * The explicit confirmation. Re-checks everything on the server, renders every message for its own recipient, writes recipients and jobs,
 * and only then flips the campaign to "queued" in one atomic step. Any failure rolls back to a reviewable state and nothing is sent.
 */
export async function confirmCampaign(fd: FormData) {
  const { sb, user } = await me();
  const p = z.object({ id: uuid, digest: z.string().regex(/^[a-f0-9]{64}$/), rate: z.coerce.number().int() })
    .safeParse({ id: fd.get("id"), digest: fd.get("digest"), rate: fd.get("rate") ?? DEFAULT_SEND_RATE });
  if (!p.success) return redirect("/dashboard/campaigns");
  const id = p.data.id;
  if (fd.get("confirm") !== "on") return go(id, "error", "Tick the confirmation box to start sending.");
  if (!(SEND_RATE_CHOICES as readonly number[]).includes(p.data.rate)) return go(id, "error", "Choose a sending speed from the list.");
  const skipBlocked = fd.get("skip_blocked") === "on", includeUnconsented = fd.get("include_unconsented") === "on";

  const c = await load(sb, id);
  if (!c) return redirect("/dashboard/campaigns");
  if (c.status !== "awaiting_approval" || c.queue_started_at) return go(id, "error", "This campaign is no longer waiting for approval.");
  const ready = await checkCampaignReady(sb, user, c);
  if (!ready.ok) return go(id, "error", ready.message);
  const { contacts, audience } = ready.audience;
  if (audienceDigest(contacts) !== p.data.digest) return go(id, "error", "Your contacts changed since you opened this review. Check the numbers again, then confirm.");

  const inAudience = new Set(audience.map((x) => x.id));
  const prepared = prepareCampaign({
    template: ready.template, contacts, includeUnconsented, siteUrl: ready.site,
    suppressedEmails: new Set(contacts.filter((x) => !inAudience.has(x.id)).map((x) => x.email)),
  });
  if (prepared.templateErrors.length) return go(id, "error", `Fix the message first: ${prepared.templateErrors.slice(0, 3).join(" ")}`);
  if (prepared.blocked.length && !skipBlocked)
    return go(id, "error", `${prepared.blocked.length} recipient${prepared.blocked.length === 1 ? "" : "s"} can't be personalized completely (${prepared.blocked[0]!.reason}). Fix their data, or tick "Skip recipients with missing data".`);
  if (!prepared.messages.length) return go(id, "error", "Nobody would receive this campaign after the checks. Nothing was queued.");
  if (prepared.totalBytes > MAX_CAMPAIGN_RENDERED_BYTES) return go(id, "error", "This campaign's messages are too large to queue at once. Split the audience.");

  const db = admin(), cfg = queueConfig();
  const { data: began, error: beginErr } = await db.rpc("begin_queueing", { p_campaign: id, p_user: user.id });
  if (beginErr || !began) return go(id, "error", "This campaign is already being approved. Refresh the page.");

  const rollback = async () => { try { await db.rpc("rollback_queueing", { p_campaign: id, p_user: user.id }); } catch { /* the worker's housekeeping reverts it later */ } };
  let jobCount = 0;
  try {
    jobCount = await enqueueMessages(db, { userId: user.id, campaignId: id, messages: prepared.messages, suppressed: prepared.suppressed, provider: ready.sender.provider, maxAttempts: cfg.maxAttempts });
    const skippedCount = prepared.blocked.length + prepared.unconsented.length;
    const u = await db.from("campaigns").update({ send_rate_per_minute: p.data.rate, skipped_count: skippedCount }).eq("id", id).eq("user_id", user.id).eq("status", "awaiting_approval");
    if (u.error) throw new Error(u.error.message);
    const { data: activated, error: actErr } = await db.rpc("activate_campaign", { p_campaign: id, p_user: user.id, p_expected: jobCount });
    if (actErr || !activated) throw new Error("activation refused");
  } catch (e) {
    console.error("[campaign] queueing failed, rolled back", id, e instanceof Error ? e.message : e);
    await rollback();
    return go(id, "error", "Could not queue the campaign. Nothing was sent and nothing was changed; you can try again.");
  }

  await audit(user.id, "campaign.approved", {
    campaign_id: id, recipients: prepared.messages.length, suppressed: prepared.suppressed.length, skipped_missing_data: prepared.blocked.length,
    skipped_no_consent: prepared.unconsented.length, included_without_consent: includeUnconsented ? contacts.filter((x) => !x.consented_at && inAudience.has(x.id)).length : 0, rate_per_minute: p.data.rate,
  });
  after(async () => { try { await runTick({ budgetMs: 20_000 }); } catch (e) { console.error("[worker] kick failed", e instanceof Error ? e.message : e); } }); // best effort; cron/worker would pick it up anyway
  revalidatePath(page(id)); revalidatePath("/dashboard/campaigns");
  return go(id, "notice", "Approved. Sending has started.");
}

export async function cancelCampaign(fd: FormData) {
  const { user } = await me();
  const id = uuid.safeParse(fd.get("id")); if (!id.success) return redirect("/dashboard/campaigns");
  const { data, error } = await admin().rpc("cancel_campaign", { p_campaign: id.data, p_user: user.id });
  if (error || data === null) return go(id.data, "error", "This campaign can't be cancelled (it may already be finished).");
  await audit(user.id, "campaign.cancelled", { campaign_id: id.data, unsent_cancelled: data });
  revalidatePath(page(id.data));
  return go(id.data, "notice", `Cancelled. ${data} unsent message${data === 1 ? "" : "s"} will not go out. Messages already handed to the provider can't be recalled.`);
}
