import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContactRow } from "@/lib/contacts/db";
import { ProviderError, type EmailProvider, type SendInput } from "@/lib/providers/types";
import { retryDelaySeconds } from "./backoff";
import { queueConfig, siteUrl } from "./config";
import { audienceDigest } from "./digest";
import { processJob, UNKNOWN_OUTCOME_GMAIL } from "./process";
import { prepareCampaign } from "./prepare";
import type { Fail, JobContext, JobRow, QueueStore, SenderInfo } from "./types";
import { maskEmail, newUnsubscribeToken, oneClickUrl, TOKEN_RE, unsubscribeHeaders, unsubscribeUrl } from "./unsubscribe";
import { parseResendEvent, verifySvix } from "./webhook";

// ---------- in-memory store that records every call in order ----------
function fakeStore(over: Partial<QueueStore> = {}) {
  const calls: string[] = []; const rec: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const s: QueueStore = {
    async heartbeat() {}, async housekeeping() {}, async claim() { return []; }, async loadContexts() { return []; },
    async isSuppressed() { return false; },
    async markAttempt() { calls.push("attempt"); return true; },
    async markAccepted(_j, r) { calls.push("accepted"); rec.accepted = r; return true; },
    async markRetry(_j, r: Fail & { delaySeconds: number }) { calls.push("retry"); rec.retry = r; return true; },
    async markFailed(_j, r) { calls.push("failed"); rec.failed = r; return true; },
    async release(_j, r) { calls.push("release"); rec.release = r; return true; },
    async markTerminal(_j, st, r) { calls.push(st); rec.terminal = r; return true; },
    async pauseSender() { calls.push("pause"); return new Date(Date.now() + 1800_000); },
    async markSenderNeedsReauth() { calls.push("reauth"); },
    async refreshCampaigns() {}, async refreshActive() {}, ...over,
  };
  return { s, calls, rec };
}
const job = (o: Partial<JobRow> = {}): JobRow => ({ id: "j1", user_id: "u1", recipient_id: "r1", campaign_id: "c1", idempotency_key: "mp:j1", status: "processing", attempts: 0, max_attempts: 3, provider: "gmail", locked_by: "w", ...o });
const sender = (o: Partial<SenderInfo> = {}): SenderInfo => ({ id: "s1", user_id: "u1", provider: "gmail", from_address: "me@x.dev", display_name: "Me", reply_to: null, status: "connected", pause_count: 0, ...o });
const ctx = (o: Partial<JobContext> = {}): JobContext => ({
  job: job(), sender: sender(), campaign: { id: "c1", status: "sending", is_marketing: false, sender_id: "s1" },
  recipient: { id: "r1", email: "alex@gmail.com", rendered_subject: "Hi Alex", rendered_html: "<p>Hi Alex</p>", rendered_text: "Hi Alex", unsubscribe_token: "T".repeat(43), erased_at: null }, ...o,
});
const ok: EmailProvider = { id: "gmail", async send() { return { status: "accepted", providerMessageId: "m1" }; } };
const failing = (e: unknown): EmailProvider => ({ id: "gmail", async send() { throw e; } });
const run = (c: JobContext, p: EmailProvider, st: QueueStore, extra = {}) => processJob(c, { store: st, providerFor: () => p, config: queueConfig(), siteUrl: "https://app.example.com", random: () => 0.5, ...extra });

