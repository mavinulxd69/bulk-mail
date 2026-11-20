"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { checkClientRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";
const creds = z.object({ email: z.string().trim().email(), password: z.string().min(10, "Use at least 10 characters.") });
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const fail = (path: string, msg: string): never => redirect(`${path}?error=${encodeURIComponent(msg)}`);
const configured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export async function login(fd: FormData) {
  if (!configured()) fail("/login", "Supabase is not configured. See README setup.");
  const limited = await checkClientRequestLimit("auth.login", String(fd.get("email") ?? "unknown"));
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.auth.login", limited.ip, { bucket: limited.bucket });
    fail("/login", "Too many attempts. Try again later.");
  }
  const p = creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) fail("/login", "Enter a valid email and password.");
  const { data, error } = await (await createClient()).auth.signInWithPassword(p.data!);
  if (error) fail("/login", "Email or password is incorrect, or the email is not verified yet.");
  if (data.user) await admin().from("audit_logs").insert({ user_id: data.user.id, action: "auth.login", detail: {} });
  redirect("/dashboard");
}
export async function signup(fd: FormData) {
  if (!configured()) fail("/signup", "Supabase is not configured. See README setup.");
  const limited = await checkClientRequestLimit("auth.signup", String(fd.get("email") ?? "unknown"), 5);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.auth.signup", limited.ip, { bucket: limited.bucket });
    fail("/signup", "Too many attempts. Try again later.");
  }
  const p = creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) fail("/signup", p.error.issues[0]?.message ?? "Check your details.");
  const { data, error } = await (await createClient()).auth.signUp({ ...p.data!, options: { emailRedirectTo: `${site()}/auth/callback` } });
  if (error) fail("/signup", "Could not create the account. Try a different email or password.");
  if (data.user) await admin().from("audit_logs").insert({ user_id: data.user.id, action: "auth.signup", detail: {} });
  redirect("/login?notice=" + encodeURIComponent("Check your inbox to verify your email, then log in."));
}
export async function forgotPassword(fd: FormData) {
  if (!configured()) fail("/forgot-password", "Supabase is not configured. See README setup.");
  const limited = await checkClientRequestLimit("auth.password_reset", String(fd.get("email") ?? "unknown"), 5);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.auth.password_reset", limited.ip, { bucket: limited.bucket });
    fail("/forgot-password", "Too many attempts. Try again later.");
  }
  const email = z.string().trim().email().safeParse(fd.get("email"));
  if (email.success) await (await createClient()).auth.resetPasswordForEmail(email.data, { redirectTo: `${site()}/auth/callback?next=/reset-password` });
  redirect("/login?notice=" + encodeURIComponent("If that email has an account, a reset link is on its way.")); // same message either way: no account enumeration
}
export async function logout() { await (await createClient()).auth.signOut(); redirect("/"); }

export async function updatePassword(fd: FormData) {
  const p = z.string().min(10, "Use at least 10 characters.").safeParse(fd.get("password"));
  if (!p.success) fail("/reset-password", p.error.issues[0]?.message ?? "Invalid password.");
  const { error } = await (await createClient()).auth.updateUser({ password: p.data! });
  if (error) fail("/reset-password", "Could not update the password. Request a new reset link.");
  redirect("/dashboard?notice=Password%20updated");
}
