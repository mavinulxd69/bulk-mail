"use server";
import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { TOKEN_RE } from "@/lib/queue/unsubscribe";
import { checkClientRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";
export async function confirmUnsubscribe(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  if (!TOKEN_RE.test(token)) return redirect("/");
  const limited = await checkClientRequestLimit("unsubscribe.confirm", token, 60);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.unsubscribe.confirm", limited.ip, { bucket: limited.bucket });
    return redirect(`/unsubscribe/${token}?error=Please+try+again+in+a+minute`);
  }
  const { error } = await admin().rpc("apply_unsubscribe", { p_token: token });
  if (error) { console.error("[unsubscribe] failed", error.message); return redirect(`/unsubscribe/${token}`); }
  return redirect(`/unsubscribe/${token}?done=1`);
}
