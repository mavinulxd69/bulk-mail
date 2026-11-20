"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
const creds = z.object({ email: z.string().trim().email(), password: z.string().min(10, "Use at least 10 characters.") });
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const fail = (path: string, msg: string): never => redirect(`${path}?error=${encodeURIComponent(msg)}`);
const configured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export async function login(fd: FormData) {
  if (!configured()) fail("/login", "Supabase is not configured. See README setup.");
  const p = creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) fail("/login", "Enter a valid email and password.");
  const { error } = await (await createClient()).auth.signInWithPassword(p.data!);
  if (error) fail("/login", "Email or password is incorrect, or the email is not verified yet.");
  redirect("/dashboard");
}
export async function signup(fd: FormData) {
  if (!configured()) fail("/signup", "Supabase is not configured. See README setup.");
  const p = creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) fail("/signup", p.error.issues[0]?.message ?? "Check your details.");
  const { error } = await (await createClient()).auth.signUp({ ...p.data!, options: { emailRedirectTo: `${site()}/auth/callback` } });
  if (error) fail("/signup", "Could not create the account. Try a different email or password.");
  redirect("/login?notice=" + encodeURIComponent("Check your inbox to verify your email, then log in."));
}
export async function forgotPassword(fd: FormData) {
  if (!configured()) fail("/forgot-password", "Supabase is not configured. See README setup.");
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
