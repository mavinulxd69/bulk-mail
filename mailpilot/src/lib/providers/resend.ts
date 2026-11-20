import "server-only";
import { ProviderError, type EmailProvider } from "./types";
export const resendConfigured = () => !!process.env.RESEND_API_KEY;
async function api<T>(path: string, init: RequestInit & { idem?: string } = {}): Promise<T> {
  let r: Response;
  try { r = await fetch(`https://api.resend.com${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(init.idem ? { "Idempotency-Key": init.idem } : {}) }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ProviderError("unknown", "No answer from Resend"); } // safe to retry with the same Idempotency-Key
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  // 401/403 mean the PLATFORM key is wrong or revoked: that must pause sending, never fail every user's messages permanently.
  if (!r.ok) throw new ProviderError(r.status === 429 ? "quota" : r.status === 401 || r.status === 403 ? "auth" : r.status >= 500 ? "temporary" : "permanent", j.message ?? `Resend ${r.status}`);
  return j;
}
export interface ResendDomain { id: string; name: string; status: string; records?: unknown[] }
export const createDomain = (name: string) => api<ResendDomain>("/domains", { method: "POST", body: JSON.stringify({ name }) });
export const getDomain = (id: string) => api<ResendDomain>(`/domains/${id}`);
export const verifyDomain = (id: string) => api<unknown>(`/domains/${id}/verify`, { method: "POST" });
export const resendProvider: EmailProvider = { id: "resend", async send(i) {
  const j = await api<{ id: string }>("/emails", { method: "POST", idem: i.idempotencyKey, body: JSON.stringify({ from: i.from.name ? `${i.from.name} <${i.from.address}>` : i.from.address, to: [i.to], subject: i.subject, text: i.text, html: i.html, reply_to: i.replyTo, headers: i.headers }) });
  return { status: "accepted", providerMessageId: j.id };
} };
