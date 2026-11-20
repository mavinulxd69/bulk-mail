import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 over "<id>.<timestamp>.<raw body>" with the base64 secret after "whsec_".
 * Rejects stale timestamps (replay) and compares in constant time. `signature` may hold several space-separated "v1,<sig>" entries.
 */
export function verifySvix(h: { id: string | null; timestamp: string | null; signature: string | null }, rawBody: string, secret: string, now = Date.now(), toleranceSeconds = 300): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Only delivery outcomes are stored. Opens and clicks are deliberately ignored: MailPilot adds no tracking pixels or link rewriting. */
export const HANDLED_RESEND_EVENTS = new Set(["email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed"]);

export type ParsedResendEvent = { type: string; messageId: string };
export function parseResendEvent(body: unknown): ParsedResendEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { type?: unknown; data?: { email_id?: unknown } };
  if (typeof b.type !== "string" || typeof b.data?.email_id !== "string" || !b.data.email_id) return null;
  return { type: b.type, messageId: b.data.email_id };
}
