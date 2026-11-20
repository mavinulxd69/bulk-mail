import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authUrl, googleConfigured } from "@/lib/providers/gmail";
export async function GET(req: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/dashboard/senders?error=Gmail%20is%20not%20configured%20on%20this%20server.", req.url));
  const state = randomBytes(32).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/oauth/google" });
  return res;
}
