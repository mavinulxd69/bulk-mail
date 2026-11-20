"use server";
import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { TOKEN_RE } from "@/lib/queue/unsubscribe";
export async function confirmUnsubscribe(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  if (!TOKEN_RE.test(token)) return redirect("/");
  const { error } = await admin().rpc("apply_unsubscribe", { p_token: token });
  if (error) { console.error("[unsubscribe] failed", error.message); return redirect(`/unsubscribe/${token}`); }
  return redirect(`/unsubscribe/${token}?done=1`);
}
