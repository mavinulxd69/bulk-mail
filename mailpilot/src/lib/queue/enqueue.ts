import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { ContactRow } from "@/lib/contacts/db";
import type { PreparedMessage } from "./prepare";

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const check = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };

/**
 * Writes one recipient row + one job per message (pending) and one recorded-but-never-sent row per suppressed contact.
 * Service-role client. Throws on any failure; the caller rolls the whole approval back. Returns how many jobs exist now.
 * The campaign is still 'awaiting_approval' while this runs, so the worker cannot touch these jobs yet.
 */
export async function enqueueMessages(db: SupabaseClient, p: {
  userId: string; campaignId: string; messages: PreparedMessage[]; suppressed: Pick<ContactRow, "id" | "email">[];
  provider: "gmail" | "resend"; maxAttempts: number;
}): Promise<number> {
  let count = 0;
  const base = { user_id: p.userId, campaign_id: p.campaignId };
  const sendable = p.messages.map((m) => ({ ...m, rid: randomUUID(), jid: randomUUID() }));
  for (const part of chunks(sendable, 100)) {
    check("recipients", (await db.from("campaign_recipients").insert(part.map((m) => ({ id: m.rid, ...base, contact_id: m.contactId, email: m.email, rendered_subject: m.subject, rendered_html: m.html, rendered_text: m.text, unsubscribe_token: m.token })))).error);
    check("jobs", (await db.from("sending_jobs").insert(part.map((m) => ({ id: m.jid, ...base, recipient_id: m.rid, idempotency_key: `mp:${m.jid}`, status: "pending", provider: p.provider, max_attempts: p.maxAttempts })))).error);
    count += part.length;
  }
  // Suppressed contacts are recorded so the numbers add up and you can see who was skipped and why. No content is stored and nothing is sent.
  const skipped = p.suppressed.map((x) => ({ ...x, rid: randomUUID(), jid: randomUUID() }));
  for (const part of chunks(skipped, 200)) {
    check("recipients", (await db.from("campaign_recipients").insert(part.map((m) => ({ id: m.rid, ...base, contact_id: m.id, email: m.email })))).error);
    check("jobs", (await db.from("sending_jobs").insert(part.map((m) => ({ id: m.jid, ...base, recipient_id: m.rid, idempotency_key: `mp:${m.jid}`, status: "suppressed", provider: p.provider, last_error: "The address is on your suppression list.", last_error_kind: "suppressed" })))).error);
    count += part.length;
  }
  return count;
}
