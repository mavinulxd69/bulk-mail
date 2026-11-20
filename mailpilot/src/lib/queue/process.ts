// Sends ONE claimed job. All decisions about retry / fail / pause live here and are unit-tested with an in-memory store.
import type { EmailProvider, SendInput } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import { retryDelaySeconds } from "./backoff";
import type { QueueConfig } from "./config";
import type { JobContext, QueueStore, SenderInfo } from "./types";
import { unsubscribeHeaders } from "./unsubscribe";

export type Outcome = "accepted" | "retry" | "failed" | "suppressed" | "cancelled" | "released" | "paused" | "lease_lost";
export type ProcessDeps = {
  store: QueueStore; providerFor: (s: SenderInfo) => EmailProvider; config: QueueConfig; siteUrl: string | null;
  now?: () => Date; random?: () => number;
};
const clip = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 300);
const PROVIDER_NAME = { gmail: "Gmail", resend: "The sending service" } as const;
export const UNKNOWN_OUTCOME_GMAIL = "Gmail did not answer, so MailPilot cannot tell whether the message was sent. It was not retried, to avoid a duplicate. Check the sender's Sent folder.";

export async function processJob(ctx: JobContext, d: ProcessDeps): Promise<Outcome> {
  const { job, recipient, campaign, sender } = ctx, { store, config } = d;
  const now = (d.now ?? (() => new Date()))();
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  // 1. Is this message still meant to go out? (State may have changed since it was queued.)
  if (!recipient || !recipient.email || recipient.erased_at) return (await store.markTerminal(job, "cancelled", { kind: "contact_deleted", message: "The contact was deleted before this message was sent." })) ? "cancelled" : "lease_lost";
  if (!campaign || campaign.status === "cancelled") return (await store.markTerminal(job, "cancelled", { kind: "cancelled", message: "Cancelled by you before it was sent." })) ? "cancelled" : "lease_lost";
  if (campaign.status !== "queued" && campaign.status !== "sending")
    return (await store.release(job, { runAfter: later(300), kind: "campaign_state", message: "The campaign is not in a sendable state.", event: "sender_unavailable" })) ? "released" : "lease_lost";
  if (!sender || sender.status !== "connected")
    return (await store.release(job, { runAfter: later(600), kind: "auth", message: "The sender account is not connected. Reconnect it on the Sender Accounts page.", event: "sender_unavailable" })) ? "released" : "lease_lost";
  // Re-checked at the last moment: someone may have unsubscribed after the campaign was approved.
  if (await store.isSuppressed(job.user_id, recipient.email)) return (await store.markTerminal(job, "suppressed", { kind: "suppressed", message: "The address is on your suppression list." })) ? "suppressed" : "lease_lost";
  if (!recipient.rendered_subject || (!recipient.rendered_html && !recipient.rendered_text))
    return (await store.markFailed(job, { kind: "permanent", message: "The stored message is empty.", attempts: job.attempts })) ? "failed" : "lease_lost";

  const input: SendInput = {
    to: recipient.email, subject: recipient.rendered_subject, text: recipient.rendered_text ?? "", html: recipient.rendered_html ?? undefined,
    from: { name: sender.display_name ?? undefined, address: sender.from_address }, replyTo: sender.reply_to ?? undefined,
    idempotencyKey: job.idempotency_key,
    ...(campaign.is_marketing && d.siteUrl && recipient.unsubscribe_token ? { headers: unsubscribeHeaders(d.siteUrl, recipient.unsubscribe_token) } : {}),
  };

  // 2. Mark "about to call the provider" BEFORE calling it. If we lose the lease here, another worker owns the job: do nothing.
  if (!(await store.markAttempt(job))) return "lease_lost";

  // 3. The provider call.
  let result;
  try { result = await d.providerFor(sender).send(input); }
  catch (e) { return handleError(e, ctx, d, later); }
  return (await store.markAccepted(job, { senderId: sender.id, messageId: result.providerMessageId, simulated: !!result.simulated })) ? "accepted" : "lease_lost";
}

async function handleError(e: unknown, ctx: JobContext, d: ProcessDeps, later: (s: number) => Date): Promise<Outcome> {
  const { job, sender } = ctx as JobContext & { sender: SenderInfo }, { store, config } = d;
  const kind = e instanceof ProviderError ? e.kind : "unknown";
  if (!(e instanceof ProviderError)) console.error("[queue] unexpected error while sending", job.id, e instanceof Error ? e.message : e);
  const message = e instanceof ProviderError ? clip(e.message) : "Unexpected error while sending.";
  const attempts = job.attempts + 1;
  const name = PROVIDER_NAME[sender.provider];

  if (kind === "permanent") return (await store.markFailed(job, { kind: "permanent", message, attempts })) ? "failed" : "lease_lost";

  if (kind === "quota") {
    const until = await store.pauseSender(sender.id, "quota", config.quotaPauseMinutes);
    const ok = await store.release(job, { runAfter: until, kind: "quota", message: `${name} sending limit reached. Sending is paused until ${until.toISOString().slice(0, 16).replace("T", " ")} UTC, then MailPilot tries again.`, event: "quota_paused", payload: { paused_until: until.toISOString() } });
    return ok ? "paused" : "lease_lost";
  }

  if (kind === "auth") {
    if (sender.provider === "gmail") {
      await store.markSenderNeedsReauth(sender.id);
      return (await store.release(job, { runAfter: later(600), kind: "auth", message: "Gmail rejected the connection. Reconnect this sender on the Sender Accounts page; sending resumes afterwards.", event: "auth_failed" })) ? "released" : "lease_lost";
    }
    const until = await store.pauseSender(sender.id, "provider_auth", 15);
    return (await store.release(job, { runAfter: until, kind: "auth", message: "The sending service rejected MailPilot's credentials. This is a platform problem, not yours; sending resumes automatically once it is fixed.", event: "auth_failed", payload: { paused_until: until.toISOString() } })) ? "released" : "lease_lost";
  }

  // "unknown": the request may have gone through. Gmail has no idempotency, so a retry could send a second copy: fail instead.
  if (kind === "unknown" && sender.provider === "gmail") return (await store.markFailed(job, { kind: "unknown_outcome", message: UNKNOWN_OUTCOME_GMAIL, attempts })) ? "failed" : "lease_lost";

  // "temporary", or "unknown" on Resend (the same Idempotency-Key makes the retry safe): retry with backoff, up to max_attempts.
  if (attempts >= job.max_attempts) return (await store.markFailed(job, { kind: "temporary", message: `${message} Gave up after ${attempts} attempts.`, attempts })) ? "failed" : "lease_lost";
  const delaySeconds = retryDelaySeconds(attempts, config.retryBaseSeconds, d.random);
  return (await store.markRetry(job, { kind: "temporary", message, attempts, delaySeconds })) ? "retry" : "lease_lost";
}