describe("processJob", () => {
  it("stamps the attempt BEFORE calling the provider, then records acceptance", async () => {
    const f = fakeStore(); const order: string[] = [];
    const p: EmailProvider = { id: "gmail", async send() { order.push(`send after: ${f.calls.join(",")}`); return { status: "accepted", providerMessageId: "m1" }; } };
    expect(await run(ctx(), p, f.s)).toBe("accepted");
    expect(order).toEqual(["send after: attempt"]);
    expect(f.calls).toEqual(["attempt", "accepted"]);
    expect(f.rec.accepted).toMatchObject({ messageId: "m1", simulated: false, senderId: "s1" });
  });
  it("passes the stable idempotency key, the recipient's own address and content", async () => {
    let seen: SendInput | undefined; const f = fakeStore();
    await run(ctx(), { id: "gmail", async send(i) { seen = i; return { status: "accepted", providerMessageId: "m" }; } }, f.s);
    expect(seen).toMatchObject({ to: "alex@gmail.com", subject: "Hi Alex", idempotencyKey: "mp:j1", html: "<p>Hi Alex</p>", from: { address: "me@x.dev", name: "Me" } });
    expect(seen?.headers).toBeUndefined(); // not marketing
  });
  it("adds RFC 8058 unsubscribe headers for marketing mail only", async () => {
    let seen: SendInput | undefined; const f = fakeStore();
    const c = ctx({ campaign: { id: "c1", status: "sending", is_marketing: true, sender_id: "s1" } });
    await run(c, { id: "gmail", async send(i) { seen = i; return { status: "accepted", providerMessageId: "m" }; } }, f.s);
    expect(seen?.headers?.["List-Unsubscribe"]).toBe(`<https://app.example.com/api/unsubscribe/${"T".repeat(43)}>`);
    expect(seen?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  it("flags simulated (dev mock) sends so they can never look real", async () => {
    const f = fakeStore();
    await run(ctx(), { id: "mock", async send() { return { status: "accepted", providerMessageId: "mock_1", simulated: true }; } }, f.s);
    expect(f.rec.accepted.simulated).toBe(true);
  });

  it("temporary error -> retry with backoff, attempt consumed", async () => {
    const f = fakeStore();
    expect(await run(ctx(), failing(new ProviderError("temporary", "Gmail 503")), f.s)).toBe("retry");
    expect(f.rec.retry).toMatchObject({ attempts: 1, kind: "temporary", delaySeconds: 30 });
  });
  it("gives up after max_attempts", async () => {
    const f = fakeStore(); const c = ctx({ job: job({ attempts: 2, max_attempts: 3 }) });
    expect(await run(c, failing(new ProviderError("temporary", "Gmail 503")), f.s)).toBe("failed");
    expect(f.rec.failed.message).toContain("Gave up after 3 attempts");
  });
  it("permanent error -> failed at once, no retry", async () => {
    const f = fakeStore();
    expect(await run(ctx(), failing(new ProviderError("permanent", "Gmail 400")), f.s)).toBe("failed");
    expect(f.calls).toEqual(["attempt", "failed"]);
  });
  it("quota error -> pauses the sender and releases the job without using an attempt", async () => {
    const f = fakeStore();
    expect(await run(ctx(), failing(new ProviderError("quota", "Gmail quota reached")), f.s)).toBe("paused");
    expect(f.calls).toEqual(["attempt", "pause", "release"]);
    expect(f.rec.release.kind).toBe("quota");
  });
  it("gmail auth error -> sender flagged for reconnect, job kept, no attempt used", async () => {
    const f = fakeStore();
    expect(await run(ctx(), failing(new ProviderError("auth", "rejected")), f.s)).toBe("released");
    expect(f.calls).toEqual(["attempt", "reauth", "release"]);
  });
  it("resend auth error is a platform problem: pause, do not blame or disconnect the user's sender", async () => {
    const f = fakeStore();
    expect(await run(ctx({ sender: sender({ provider: "resend" }) }), failing(new ProviderError("auth", "bad key")), f.s)).toBe("released");
    expect(f.calls).toEqual(["attempt", "pause", "release"]);
  });
  it("GMAIL unknown outcome (timeout) is NEVER retried: it could duplicate the email", async () => {
    const f = fakeStore();
    expect(await run(ctx(), failing(new ProviderError("unknown", "no answer")), f.s)).toBe("failed");
    expect(f.rec.failed).toMatchObject({ kind: "unknown_outcome", message: UNKNOWN_OUTCOME_GMAIL });
  });
  it("RESEND unknown outcome is retried (same idempotency key makes it safe)", async () => {
    const f = fakeStore();
    expect(await run(ctx({ sender: sender({ provider: "resend" }), job: job({ provider: "resend" }) }), failing(new ProviderError("unknown", "timeout")), f.s)).toBe("retry");
  });
  it("an unexpected exception is treated as unknown, with no internals leaked into the stored message", async () => {
    const f = fakeStore();
    await run(ctx(), failing(new Error("secret internal detail")), f.s);
    expect(JSON.stringify(f.rec)).not.toContain("secret internal detail");
  });

  it("never sends when the campaign was cancelled, the contact erased, or the address suppressed meanwhile", async () => {
    let sent = 0; const p: EmailProvider = { id: "gmail", async send() { sent++; return { status: "accepted", providerMessageId: "m" }; } };
    let f = fakeStore();
    expect(await run(ctx({ campaign: { id: "c1", status: "cancelled", is_marketing: false, sender_id: "s1" } }), p, f.s)).toBe("cancelled");
    f = fakeStore(); const c = ctx(); c.recipient!.erased_at = "2026-01-01"; c.recipient!.email = null;
    expect(await run(c, p, f.s)).toBe("cancelled");
    f = fakeStore({ async isSuppressed() { return true; } });
    expect(await run(ctx(), p, f.s)).toBe("suppressed");
    expect(sent).toBe(0);
  });
  it("does not send from a sender that is not connected", async () => {
    let sent = 0; const f = fakeStore();
    expect(await run(ctx({ sender: sender({ status: "needs_reauth" }) }), { id: "gmail", async send() { sent++; return { status: "accepted", providerMessageId: "m" }; } }, f.s)).toBe("released");
    expect(sent).toBe(0);
  });
  it("does nothing when the lease was lost before the provider call", async () => {
    let sent = 0; const f = fakeStore({ async markAttempt() { return false; } });
    expect(await run(ctx(), { id: "gmail", async send() { sent++; return { status: "accepted", providerMessageId: "m" }; } }, f.s)).toBe("lease_lost");
    expect(sent).toBe(0);
  });
});

describe("retryDelaySeconds", () => {
  it("grows x4, caps at 6 h, jitters within +-25 %", () => {
    expect([1, 2, 3].map((n) => retryDelaySeconds(n, 30, () => 0.5))).toEqual([30, 120, 480]);
    expect(retryDelaySeconds(20, 30, () => 0.5)).toBe(6 * 3600);
    expect(retryDelaySeconds(1, 100, () => 0)).toBe(75); expect(retryDelaySeconds(1, 100, () => 0.999)).toBeLessThanOrEqual(125);
  });
});

describe("config", () => {
  it("falls back to defaults on bad values", () => {
    const old = process.env.SEND_MAX_ATTEMPTS; process.env.SEND_MAX_ATTEMPTS = "banana";
    expect(queueConfig().maxAttempts).toBe(4); process.env.SEND_MAX_ATTEMPTS = "99"; expect(queueConfig().maxAttempts).toBe(4);
    process.env.SEND_MAX_ATTEMPTS = "2"; expect(queueConfig().maxAttempts).toBe(2);
    if (old === undefined) delete process.env.SEND_MAX_ATTEMPTS; else process.env.SEND_MAX_ATTEMPTS = old;
  });
  it("siteUrl requires https in production and a valid url always", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://app.example.com/", NODE_ENV: "production" })).toBe("https://app.example.com");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "http://app.example.com", NODE_ENV: "production" })).toBeNull();
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)", NODE_ENV: "development" })).toBeNull();
    expect(siteUrl({ NODE_ENV: "development" })).toBeNull();
  });
});

describe("prepareCampaign", () => {
  const c = (email: string, name: string | null, fields: object = {}, consented = true): ContactRow => ({ id: `id-${email}`, email, name, fields, consent_source: "t", consented_at: consented ? "2026-01-01" : null });
  const contacts = [c("alex@gmail.com", "Alex", { boarding_code: "BD101" }), c("john@gmail.com", "John", { boarding_code: "BD102" }), c("nocode@x.com", "Nina", {}), c("old@x.com", "Old", { boarding_code: "BD9" }, false), c("unsub@x.com", "U", { boarding_code: "BD7" })];
  const base = { template: { subject: "Your Boarding Confirmation - {{name}}", html: "<p>Hello {{name}}, code {{boarding_code}}. <a href=\"{{unsubscribe_url}}\">unsubscribe</a></p>", text: "Hello {{name}} {{boarding_code}} {{unsubscribe_url}}" }, contacts, suppressedEmails: new Set(["unsub@x.com"]), includeUnconsented: false, siteUrl: "https://app.example.com" };

  it("renders each recipient only from their own data, with their own unsubscribe link", () => {
    const p = prepareCampaign(base);
    expect(p.messages.map((m) => m.email)).toEqual(["alex@gmail.com", "john@gmail.com"]);
    const [a, j] = p.messages as [typeof p.messages[0], typeof p.messages[0]];
    expect(a.subject).toBe("Your Boarding Confirmation - Alex"); expect(a.html).toContain("BD101"); expect(a.html).not.toContain("BD102");
    expect(a.html).not.toContain("john@gmail.com"); expect(a.text).not.toContain("John");
    expect(a.token).not.toBe(j.token); expect(a.html).toContain(unsubscribeUrl("https://app.example.com", a.token)); expect(TOKEN_RE.test(a.token)).toBe(true);
  });
  it("sorts everyone else into suppressed / unconsented / blocked and never sends a partial message", () => {
    const p = prepareCampaign(base);
    expect(p.suppressed.map((x) => x.email)).toEqual(["unsub@x.com"]);
    expect(p.unconsented.map((x) => x.email)).toEqual(["old@x.com"]);
    expect(p.blocked.map((x) => x.contact.email)).toEqual(["nocode@x.com"]); expect(p.blocked[0]!.reason).toContain("boarding_code");
  });
  it("includes consent-less contacts only when explicitly opted in; suppressed ones never", () => {
    const p = prepareCampaign({ ...base, includeUnconsented: true });
    expect(p.messages.map((m) => m.email)).toContain("old@x.com"); expect(p.messages.map((m) => m.email)).not.toContain("unsub@x.com");
  });
  it("a broken template produces no messages at all", () => {
    const p = prepareCampaign({ ...base, template: { subject: "Hi {{name", html: "<p>x</p>" } });
    expect(p.messages).toHaveLength(0); expect(p.templateErrors.length).toBeGreaterThan(0);
    expect(prepareCampaign({ ...base, template: { subject: "Hi", html: "<p>[[describe the date]]</p>" } }).messages).toHaveLength(0);
  });
  it("blocks a hostile value that would create a javascript: link", () => {
    const p = prepareCampaign({ ...base, contacts: [c("evil@x.com", "E", { boarding_code: "x" , link: "javascript:alert(1)" })], template: { subject: "s", html: "<a href=\"{{link}}\">go</a>" } });
    expect(p.messages).toHaveLength(0); expect(p.blocked).toHaveLength(1);
  });
});

describe("audienceDigest", () => {
  const a = { id: "1", updated_at: "t1", consented_at: "c" }, b = { id: "2", updated_at: "t2", consented_at: "c" };
  it("is order-independent and changes when anything about the audience changes", () => {
    expect(audienceDigest([a, b])).toBe(audienceDigest([b, a]));
    expect(audienceDigest([a])).not.toBe(audienceDigest([a, b]));
    expect(audienceDigest([a, b])).not.toBe(audienceDigest([a, { ...b, updated_at: "t3" }]));
    expect(audienceDigest([a, b])).not.toBe(audienceDigest([a, { ...b, consented_at: null as unknown as string }]));
  });
});

describe("unsubscribe helpers", () => {
  it("tokens are 256-bit, url-safe and unique", () => {
    const t = [newUnsubscribeToken(), newUnsubscribeToken()]; expect(t[0]).not.toBe(t[1]); t.forEach((x) => expect(TOKEN_RE.test(x)).toBe(true));
  });
  it("builds links and headers", () => {
    expect(unsubscribeUrl("https://a.com/", "T")).toBe("https://a.com/unsubscribe/T"); expect(oneClickUrl("https://a.com", "T")).toBe("https://a.com/api/unsubscribe/T");
    expect(unsubscribeHeaders("https://a.com", "T")).toEqual({ "List-Unsubscribe": "<https://a.com/api/unsubscribe/T>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
  it("masks addresses", () => { expect(maskEmail("alex@gmail.com")).toBe("a***@gmail.com"); expect(maskEmail("a@x.com")).toBe("a*@x.com"); expect(maskEmail("nonsense")).toBe("your address"); });
});

describe("verifySvix", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key-bytes").toString("base64");
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "m1" } }), id = "msg_1", now = Date.now(), ts = String(Math.floor(now / 1000));
  const sign = (b: string, i = id, t = ts) => "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${i}.${t}.${b}`).digest("base64");
  it("accepts a valid signature, including among several", () => {
    expect(verifySvix({ id, timestamp: ts, signature: sign(body) }, body, secret, now)).toBe(true);
    expect(verifySvix({ id, timestamp: ts, signature: `v1,AAAA ${sign(body)}` }, body, secret, now)).toBe(true);
  });
  it("rejects tampering, wrong secret, replay and missing headers", () => {
    expect(verifySvix({ id, timestamp: ts, signature: sign(body) }, body + " ", secret, now)).toBe(false);
    expect(verifySvix({ id: "msg_2", timestamp: ts, signature: sign(body) }, body, secret, now)).toBe(false);
    expect(verifySvix({ id, timestamp: ts, signature: sign(body) }, body, "whsec_" + Buffer.from("other").toString("base64"), now)).toBe(false);
    const old = String(Math.floor(now / 1000) - 3600);
    expect(verifySvix({ id, timestamp: old, signature: sign(body, id, old) }, body, secret, now)).toBe(false);
    expect(verifySvix({ id: null, timestamp: ts, signature: sign(body) }, body, secret, now)).toBe(false);
    expect(verifySvix({ id, timestamp: ts, signature: sign(body) }, body, "", now)).toBe(false);
  });
  it("parses events defensively", () => {
    expect(parseResendEvent({ type: "email.delivered", data: { email_id: "m1" } })).toEqual({ type: "email.delivered", messageId: "m1" });
    expect(parseResendEvent({ type: "email.delivered", data: {} })).toBeNull(); expect(parseResendEvent(null)).toBeNull(); expect(parseResendEvent("x")).toBeNull();
  });
});
