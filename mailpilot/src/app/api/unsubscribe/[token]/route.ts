import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { TOKEN_RE } from "@/lib/queue/unsubscribe";
import { checkIncomingRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";

export const dynamic = "force-dynamic";
// RFC 8058 one-click: mail apps POST here when the person taps "Unsubscribe" in the inbox UI.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await checkIncomingRequestLimit("unsubscribe.one_click", req.headers, undefined, 60);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.unsubscribe.one_click", limited.ip, { bucket: limited.bucket });
    return NextResponse.json({ ok: false, error: "too many requests" }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return NextResponse.json({ ok: false }, { status: 404 });
  const { data, error } = await admin().rpc("apply_unsubscribe", { p_token: token });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: data !== null }, { status: data === null ? 404 : 200 });
}
// A person following the link in a browser gets the confirmation page instead.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, req.url), 303);
}
