import { randomBytes } from "node:crypto";

// The token is the only credential in an unsubscribe link, so it is 256 random bits, generated here, never derived from the address.
export const newUnsubscribeToken = () => randomBytes(32).toString("base64url");
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const base = (site: string) => site.replace(/\/+$/, "");

/** The page a person opens from the email body (asks for confirmation, so link scanners can't unsubscribe anyone). */
export const unsubscribeUrl = (site: string, token: string) => `${base(site)}/unsubscribe/${token}`;
/** The RFC 8058 one-click endpoint mail apps call with a POST. */
export const oneClickUrl = (site: string, token: string) => `${base(site)}/api/unsubscribe/${token}`;
export const unsubscribeHeaders = (site: string, token: string): Record<string, string> => ({
  "List-Unsubscribe": `<${oneClickUrl(site, token)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

/** "alex@gmail.com" -> "a****@gmail.com". The public page never shows a full address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your address";
  const local = email.slice(0, at);
  return `${local[0]}${"*".repeat(Math.min(Math.max(local.length - 1, 1), 5))}${email.slice(at)}`;
}
