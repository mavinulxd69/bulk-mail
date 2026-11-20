import "server-only";
import { randomBytes } from "node:crypto";
import { admin } from "../supabase/admin";
import { decrypt, encrypt } from "../crypto";
import { ProviderError, requireProviderMessageId, type EmailProvider, type SendInput } from "./types";

export const SCOPES = "openid email https://www.googleapis.com/auth/gmail.send"; // minimum: send only, no mailbox read
export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY);
export const redirectUri = () => `${process.env.NEXT_PUBLIC_SITE_URL}/api/oauth/google/callback`;

export function authUrl(state: string) {
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function token(body: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }) });
  const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new ProviderError(j.error === "invalid_grant" ? "auth" : "temporary", j.error ?? "token_error");
  return j as Required<Pick<typeof j, "access_token">> & typeof j;
}
export const exchangeCode = (code: string) => token({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
export async function userInfo(accessToken: string) {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  return (await r.json()) as { email?: string; name?: string; email_verified?: boolean };
}
export const revoke = (t: string) => fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => null);

/** Returns a valid access token, refreshing and re-encrypting when expired. Marks the sender needs_reauth if Google revoked access. */
export async function getAccessToken(senderId: string, userId: string): Promise<string> {
  const db = admin();
  const { data: c } = await db.from("sender_credentials").select("*").eq("sender_id", senderId).eq("user_id", userId).single();
  if (!c?.encrypted_refresh_token) throw new ProviderError("auth", "Sender is not connected");
  if (c.encrypted_access_token && c.expires_at && new Date(c.expires_at).getTime() - Date.now() > 60_000) return decrypt(c.encrypted_access_token);
  try {
    const t = await token({ grant_type: "refresh_token", refresh_token: decrypt(c.encrypted_refresh_token) });
    await db.from("sender_credentials").update({ encrypted_access_token: encrypt(t.access_token), expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString() }).eq("sender_id", senderId).eq("user_id", userId);
    return t.access_token;
  } catch (e) {
    if (e instanceof ProviderError && e.kind === "auth") await db.from("sender_accounts").update({ status: "needs_reauth" }).eq("id", senderId).eq("user_id", userId);
    throw e;
  }
}

const clean = (v: string) => v.replace(/[\r\n]+/g, " ").trim(); // blocks header injection
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap = (s: string) => b64(s).replace(/.{76}/g, "$&\r\n");
const enc = (s: string) => `=?UTF-8?B?${b64(clean(s))}?=`;
/** Must stay well below the queue's lease (WORKER_LEASE_SECONDS, min 30). */
export const SEND_TIMEOUT_MS = 20_000;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const extraHeaders = (h: Record<string, string> = {}) => Object.entries(h).filter(([k]) => HEADER_NAME.test(k)).map(([k, v]) => `${k}: ${clean(v)}`);
export function buildMime(i: SendInput): string {
  const bnd = `mp_${randomBytes(12).toString("hex")}`;
  const h = [`From: ${i.from.name ? `${enc(i.from.name)} ` : ""}<${clean(i.from.address)}>`, `To: ${clean(i.to)}`, `Subject: ${enc(i.subject)}`, ...(i.replyTo ? [`Reply-To: ${clean(i.replyTo)}`] : []), ...extraHeaders(i.headers), "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${bnd}"`];
  const part = (type: string, body: string) => `--${bnd}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(body)}\r\n`;
  return `${h.join("\r\n")}\r\n\r\n${part("text/plain", i.text)}${i.html ? part("text/html", i.html) : ""}--${bnd}--`;
}
export function gmailProvider(senderId: string, userId: string): EmailProvider {
  return { id: "gmail", async send(i) {
    const at = await getAccessToken(senderId, userId);
    let r: Response;
    try { r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(buildMime(i)).toString("base64url") }), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }); }
    catch { throw new ProviderError("unknown", "No answer from Gmail"); } // may have been sent: never retried automatically (no idempotency in the Gmail API)
    if (r.ok) {
      let body: unknown;
      try { body = await r.json(); } catch { body = null; }
      return { status: "accepted", providerMessageId: requireProviderMessageId(body, "Gmail") };
    }
    const body = await r.text();
    if (r.status === 429 || /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded/.test(body)) throw new ProviderError("quota", "Gmail quota reached");
    if (r.status === 401) throw new ProviderError("auth", "Gmail rejected credentials");
    throw new ProviderError(r.status >= 500 ? "temporary" : "permanent", `Gmail ${r.status}`);
  } };
}
