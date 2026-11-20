import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_CONTACTS_PER_USER, MAX_LIST_NAME } from "@/lib/limits";
import { normalizeVarName } from "@/lib/personalize/variables";
import { parseContactInput } from "./parse";
import { validateRecords } from "./validate";
import { chunk, type ContactRow } from "./db";
import type { ImportState, RowIssue } from "./types";

const uuid = z.string().uuid();
export type ImportInput = { text: string; source: string; requiredRaw: string[]; listId: string; newList: string; updateExisting: boolean };

/**
 * The whole import pipeline: parse -> validate -> list -> insert/update -> consent events -> list membership.
 * `sb` must be the signed-in user's RLS-scoped client, so every read and write is limited to that tenant by the database itself.
 * The `user_id` filters below are belt and braces on top of RLS.
 */
export async function runImport(sb: SupabaseClient, userId: string, input: ImportInput): Promise<ImportState> {
  const user = { id: userId };
  const source = { data: input.source };
  const fail = (message: string): ImportState => ({ status: "error", message });
  const required = input.requiredRaw.map(normalizeVarName);
  if (required.length > 10 || required.some((r) => r === null)) return fail("Required fields must be column names like boarding_code (up to 10, comma-separated).");

  const parsed = parseContactInput(input.text);
  if (!parsed.ok) return fail(parsed.error);
  const { valid, issues } = validateRecords(parsed.records, { required: required as string[] });

  // Target list: an existing one, or a new one by name (never both).
  const listIdRaw = input.listId, newList = input.newList.trim();
  if (listIdRaw && newList) return fail("Choose an existing list or name a new one, not both.");
  let list: { id: string; name: string } | null = null;
  if (listIdRaw) {
    if (!uuid.safeParse(listIdRaw).success) return fail("That list was not found.");
    const { data } = await sb.from("contact_lists").select("id,name").eq("id", listIdRaw).maybeSingle();
    if (!data) return fail("That list was not found.");
    list = data;
  } else if (newList) {
    if (newList.length > MAX_LIST_NAME) return fail(`List names can be up to ${MAX_LIST_NAME} characters.`);
    const { data: found } = await sb.from("contact_lists").select("id,name").eq("name", newList).maybeSingle();
    if (found) list = found;
    else { const { data, error } = await sb.from("contact_lists").insert({ user_id: user.id, name: newList }).select("id,name").single(); if (error || !data) return fail("Could not create that list."); list = data; }
  }

  // Existing contacts and suppressions among the incoming addresses.
  const existing = new Map<string, ContactRow>(), suppressed = new Set<string>();
  for (const part of chunk(valid.map((v) => v.email), 150)) {
    const [c, s] = await Promise.all([
      sb.from("contacts").select("id,email,name,fields,consent_source,consented_at").eq("user_id", user.id).in("email", part),
      sb.from("suppressions").select("email").eq("user_id", user.id).in("email", part)]);
    if (c.error || s.error) return fail("Could not check your existing contacts. Try again.");
    (c.data ?? []).forEach((r: ContactRow) => existing.set(r.email, r));
    (s.data ?? []).forEach((r: { email: string }) => suppressed.add(r.email));
  }
  const toCreate = valid.filter((v) => !existing.has(v.email));
  const { count } = await sb.from("contacts").select("id", { count: "exact", head: true });
  if ((count ?? 0) + toCreate.length > MAX_CONTACTS_PER_USER) return fail(`This would pass the limit of ${MAX_CONTACTS_PER_USER} contacts per account (you have ${count ?? 0}).`);

  const nowIso = new Date().toISOString();
  const idByEmail = new Map<string, string>([...existing].map(([e, r]) => [e, r.id]));
  const events: { user_id: string; contact_id: string; event: string; source: string }[] = [];
  const stopped = (done: number) => fail(`Import stopped after ${done} new contacts because of a database error. Contacts already added were kept; run the import again to finish.`);
  let created = 0, updated = 0;

  for (const part of chunk(toCreate, 500)) {
    const { data, error } = await sb.from("contacts").insert(part.map((v) => ({
      user_id: user.id, email: v.email, name: v.name, fields: v.fields, consent_source: (v.consentSource ?? source.data).slice(0, 200), consented_at: nowIso,
    }))).select("id,email");
    if (error) return stopped(created);
    for (const r of data ?? []) { idByEmail.set(r.email, r.id); events.push({ user_id: user.id, contact_id: r.id, event: "imported", source: source.data }); }
    created += data?.length ?? 0;
  }

  if (input.updateExisting) {
    const changed = valid.flatMap((v) => {
      const old = existing.get(v.email); if (!old) return [];
      const oldFields = (old.fields && typeof old.fields === "object" ? old.fields : {}) as Record<string, string>;
      const fields = { ...oldFields, ...v.fields }, name = v.name ?? old.name;
      if (name === old.name && JSON.stringify(fields) === JSON.stringify(oldFields)) return [];
      const hadConsent = !!old.consent_source && !!old.consented_at; // pre-Phase-4 rows may lack it; record it now
      return [{ old, row: { user_id: user.id, email: v.email, name, fields, consent_source: hadConsent ? old.consent_source : source.data, consented_at: hadConsent ? old.consented_at : nowIso }, newConsent: !hadConsent }];
    });
    for (const part of chunk(changed, 500)) {
      const { error } = await sb.from("contacts").upsert(part.map((p) => p.row), { onConflict: "user_id,email" });
      if (error) return stopped(created);
      updated += part.length;
      part.filter((p) => p.newConsent).forEach((p) => events.push({ user_id: user.id, contact_id: p.old.id, event: "imported", source: source.data }));
    }
  }
  for (const part of chunk(events, 500)) if ((await sb.from("consent_events").insert(part)).error) return fail("Contacts were saved, but the consent record could not be written. Contact support before sending to them.");

  let addedToList = 0;
  if (list) {
    const members = valid.flatMap((v) => { const id = idByEmail.get(v.email); return id ? [{ list_id: list!.id, contact_id: id, user_id: user.id }] : []; });
    for (const part of chunk(members, 500)) {
      const { data, error } = await sb.from("contact_list_members").upsert(part, { onConflict: "list_id,contact_id", ignoreDuplicates: true }).select("contact_id");
      if (error) return fail("Contacts were saved, but adding them to the list failed. Add them from each contact's page.");
      addedToList += data?.length ?? 0;
    }
  }

  const n = (c: RowIssue["code"][]) => issues.filter((i) => c.includes(i.code)).length;
  return {
    status: "done", issues: issues.slice(0, 100), issuesTruncated: issues.length > 100,
    summary: {
      created, updated, skippedExisting: valid.length - toCreate.length - updated, invalid: n(["invalid_email"]), duplicatesInFile: n(["duplicate_in_file"]),
      missingRequired: n(["missing_required"]), otherRejected: n(["malformed_row", "value_too_long"]),
      alreadySuppressed: valid.filter((v) => suppressed.has(v.email)).length, addedToList, listName: list?.name ?? null,
    },
  };
}
