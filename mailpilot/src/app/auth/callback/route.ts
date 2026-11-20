import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"; // block open redirects
  if (code) { const { error } = await (await createClient()).auth.exchangeCodeForSession(code); if (!error) return NextResponse.redirect(new URL(safe, url.origin)); }
  return NextResponse.redirect(new URL("/login?error=Link%20expired.%20Request%20a%20new%20one.", url.origin));
}
