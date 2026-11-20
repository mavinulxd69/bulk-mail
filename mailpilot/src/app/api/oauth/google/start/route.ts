import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authUrl, googleConfigured } from "@/lib/providers/gmail";
import { checkIncomingRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";
export async function GET(req: Request) {
  const limited = await checkIncomingRequestLimit("oauth.google.start", req.headers, undefined, 5);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.oauth.google.start", limited.ip, { bucket: limited.bucket });
    return NextResponse.redirect(new URL("/dashboard/senders?error=Too+many+connection+requests", req.url));
  }
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/dashboard/senders?error=Gmail%20is%20not%20configured%20on%20this%20server.", req.url));
  const state = randomBytes(32).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/oauth/google" });
  return res;
}
