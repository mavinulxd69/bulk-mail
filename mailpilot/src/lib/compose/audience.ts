// Loads the people a message would go to: everyone in the chosen list (or all contacts) minus the suppression list.
// Takes an RLS-scoped client, so it can only ever see the signed-in user's own rows.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllContacts, type ContactRow } from "@/lib/contacts/db";

export type AudienceResult = { ok: true; contacts: ContactRow[]; audience: ContactRow[]; suppressed: number; withoutConsent: number } | { ok: false; message: string };

export async function loadAudience(sb: SupabaseClient, listId: string | undefined, max = 5000): Promise<AudienceResult> {
  let contacts: ContactRow[];
  try { contacts = await fetchAllContacts(sb, { listId, max }); } catch { return { ok: false, message: "Could not load that list." }; }
  if (!contacts.length) return { ok: false, message: "That list has no contacts yet." };

  const suppressed = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("suppressions").select("email").range(from, from + 999);
    if (error) return { ok: false, message: "Could not load your suppression list." };
    (data ?? []).forEach((r: { email: string }) => suppressed.add(r.email));
    if (!data || data.length < 1000) break;
  }
  const audience = contacts.filter((c) => !suppressed.has(c.email));
  if (!audience.length) return { ok: false, message: "Everyone in that list is on your suppression list." };
  return { ok: true, contacts, audience, suppressed: contacts.length - audience.length, withoutConsent: audience.filter((c) => !c.consented_at).length };
}
