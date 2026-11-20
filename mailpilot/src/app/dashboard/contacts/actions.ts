"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { MAX_LIST_NAME, MAX_NAME_LENGTH, MAX_UPLOAD_BYTES } from "@/lib/limits";
import { runImport } from "@/lib/contacts/import-service";
import { loadAudience } from "@/lib/compose/audience";
import { contactVariables, parseFieldLines } from "@/lib/contacts/fields";
import { analyzeAudience, renderTemplate } from "@/lib/personalize/engine";
import type { ImportState, PreviewSample, PreviewState } from "@/lib/contacts/types";
import { checkClientRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";

const BASE = "/dashboard/contacts";
const go = (k: "notice" | "error", m: string, path = BASE): never => redirect(`${path}?${k}=${encodeURIComponent(m)}`);
async function me() { const sb = await createClient(); const { data: { user } } = await sb.auth.getUser(); if (!user) redirect("/login"); return { sb, user }; }
const uuid = z.string().uuid();
const audit = (user_id: string, action: string, detail: object) => admin().from("audit_logs").insert({ user_id, action, detail });

// ---------- Import (paste, CSV file, or a single address) ----------
export async function importContacts(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const { sb, user } = await me();
  const fail = (message: string): ImportState => ({ status: "error", message });
  const limited = await checkClientRequestLimit("contacts.import", user.id, 5);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.contacts.import", limited.ip, { bucket: limited.bucket }, user.id);
    return fail("Too many imports. Try again in a minute.");
  }

  if (fd.get("consent_ack") !== "on") return fail("Confirm that you are authorized to contact these people.");
  const source = z.string().trim().min(3).max(200).safeParse(fd.get("consent_source"));
  if (!source.success) return fail("Say where consent came from (3–200 characters), for example “Newsletter signup form, Oct 2026”.");

  const file = fd.get("file");
  let text = "";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return fail("That file is over 2 MB. Split it into smaller files.");
    text = await file.text();
  } else text = String(fd.get("paste") ?? "");
  if (text.length > MAX_UPLOAD_BYTES) return fail("That is too much text. Split it into smaller imports.");

  const requiredRaw = String(fd.get("required") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const state = await runImport(sb, user.id, {
    text, source: source.data, requiredRaw, listId: String(fd.get("list_id") ?? ""), newList: String(fd.get("new_list") ?? ""), updateExisting: fd.get("update_existing") === "on",
  });
  if (state.status === "done") {
    await audit(user.id, "contacts.imported", { created: state.summary.created, updated: state.summary.updated, rejected: state.issues.length, source: source.data, list: state.summary.listName });
    revalidatePath(BASE);
  }
  return state;
}

// ---------- Single contact ----------
export async function updateContact(fd: FormData) {
  const { sb, user } = await me();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return go("error", "Invalid contact.");
  const page = `${BASE}/${id.data}`;
  const name = z.string().trim().max(MAX_NAME_LENGTH).safeParse(fd.get("name") ?? "");
  const fields = parseFieldLines(String(fd.get("fields") ?? ""));
  if (!name.success) return go("error", "That name is too long.", page);
  if (!fields.ok) return go("error", fields.error, page);
  const { data, error } = await sb.from("contacts").update({ name: name.data || null, fields: fields.fields }).eq("id", id.data).select("id");
  if (error || !data?.length) return go("error", "Could not save this contact.", page);
  await audit(user.id, "contact.updated", { contact_id: id.data });
  revalidatePath(BASE);
  return go("notice", "Contact saved.", page);
}

