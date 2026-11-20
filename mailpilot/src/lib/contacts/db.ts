import type { SupabaseClient } from "@supabase/supabase-js";

export const chunk = <T,>(items: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; };

export type ContactRow = { id: string; email: string; name: string | null; fields: unknown; consent_source: string | null; consented_at: string | null; updated_at?: string };

/** Reads every contact the caller can see (RLS-scoped client), optionally limited to one list. Pages past PostgREST's 1,000-row cap. */
export async function fetchAllContacts(sb: SupabaseClient, opts: { listId?: string; max?: number } = {}): Promise<ContactRow[]> {
  const max = opts.max ?? 10000, out: ContactRow[] = [];
  for (let from = 0; from < max; from += 1000) {
    let q = sb.from("contacts").select(opts.listId ? "id,email,name,fields,consent_source,consented_at,updated_at,contact_list_members!inner(list_id)" : "id,email,name,fields,consent_source,consented_at,updated_at").order("created_at").order("id").range(from, Math.min(from + 999, max - 1));
    if (opts.listId) q = q.eq("contact_list_members.list_id", opts.listId);
    const { data, error } = await q;
    if (error) throw new Error("Could not load contacts.");
    out.push(...((data ?? []) as unknown as ContactRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
