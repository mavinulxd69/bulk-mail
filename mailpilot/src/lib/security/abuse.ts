import "server-only";
import { createHmac } from "node:crypto";
import { admin } from "@/lib/supabase/admin";

export async function recordAbuseEvent(kind: string, ip: string, detail: Record<string, string>, userId?: string) {
  const secret = process.env.CRON_SECRET;
  const ipHash = secret ? createHmac("sha256", secret).update(ip).digest("hex") : null;
  const { error } = await admin().from("abuse_events").insert({
    user_id: userId ?? null,
    kind: kind.slice(0, 80),
    detail,
    ip_hash: ipHash,
  });
  if (error) console.error("[abuse] event could not be recorded", error.message);
}
