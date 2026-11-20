"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { revoke, getAccessToken } from "@/lib/providers/gmail";
import { createDomain, getDomain, verifyDomain as rVerify, resendConfigured } from "@/lib/providers/resend";
import { checkClientRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";
const go = (k: "notice" | "error", m: string): never => redirect(`/dashboard/senders?${k}=${encodeURIComponent(m)}`);
async function me() { const sb = await createClient(); const { data: { user } } = await sb.auth.getUser(); if (!user) redirect("/login"); return { sb, user }; }
async function rateLimited(userId: string, operation: string, limit = 10) {
  const result = await checkClientRequestLimit(`sender.${operation}`, userId, limit);
  if (!result.allowed && result.thresholdCrossed) await recordAbuseEvent(`rate_limit.sender.${operation}`, result.ip, { bucket: result.bucket }, userId);
  return !result.allowed;
}

export async function disconnectSender(fd: FormData) {
  const { sb, user } = await me();
  if (await rateLimited(user.id, "disconnect")) return go("error", "Too many requests. Try again in a minute.");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return go("error", "Invalid sender.");
  const { data: s } = await sb.from("sender_accounts").select("id,provider").eq("id", id.data).single(); // RLS: own rows only
  if (!s) return go("error", "Sender not found.");
  const db = admin();
  if (s.provider === "gmail") { try { await revoke(await getAccessToken(s.id, user.id)); } catch { /* already revoked */ } }
  await db.from("sender_credentials").delete().eq("sender_id", s.id).eq("user_id", user.id);
  await db.from("sender_accounts").update({ status: "disconnected" }).eq("id", s.id).eq("user_id", user.id);
  await db.from("audit_logs").insert({ user_id: user.id, action: "sender.disconnected", detail: { sender_id: s.id } });
  return go("notice", "Sender disconnected.");
}
export async function addDomain(fd: FormData) {
  const { sb, user } = await me();
  if (await rateLimited(user.id, "add_domain", 5)) return go("error", "Too many requests. Try again in a minute.");
  if (!resendConfigured()) return go("error", "Business email is not configured on this server.");
  const d = z.string().trim().toLowerCase().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/).safeParse(fd.get("domain"));
  if (!d.success) return go("error", "Enter a valid domain, like example.com.");
  try {
    const r = await createDomain(d.data);
    const { error } = await sb.from("sender_domains").insert({ user_id: user.id, domain: d.data, resend_domain_id: r.id, status: "pending", dns_records: r.records ?? [] });
    if (error) return go("error", "That domain is already added.");
  } catch { return go("error", "The provider rejected this domain. It may belong to another account."); }
  return go("notice", "Domain added. Create the DNS records below, then check status.");
}
export async function checkDomain(fd: FormData) {
  const { sb, user } = await me();
  if (await rateLimited(user.id, "check_domain", 10)) return go("error", "Too many requests. Try again in a minute.");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return go("error", "Invalid domain.");
  const { data: dom } = await sb.from("sender_domains").select("id,resend_domain_id").eq("id", id.data).single();
  if (!dom?.resend_domain_id) return go("error", "Domain not found.");
  try {
    await rVerify(dom.resend_domain_id);
    const r = await getDomain(dom.resend_domain_id);
    const status = r.status === "verified" ? "verified" : r.status === "failed" ? "failed" : "pending";
    await sb.from("sender_domains").update({ status, dns_records: r.records ?? [] }).eq("id", dom.id);
    return go("notice", status === "verified" ? "Domain verified." : `Not verified yet (status: ${status}). DNS can take a while to propagate.`);
  } catch { return go("error", "Could not check the domain right now."); }
}
export async function addResendSender(fd: FormData) {
  const { sb, user } = await me();
  if (await rateLimited(user.id, "add_resend_sender")) return go("error", "Too many requests. Try again in a minute.");
  const p = z.object({ domain_id: z.string().uuid(), local: z.string().trim().toLowerCase().regex(/^[a-z0-9._+-]{1,64}$/), name: z.string().trim().max(80).optional(), reply_to: z.string().trim().email().optional().or(z.literal("")) })
    .safeParse({ domain_id: fd.get("domain_id"), local: fd.get("local"), name: fd.get("name") || undefined, reply_to: fd.get("reply_to") ?? "" });
  if (!p.success) return go("error", "Check the sender details.");
  const { data: dom } = await sb.from("sender_domains").select("domain,status").eq("id", p.data.domain_id).single();
  if (!dom || dom.status !== "verified") return go("error", "Verify the domain first.");
  const { error } = await admin().from("sender_accounts").insert({ user_id: user.id, provider: "resend", display_name: p.data.name ?? null, from_address: `${p.data.local}@${dom.domain}`, reply_to: p.data.reply_to || null, status: "connected" });
  if (error) return go("error", "Could not add that sender.");
  return go("notice", "Sender added.");
}