export async function setMemberships(fd: FormData) {
  const { sb, user } = await me();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return go("error", "Invalid contact.");
  const page = `${BASE}/${id.data}`;
  const wanted = new Set(z.array(uuid).max(500).catch([]).parse(fd.getAll("list_ids")));
  const [{ data: lists }, { data: current }] = await Promise.all([
    sb.from("contact_lists").select("id"), sb.from("contact_list_members").select("list_id").eq("contact_id", id.data)]);
  const owned = new Set((lists ?? []).map((l: { id: string }) => l.id)); // RLS: only this user's lists
  const have = new Set((current ?? []).map((m: { list_id: string }) => m.list_id));
  const add = [...wanted].filter((l) => owned.has(l) && !have.has(l)), remove = [...have].filter((l) => !wanted.has(l));
  if (add.length) { const { error } = await sb.from("contact_list_members").insert(add.map((list_id) => ({ list_id, contact_id: id.data, user_id: user.id }))); if (error) return go("error", "Could not update lists.", page); }
  if (remove.length) { const { error } = await sb.from("contact_list_members").delete().eq("contact_id", id.data).in("list_id", remove); if (error) return go("error", "Could not update lists.", page); }
  revalidatePath(BASE);
  return go("notice", "Lists updated.", page);
}

export async function deleteContact(fd: FormData) {
  const { sb, user } = await me();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return go("error", "Invalid contact.");
  const { data, error } = await sb.from("contacts").delete().eq("id", id.data).select("id");
  if (error || !data?.length) return go("error", "Could not delete that contact.");
  await audit(user.id, "contact.deleted", { contact_id: id.data });
  revalidatePath(BASE);
  return go("notice", "Contact deleted.");
}

// ---------- Lists ----------
export async function createList(fd: FormData) {
  const { sb, user } = await me();
  const name = z.string().trim().min(1).max(MAX_LIST_NAME).safeParse(fd.get("name"));
  if (!name.success) return go("error", `Give the list a name (up to ${MAX_LIST_NAME} characters).`);
  const { error } = await sb.from("contact_lists").insert({ user_id: user.id, name: name.data });
  if (error) return go("error", error.code === "23505" ? "You already have a list with that name." : "Could not create the list.");
  revalidatePath(BASE);
  return go("notice", "List created.");
}

export async function deleteList(fd: FormData) {
  const { sb } = await me();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return go("error", "Invalid list.");
  const { error } = await sb.from("contact_lists").delete().eq("id", id.data); // members cascade; contacts stay
  if (error) return go("error", "Could not delete the list.");
  revalidatePath(BASE);
  return go("notice", "List deleted. Its contacts were kept.");
}

// ---------- Personalization check (read-only: renders in memory, sends nothing, stores nothing) ----------
export async function checkTemplate(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  const { sb } = await me();
  const p = z.object({
    list_id: z.union([uuid, z.literal("all")]), subject: z.string().max(300), html: z.string().max(200_000), text: z.string().max(200_000),
  }).safeParse({ list_id: fd.get("list_id"), subject: fd.get("subject") ?? "", html: fd.get("html") ?? "", text: fd.get("text") ?? "" });
  if (!p.success) return { status: "error", message: "Check the subject (max 300 characters) and bodies, and choose a list." };

  const loaded = await loadAudience(sb, p.data.list_id === "all" ? undefined : p.data.list_id);
  if (!loaded.ok) return { status: "error", message: loaded.message };
  const { audience } = loaded;

  const tpl = { subject: p.data.subject, html: p.data.html, text: p.data.text };
  const rows = audience.map((c) => ({ id: c.id, c, data: contactVariables(c) }));
  const report = analyzeAudience(tpl, rows.map((r) => ({ id: r.id, data: r.data })));
  const blockedIds = new Set(report.blockedRecipients.map((b) => b.id));
  const pick = [...rows.filter((r) => !blockedIds.has(r.id)).slice(0, 3), ...rows.filter((r) => blockedIds.has(r.id)).slice(0, 2)];
  const system = { unsubscribe_url: "https://example.invalid/unsubscribe/preview" }; // placeholder; the real link is minted per recipient when sending
  const samples: PreviewSample[] = pick.map(({ c, data }) => {
    const r = renderTemplate(tpl, data, system);
    return r.ok ? { email: c.email, name: c.name, ok: true, subject: r.subject, html: r.html, text: r.text, missing: [], messages: [] } : { email: c.email, name: c.name, ok: false, missing: r.missing, messages: r.messages };
  });
  return { status: "done", report, suppressed: loaded.suppressed, samples };
}
