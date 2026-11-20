export interface SendInput { to: string; subject: string; text: string; html?: string; from: { name?: string; address: string }; replyTo?: string; idempotencyKey: string;
  /** Extra headers, e.g. List-Unsubscribe. Names must be plain header tokens; values must not contain line breaks. */ headers?: Record<string, string> }
// "accepted" means the provider took the message. It is NOT delivery; delivery needs a webhook (Phase 6).
export interface SendResult { status: "accepted"; providerMessageId: string; simulated?: boolean }
// "unknown": the request may or may not have reached the provider (timeout, dropped connection). Only providers that
// de-duplicate on the idempotency key (Resend) may retry these; Gmail cannot, so the queue fails them instead of risking a duplicate.
export type ErrorKind = "temporary" | "permanent" | "quota" | "auth" | "unknown";
export class ProviderError extends Error { constructor(public kind: ErrorKind, message: string) { super(message); } }
export interface EmailProvider { id: "gmail" | "resend" | "mock"; send(input: SendInput): Promise<SendResult>; }
