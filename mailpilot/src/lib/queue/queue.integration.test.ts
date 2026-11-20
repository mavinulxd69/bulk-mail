// Integration test: the REAL approval pipeline, queue store, worker and unsubscribe/webhook functions against PostgREST + Postgres with
// row-level security on. Only the email provider is a fake. Skipped unless PGRST_URL and PGRST_JWT_SECRET are set (README "Testing").
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAudience } from "@/lib/compose/audience";
import { ProviderError, type EmailProvider, type SendInput } from "@/lib/providers/types";
import { queueConfig } from "./config";
import { audienceDigest } from "./digest";
import { enqueueMessages } from "./enqueue";
import { prepareCampaign } from "./prepare";
import { CAMPAIGN_COLUMNS, checkCampaignReady, type CampaignRow } from "./ready";
import { supabaseStore } from "./store";
import { runTick } from "./worker";

const URL_ = process.env.PGRST_URL, SECRET = process.env.PGRST_JWT_SECRET;
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => { const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}`; return `${h}.${createHmac("sha256", SECRET!).update(h).digest("base64url")}`; };
const client = (claims: object) => new PostgrestClient(URL_!, { headers: { Authorization: `Bearer ${jwt(claims)}` } }) as unknown as SupabaseClient;

describe.skipIf(!URL_ || !SECRET)("sending queue against a real database", () => {
  const a = URL_ ? client({ role: "authenticated", sub: A }) : (null as never);
  const b = URL_ ? client({ role: "authenticated", sub: B }) : (null as never);
  const svc = URL_ ? client({ role: "service_role" }) : (null as never);
  const store = () => supabaseStore(svc);
  const SENDER = "00000000-0000-0000-0000-0000000000a1", SENDER_2 = "00000000-0000-0000-0000-0000000000a2", SENDER_B = "00000000-0000-0000-0000-0000000000b1";
  const user = { email: "a@test.dev", email_confirmed_at: "2026-01-01" };
  let sent: SendInput[]; let calls: Map<string, number>;
  const provider = (behave?: (i: SendInput, n: number) => void): EmailProvider => ({ id: "gmail", async send(i) {
    const n = (calls.get(i.to) ?? 0) + 1; calls.set(i.to, n); behave?.(i, n); sent.push(i);
    return { status: "accepted", providerMessageId: `gm_${i.idempotencyKey}` };
  } });
  const tick = (p: EmailProvider, over: Partial<ReturnType<typeof queueConfig>> = {}) => runTick({ store: store(), config: { ...queueConfig(), retryBaseSeconds: 1, ...over }, deps: { providerFor: () => p, siteUrl: "https://app.test" }, budgetMs: 8000, worker: "it" });

  const must = async <T extends { error: { message: string } | null }>(q: PromiseLike<T>): Promise<T> => { const r = await q; if (r.error) throw new Error(r.error.message); return r; };
  const wipe = async () => {
    for (const u of [A, B]) { await svc.from("campaigns").delete().eq("user_id", u); await svc.from("contacts").delete().eq("user_id", u); await svc.from("suppressions").delete().eq("user_id", u); await svc.from("sender_accounts").delete().eq("user_id", u); await svc.from("sender_domains").delete().eq("user_id", u); await svc.from("audit_logs").delete().eq("user_id", u); await svc.from("usage_counters").delete().eq("user_id", u); }
    await svc.from("provider_events").delete().neq("provider", "x");
  };
  const seedSender = async (provider: "gmail" | "resend" = "gmail", extra: object = {}) => { if (provider === "resend") await must(svc.from("sender_domains").upsert({ user_id: A, domain: "a.test", status: "verified" }, { onConflict: "user_id,domain" })); await must(svc.from("sender_accounts").insert({ id: SENDER, user_id: A, provider, from_address: "me@a.test", display_name: "Me", status: "connected", daily_quota: 1000, ...extra })); };
  const contact = (email: string, name: string, fields: object = { boarding_code: "BD-" + name }, consented = true) => ({ user_id: A, email, name, fields, consent_source: "it", consented_at: consented ? new Date().toISOString() : null });
  const draft = async (over: object = {}) => {
    const { data, error } = await a.from("campaigns").insert({ user_id: A, name: "Flight", sender_id: SENDER, subject: "Your Boarding Confirmation - {{name}}", html_body: "<p>Hello {{name}}, code {{boarding_code}}. <a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>", text_body: "Hello {{name}} {{boarding_code}} {{unsubscribe_url}}", is_marketing: true, ...over }).select("id").single();
    expect(error).toBeNull(); return data!.id as string;
  };
  // Mirrors the approval action step by step, using the real checks, preparation and enqueue code.
  async function approve(id: string, o: { skipBlocked?: boolean; includeUnconsented?: boolean; rate?: number } = {}) {
    expect((await svc.from("campaigns").update({ status: "awaiting_approval" }).eq("id", id).eq("status", "draft").select("id")).data).toHaveLength(1);
    const c = (await a.from("campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).single()).data as CampaignRow;
    const ready = await checkCampaignReady(a, user, c);
    if (!ready.ok) throw new Error("not ready: " + ready.message);
    const inAud = new Set(ready.audience.audience.map((x) => x.id));
    const prepared = prepareCampaign({ template: ready.template, contacts: ready.audience.contacts, includeUnconsented: !!o.includeUnconsented, siteUrl: ready.site, suppressedEmails: new Set(ready.audience.contacts.filter((x) => !inAud.has(x.id)).map((x) => x.email)) });
    if (prepared.blocked.length && !o.skipBlocked) throw new Error("blocked");
    expect((await svc.rpc("begin_queueing", { p_campaign: id, p_user: A, p_requested: prepared.messages.length })).data).toBe(true);
    const n = await enqueueMessages(svc, { userId: A, campaignId: id, messages: prepared.messages, suppressed: prepared.suppressed, provider: ready.sender.provider, maxAttempts: 3 });
    await svc.from("campaigns").update({ send_rate_per_minute: o.rate ?? 120, skipped_count: prepared.blocked.length + prepared.unconsented.length }).eq("id", id);
    expect((await svc.rpc("activate_campaign", { p_campaign: id, p_user: A, p_expected: n })).data).toBe(true);
    return { prepared, ready, digest: audienceDigest(ready.audience.contacts) };
  }
  const jobs = async (id: string) => ((await svc.from("sending_jobs").select("status,attempts,last_error,last_error_kind,campaign_recipients(email)").eq("campaign_id", id)).data ?? []) as unknown as { status: string; attempts: number; last_error: string | null; last_error_kind: string | null; campaign_recipients: { email: string } }[];
  const statusOf = async (id: string) => (await svc.from("campaigns").select("status").eq("id", id).single()).data!.status as string;

  beforeAll(wipe); afterAll(wipe);
  beforeEach(async () => { await wipe(); sent = []; calls = new Map(); await must(svc.from("contacts").insert([contact("alex@gmail.com", "Alex"), contact("john@gmail.com", "John"), contact("david@gmail.com", "David")])); });

  it("a user cannot approve, queue or alter lifecycle fields through the API", async () => {
    await seedSender(); const id = await draft();
    expect((await a.from("campaigns").update({ status: "queued" }).eq("id", id).select("id")).error).not.toBeNull();
    expect((await a.from("campaigns").update({ send_rate_per_minute: 120 }).eq("id", id).select("id")).error).not.toBeNull();
    expect((await a.rpc("claim_send_jobs", { p_worker: "x", p_batch: 1, p_sender_per_minute: 1, p_user_per_day: 1 })).error).not.toBeNull();
    expect((await a.rpc("cancel_campaign", { p_campaign: id, p_user: A })).error).not.toBeNull();
  });

  it("sends each recipient exactly one personalized email, only to them, and tracks honest statuses", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    expect(await statusOf(id)).toBe("queued");
    const r = await tick(provider());
    expect(r.claimed).toBe(3); expect(r.outcomes.accepted).toBe(3);
    expect(sent.map((s) => s.to).sort()).toEqual(["alex@gmail.com", "david@gmail.com", "john@gmail.com"]);
    const alex = sent.find((s) => s.to === "alex@gmail.com")!;
    expect(alex.subject).toBe("Your Boarding Confirmation - Alex"); expect(alex.html).toContain("BD-Alex"); expect(alex.html).not.toContain("BD-John");
    expect(JSON.stringify(sent.filter((s) => s.to !== "john@gmail.com"))).not.toContain("john@gmail.com"); // nobody else's address appears anywhere
    expect(alex.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.test\/api\/unsubscribe\/[A-Za-z0-9_-]{43}>$/); expect(alex.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(new Set(sent.map((s) => s.idempotencyKey)).size).toBe(3);
    expect((await jobs(id)).every((j) => j.status === "accepted" && j.attempts === 1)).toBe(true); // accepted, NOT delivered
    expect(await statusOf(id)).toBe("completed");
    expect((await tick(provider())).claimed).toBe(0); expect(sent).toHaveLength(3); // a second run sends nothing more
    const stats = (await a.from("campaign_stats").select("*").eq("campaign_id", id).single()).data!;
    expect(stats).toMatchObject({ total: 3, accepted: 3, delivered: 0, pending: 0, failed: 0 });
    expect((await svc.from("usage_counters").select("sent").eq("user_id", A)).data![0]!.sent).toBe(3);
  });

  it("two workers running at once never send anyone twice", async () => {
    await seedSender(); await must(svc.from("contacts").insert(Array.from({ length: 40 }, (_, i) => contact(`bulk${i}@x.dev`, `B${i}`))));
    const id = await draft(); await approve(id);
    const p = provider(); await Promise.all([tick(p), tick(p), tick(p)]);
    expect(sent).toHaveLength(43); for (const n of calls.values()) expect(n).toBe(1);
    expect(await statusOf(id)).toBe("completed");
  });

  it("shares the rolling daily cap across a user's sender accounts during concurrent claims", async () => {
    await seedSender();
    await must(svc.from("sender_accounts").insert({ id: SENDER_2, user_id: A, provider: "gmail", from_address: "second@a.test", display_name: "Second", status: "connected", daily_quota: 1000 }));
    const first = await draft();
    const second = await draft({ sender_id: SENDER_2 });
    await approve(first);
    await approve(second);
    const config = { ...queueConfig(), userPerDay: 1, batchSize: 1 };
    const one = tick(provider(), config);
    const two = tick(provider(), config);
    await Promise.all([one, two]);
    const { count, error } = await svc.from("sending_jobs").select("id", { count: "exact", head: true }).eq("user_id", A).in("status", ["accepted", "delivered"]);
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  it("applies the per-campaign rate limit", async () => {
    await seedSender(); await must(svc.from("contacts").insert(Array.from({ length: 20 }, (_, i) => contact(`rate${i}@x.dev`, `R${i}`))));
    const id = await draft(); await approve(id, { rate: 5 });
    await tick(provider()); expect(sent).toHaveLength(5); expect(await statusOf(id)).toBe("sending");
    await tick(provider()); expect(sent).toHaveLength(5); // still inside the minute
  });

  it("never sends a half-personalized message: missing data blocks approval unless the user explicitly skips those people", async () => {
    await seedSender(); await must(svc.from("contacts").insert(contact("nocode@x.dev", "Nina", {})));
    const id = await draft();
    await expect(approve(id)).rejects.toThrow("blocked");
    await svc.from("campaigns").update({ status: "draft" }).eq("id", id);
    const { prepared } = await approve(id, { skipBlocked: true });
    expect(prepared.blocked).toHaveLength(1);
    await tick(provider()); expect(sent.map((s) => s.to)).not.toContain("nocode@x.dev"); expect(sent).toHaveLength(3);
    expect((await svc.from("campaigns").select("skipped_count").eq("id", id).single()).data!.skipped_count).toBe(1);
  });

  it("excludes suppressed contacts (recorded as suppressed) and consent-less contacts unless opted in", async () => {
    await seedSender();
    await must(svc.from("contacts").insert(contact("unsub@x.dev", "Una")));
    await must(svc.rpc("it_legacy_contact", { p_user: A, p_email: "old@x.dev", p_name: "Old", p_fields: { boarding_code: "BD-Old" } }));
    await must(svc.from("suppressions").insert({ user_id: A, email: "unsub@x.dev", reason: "unsubscribe" }));
    const id = await draft(); await approve(id); await tick(provider());
    expect(sent.map((s) => s.to).sort()).toEqual(["alex@gmail.com", "david@gmail.com", "john@gmail.com"]);
    expect((await jobs(id)).find((j) => j.campaign_recipients.email === "unsub@x.dev")!.status).toBe("suppressed");
    const id2 = await draft({ name: "Second" }); sent = []; await svc.from("suppressions").delete().eq("user_id", A);
    await approve(id2, { includeUnconsented: true }); await tick(provider()); expect(sent.map((s) => s.to)).toContain("old@x.dev");
  });

  it("an unsubscribe after approval stops the message before it is sent, in the same sender's other campaigns too", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    const tok = (await svc.from("campaign_recipients").select("unsubscribe_token").eq("campaign_id", id).eq("email", "john@gmail.com").single()).data!.unsubscribe_token;
    expect((await svc.rpc("apply_unsubscribe", { p_token: tok })).data).toBe("john@gmail.com");
    await tick(provider());
    expect(sent.map((s) => s.to).sort()).toEqual(["alex@gmail.com", "david@gmail.com"]);
    expect((await jobs(id)).find((j) => j.campaign_recipients.email === "john@gmail.com")!.status).toBe("suppressed");
    expect((await a.from("suppressions").select("email,reason").eq("email", "john@gmail.com")).data).toEqual([{ email: "john@gmail.com", reason: "unsubscribe" }]);
    expect(await statusOf(id)).toBe("completed");
  });

  it("temporary failures are retried with backoff and then succeed; the attempt count is recorded", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    const flaky = provider((i, n) => { if (i.to === "alex@gmail.com" && n === 1) throw new ProviderError("temporary", "Gmail 503"); });
    let r = await tick(flaky); expect(r.outcomes.retry).toBe(1);
    expect(await statusOf(id)).toBe("sending");
    const alexJob = (await jobs(id)).find((j) => j.campaign_recipients.email === "alex@gmail.com")!; expect(alexJob).toMatchObject({ status: "pending", attempts: 1, last_error_kind: "temporary" });
    await svc.from("sending_jobs").update({ run_after: new Date(Date.now() - 1000).toISOString() }).eq("campaign_id", id).eq("status", "pending");
    r = await tick(flaky); expect(r.outcomes.accepted).toBe(1);
    expect(calls.get("alex@gmail.com")).toBe(2); expect(calls.get("john@gmail.com")).toBe(1);
    expect(await statusOf(id)).toBe("completed");
    const ev = (await svc.from("sending_events").select("type").eq("user_id", A)).data!.map((e) => e.type);
    expect(ev).toContain("retry_scheduled"); expect(ev.filter((t) => t === "accepted")).toHaveLength(3);
  });

  it("stops retrying after the maximum and marks the campaign partially failed", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    const bad = provider((i) => { if (i.to === "david@gmail.com") throw new ProviderError("temporary", "Gmail 503"); });
    for (let k = 0; k < 4; k++) { await svc.from("sending_jobs").update({ run_after: new Date(Date.now() - 1000).toISOString() }).eq("campaign_id", id).eq("status", "pending"); await tick(bad); }
    const d = (await jobs(id)).find((j) => j.campaign_recipients.email === "david@gmail.com")!;
    expect(d).toMatchObject({ status: "failed", attempts: 3 }); expect(d.last_error).toContain("Gave up");
    expect(calls.get("david@gmail.com")).toBe(3);
    expect(await statusOf(id)).toBe("partially_failed");
  });

  it("a provider quota error pauses the sender, keeps every message, and resumes afterwards without losing or duplicating any", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    let limited = true;
    const p = provider(() => { if (limited) throw new ProviderError("quota", "Gmail quota reached"); });
    await tick(p, { concurrency: 1, batchSize: 1 });
    const s1 = (await svc.from("sender_accounts").select("paused_until,pause_count,pause_reason").eq("id", SENDER).single()).data!;
    expect(s1.pause_count).toBe(1); expect(s1.pause_reason).toBe("quota"); expect(new Date(s1.paused_until!).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(sent).toHaveLength(0); expect((await jobs(id)).every((j) => j.status === "pending")).toBe(true);
    expect((await jobs(id)).some((j) => j.attempts > 0)).toBe(false); // no attempts burned
    const before = calls.size; await tick(p); expect(calls.size).toBe(before); // paused: nothing is tried
    limited = false; await svc.from("sender_accounts").update({ paused_until: new Date(Date.now() - 1000).toISOString() }).eq("id", SENDER);
    await svc.from("sending_jobs").update({ run_after: new Date(Date.now() - 1000).toISOString() }).eq("campaign_id", id);
    await tick(p); expect(sent.map((s) => s.to).sort()).toEqual(["alex@gmail.com", "david@gmail.com", "john@gmail.com"]);
    expect((await svc.from("sender_accounts").select("pause_count").eq("id", SENDER).single()).data!.pause_count).toBe(0);
  });

  it("Gmail timeouts are not retried (could duplicate); Resend timeouts are (idempotency key)", async () => {
    await seedSender("gmail"); const id = await draft(); await approve(id);
    await tick(provider((i) => { if (i.to === "alex@gmail.com") throw new ProviderError("unknown", "no answer"); }));
    const g = (await jobs(id)).find((j) => j.campaign_recipients.email === "alex@gmail.com")!; expect(g).toMatchObject({ status: "failed", last_error_kind: "unknown_outcome" });
    await svc.from("campaigns").delete().eq("id", id); await svc.from("sender_accounts").delete().eq("id", SENDER);
    calls = new Map(); sent = [];
    await seedSender("resend"); const id2 = await draft({ name: "R" }); await approve(id2);
    await tick(provider((i, n) => { if (i.to === "alex@gmail.com" && n === 1) throw new ProviderError("unknown", "no answer"); }));
    expect((await jobs(id2)).find((j) => j.campaign_recipients.email === "alex@gmail.com")).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("recovers from a crashed worker: not-yet-attempted jobs go again, attempted Gmail jobs are failed instead of re-sent", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    const ids = (await svc.from("sending_jobs").select("id").eq("campaign_id", id).order("id")).data!.map((j) => j.id);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await svc.from("sending_jobs").update({ status: "processing", locked_by: "dead", locked_at: old }).eq("id", ids[0]);
    await svc.from("sending_jobs").update({ status: "processing", locked_by: "dead", locked_at: old, provider_attempted_at: old }).eq("id", ids[1]);
    await tick(provider());
    const js = await svc.from("sending_jobs").select("id,status,last_error_kind").eq("campaign_id", id);
    expect(js.data!.find((j) => j.id === ids[1])).toMatchObject({ status: "failed", last_error_kind: "unknown_outcome" });
    expect(js.data!.find((j) => j.id === ids[0])!.status).toBe("accepted");
    expect(sent).toHaveLength(2); // the maybe-sent one was NOT re-sent
  });

  it("cancel stops everything not yet handed to the provider", async () => {
    await seedSender(); const id = await draft(); await approve(id, { rate: 5 }); await svc.from("campaigns").update({ send_rate_per_minute: 1 }).eq("id", id);
    await tick(provider()); expect(sent).toHaveLength(1);
    expect((await svc.rpc("cancel_campaign", { p_campaign: id, p_user: A })).data).toBe(2);
    await svc.from("sending_jobs").update({ last_attempt_at: new Date(Date.now() - 3600_000).toISOString() }).eq("campaign_id", id);
    await tick(provider()); expect(sent).toHaveLength(1); expect(await statusOf(id)).toBe("cancelled");
    expect((await jobs(id)).filter((j) => j.status === "cancelled")).toHaveLength(2);
  });

  it("deleting a contact before its message goes out cancels it and erases the stored copy", async () => {
    await seedSender(); const id = await draft(); await approve(id);
    const cid = (await svc.from("contacts").select("id").eq("email", "david@gmail.com").single()).data!.id;
    expect((await a.from("contacts").delete().eq("id", cid).select("id")).data).toHaveLength(1);
    await tick(provider()); expect(sent.map((s) => s.to)).not.toContain("david@gmail.com");
    const rec = (await svc.from("campaign_recipients").select("email,rendered_html,erased_at").eq("campaign_id", id).is("contact_id", null)).data!;
    expect(rec).toHaveLength(1); expect(rec[0]).toMatchObject({ email: null, rendered_html: null }); expect(rec[0]!.erased_at).toBeTruthy();
    expect((await jobs(id)).filter((j) => j.status === "cancelled")).toHaveLength(1);
  });

  it("webhook events: delivered / bounced are applied only when the provider says so, including events that arrive early", async () => {
    await seedSender("resend"); const id = await draft(); await approve(id);
    await tick({ id: "gmail", async send(i) { return { status: "accepted", providerMessageId: `re_${i.to}` }; } });
    expect((await jobs(id)).every((j) => j.status === "accepted")).toBe(true);
    const ins = async (eid: string, mid: string, type: string, payload: object = {}) => { const r = await svc.from("provider_events").insert({ provider: "resend", provider_event_id: eid, provider_message_id: mid, type, payload }).select("id").single(); return (await svc.rpc("apply_provider_event", { p_event: r.data!.id })).data; };
    expect(await ins("e1", "re_alex@gmail.com", "email.delivered")).toBe("delivered");
    expect(await ins("e2", "re_john@gmail.com", "email.bounced", { data: { bounce: { type: "Permanent", message: "no such user" } } })).toBe("bounced");
    expect(await ins("e3", "re_unknown", "email.delivered")).toBe("no_job");
    const byEmail = Object.fromEntries((await jobs(id)).map((j) => [j.campaign_recipients.email, j.status]));
    expect(byEmail).toMatchObject({ "alex@gmail.com": "delivered", "john@gmail.com": "bounced", "david@gmail.com": "accepted" });
    expect((await a.from("suppressions").select("email,reason").eq("email", "john@gmail.com")).data).toEqual([{ email: "john@gmail.com", reason: "bounce" }]);
    expect(await statusOf(id)).toBe("partially_failed");
  });

  it("the exact queries the campaign, activity and overview pages run work with RLS and are tenant-isolated", async () => {
    await seedSender(); const id = await draft(); await approve(id); await tick(provider());
    const list = await a.from("sending_jobs").select("id,status,attempts,max_attempts,last_error,accepted_at,delivered_at,run_after,simulated,campaign_recipients(email)", { count: "exact" }).eq("campaign_id", id).order("created_at").range(0, 49);
    expect(list.error).toBeNull(); expect(list.count).toBe(3); expect((list.data as unknown as { campaign_recipients: { email: string } }[])[0]!.campaign_recipients.email).toMatch(/@gmail\.com$/);
    const act = await a.from("sending_events").select("id,type,created_at,provider_payload,sending_jobs!inner(status,campaign_id,campaign_recipients(email))").eq("sending_jobs.campaign_id", id).order("created_at", { ascending: false }).limit(100);
    expect(act.error).toBeNull(); expect(act.data!.length).toBeGreaterThanOrEqual(3);
    expect((await a.from("daily_send_stats").select("day,accepted").gte("day", "2000-01-01")).data![0]!.accepted).toBe(3);
    expect((await a.from("sending_jobs").select("id", { count: "exact", head: true }).not("accepted_at", "is", null).eq("simulated", false)).count).toBe(3);
    for (const t of ["sending_jobs", "sending_events", "campaign_recipients", "campaign_stats", "campaigns", "daily_send_stats"]) expect((await b.from(t).select("*")).data, `B sees ${t}`).toEqual([]);
    expect((await a.from("provider_events").select("*")).error).not.toBeNull();
    await svc.from("sender_accounts").insert({ id: SENDER_B, user_id: B, provider: "gmail", from_address: "b@b.test", status: "connected" });
  });
});
