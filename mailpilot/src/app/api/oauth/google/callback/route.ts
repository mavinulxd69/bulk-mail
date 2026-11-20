import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { exchangeCode, userInfo, googleConfigured, SCOPES } from "@/lib/providers/gmail";
const back = (req: Request, k: string, m: string) => NextResponse.redirect(new URL(`/dashboard/senders?${k}=${encodeURIComponent(m)}`, req.url));
export async function GET(req: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value ?? "";
  const got = url.searchParams.get("state") ?? "";
  const ok = expected.length > 0 && expected.length === got.length && timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  jar.delete("g_oauth_state");
  if (!ok) return back(req, "error", "Connection check failed. Please try again.");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code || !googleConfigured()) return back(req, "error", "Gmail connection was cancelled or failed.");
  try {
    const t = await exchangeCode(code);
    if (!t.refresh_token) return back(req, "error", "Google did not return offline access. Remove MailPilot at myaccount.google.com/permissions and retry.");
    if (!SCOPES.split(" ").filter((s) => s.includes("gmail")).every((s) => (url.searchParams.get("scope") ?? "").includes(s))) return back(req, "error", "Sending permission was not granted.");
    const info = await userInfo(t.access_token);
    if (!info.email || !info.email_verified) return back(req, "error", "Could not verify the Google account email.");
    const db = admin();
    const { data: s, error } = await db.from("sender_accounts").insert({ user_id: user.id, provider: "gmail", display_name: info.name ?? null, from_address: info.email, status: "connected" }).select("id").single();
    if (error || !s) return back(req, "error", "That Gmail account may already be connected.");
    await db.from("sender_credentials").insert({ sender_id: s.id, user_id: user.id, encrypted_refresh_token: encrypt(t.refresh_token), encrypted_access_token: encrypt(t.access_token), expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString() });
    await db.from("audit_logs").insert({ user_id: user.id, action: "sender.connected", detail: { provider: "gmail", sender_id: s.id } });
    return back(req, "notice", `Connected ${info.email}.`);
  } catch { return back(req, "error", "Could not complete the Gmail connection."); }
}
