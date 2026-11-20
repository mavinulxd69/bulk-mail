"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { fetchAllContacts } from "@/lib/contacts/db";
import { contactVariables } from "@/lib/contacts/fields";
import { loadAudience } from "@/lib/compose/audience";
import { marketingIssues, type Notice } from "@/lib/compose/checks";
import { finalizeMessage } from "@/lib/compose/html";
import type { ComposePreviewState, ComposeSample, DraftState, PickerItem, SaveState, TestState } from "@/lib/compose/types";
import { analyzeAudience, renderTemplate } from "@/lib/personalize/engine";
import { SYSTEM_VARIABLES, VAR_NAME_RE } from "@/lib/personalize/variables";
import { MAX_BODY, MAX_CAMPAIGN_NAME, MAX_SUBJECT, TEST_SENDS_PER_DAY } from "@/lib/limits";
import { aiDailyLimit, getAiProvider } from "@/lib/ai";
import { generateEmailDraft } from "@/lib/ai/draft";
import { AiError, TONES } from "@/lib/ai/types";
import { MAX_BRIEF } from "@/lib/ai/prompt";
import { providerFor, type SenderRow } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

const uuid = z.string().uuid();
async function me() { const sb = await createClient(); const { data: { user } } = await sb.auth.getUser(); if (!user) redirect("/login"); return { sb, user }; }
const audit = (user_id: string, action: string, detail: object) => admin().from("audit_logs").insert({ user_id, action, detail });
const go = (path: string, k: "notice" | "error", m: string): never => redirect(`${path}?${k}=${encodeURIComponent(m)}`);

const Content = z.object({ subject: z.string().max(MAX_SUBJECT), html: z.string().max(MAX_BODY), text: z.string().max(MAX_BODY), audience: z.union([uuid, z.literal("all")]) });
const readContent = (fd: FormData) => Content.safeParse({ subject: fd.get("subject") ?? "", html: fd.get("html") ?? "", text: fd.get("text") ?? "", audience: fd.get("audience") ?? "all" });
const TOO_BIG = `Check the subject (max ${MAX_SUBJECT} characters), the message bodies and the audience.`;
const listOf = (a: string) => (a === "all" ? undefined : a);
const nonBlank = (v: unknown) => v != null && String(v).trim() !== "";
const PREVIEW_UNSUB = "https://example.invalid/unsubscribe/preview"; // the real link is minted per recipient when sending (Phase 6)

// ---------- Preview (read-only: renders in memory, sends nothing, stores nothing) ----------
export async function previewCompose(_prev: ComposePreviewState, fd: FormData): Promise<ComposePreviewState> {
  const { sb } = await me();
  const c = readContent(fd);
  if (!c.success) return { status: "error", message: TOO_BIG };
  const loaded = await loadAudience(sb, listOf(c.data.audience));
  if (!loaded.ok) return { status: "error", message: loaded.message };

  const tpl = { subject: c.data.subject, html: c.data.html, text: c.data.text };
  const rows = loaded.audience.map((contact) => ({ contact, data: contactVariables(contact) }));
  const report = analyzeAudience(tpl, rows.map((r) => ({ id: r.contact.id, data: r.data })));
  const needed = report.variables.filter((v) => !(SYSTEM_VARIABLES as readonly string[]).includes(v));
  const isReady = (data: Record<string, string>) => !report.templateErrors.length && needed.every((v) => nonBlank(data[v]));

  const wantEmail = String(fd.get("preview_email") ?? "").trim().toLowerCase();
  const wantId = uuid.safeParse(fd.get("contact_id")).data;
  const byEmail = wantEmail ? rows.find((r) => r.contact.email === wantEmail) : undefined;
  if (wantEmail && !byEmail) return { status: "error", message: "That address isn't in this audience (or is suppressed)." };
  const chosen = byEmail ?? rows.find((r) => r.contact.id === wantId) ?? rows.find((r) => isReady(r.data)) ?? rows[0]!;

  const r = renderTemplate(tpl, chosen.data, { unsubscribe_url: PREVIEW_UNSUB });
  const base = { id: chosen.contact.id, email: chosen.contact.email, name: chosen.contact.name };
  let selected: ComposeSample;
  if (r.ok) {
    const m = finalizeMessage(r);
    selected = { ...base, ok: true, subject: m.subject, html: m.html, text: m.text, textIsGenerated: r.text == null, missing: [], messages: [] };
  } else selected = { ...base, ok: false, missing: r.missing, messages: r.messages };

  const picker: PickerItem[] = rows.slice(0, 200).map(({ contact, data }) => ({ id: contact.id, email: contact.email, name: contact.name, ok: isReady(data) }));
  if (!picker.some((p) => p.id === chosen.contact.id)) picker.unshift({ ...base, ok: selected.ok });

  const notices: Notice[] = [...marketingIssues(tpl, fd.get("is_marketing") === "on")];
  if (loaded.withoutConsent > 0) notices.push({ level: "warning", message: `${loaded.withoutConsent} contact${loaded.withoutConsent === 1 ? " has" : "s have"} no consent record (added before consent tracking). Only email people you are authorized to contact.` });
  return { status: "done", report, suppressed: loaded.suppressed, withoutConsent: loaded.withoutConsent, picker, pickerTruncated: rows.length > 200, selected, notices };
}

// ---------- Save campaign draft ----------
export async function saveCampaignDraft(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { sb, user } = await me();
  const c = readContent(fd);
  if (!c.success) return { status: "error", message: TOO_BIG };
  const meta = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(MAX_CAMPAIGN_NAME), sender_id: z.union([uuid, z.literal("")]) })
    .safeParse({ id: fd.get("campaign_id") || undefined, name: fd.get("name") ?? "", sender_id: fd.get("sender_id") ?? "" });
  if (!meta.success) return { status: "error", message: `Give the campaign a name (up to ${MAX_CAMPAIGN_NAME} characters).` };

  if (meta.data.sender_id) {
    const { data } = await sb.from("sender_accounts").select("id").eq("id", meta.data.sender_id).eq("status", "connected").maybeSingle();
    if (!data) return { status: "error", message: "That sender isn't connected. Pick another or reconnect it." };
  }
  if (c.data.audience !== "all") {
    const { data } = await sb.from("contact_lists").select("id").eq("id", c.data.audience).maybeSingle();
    if (!data) return { status: "error", message: "That list no longer exists." };
  }
  const row = {
    name: meta.data.name, sender_id: meta.data.sender_id || null, subject: c.data.subject, html_body: c.data.html.trim() ? c.data.html : null, text_body: c.data.text.trim() ? c.data.text : null,
    is_marketing: fd.get("is_marketing") === "on", audience: c.data.audience === "all" ? "all" : "list", audience_list_id: c.data.audience === "all" ? null : c.data.audience,
  };
  let id = meta.data.id;
  if (id) {
    const { data, error } = await sb.from("campaigns").update(row).eq("id", id).eq("status", "draft").select("id");
    if (error || !data?.length) return { status: "error", message: "This campaign can't be edited any more (only drafts can)." };
  } else {
    const { data, error } = await sb.from("campaigns").insert({ ...row, user_id: user.id, status: "draft" }).select("id").single();
    if (error || !data) return { status: "error", message: "Could not save the draft. Try again." };
    id = data.id as string;
  }
  await audit(user.id, "campaign.draft_saved", { campaign_id: id });
  revalidatePath("/dashboard/compose");
  return { status: "saved", id, message: "Draft saved. Nothing has been sent." };
}

// ---------- Templates ----------
export async function saveTemplate(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { sb, user } = await me();
  const c = readContent(fd);
  const meta = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(MAX_CAMPAIGN_NAME) }).safeParse({ id: fd.get("template_id") || undefined, name: fd.get("template_name") ?? "" });
  if (!c.success) return { status: "error", message: TOO_BIG };
  if (!meta.success) return { status: "error", message: `Give the template a name (up to ${MAX_CAMPAIGN_NAME} characters).` };
  if (!c.data.subject.trim()) return { status: "error", message: "Add a subject before saving a template." };
  const row = { name: meta.data.name, subject: c.data.subject, html_body: c.data.html.trim() ? c.data.html : null, text_body: c.data.text.trim() ? c.data.text : null };
  let id = meta.data.id;
  if (id) {
    const { data, error } = await sb.from("email_templates").update(row).eq("id", id).select("id");
    if (error?.code === "23505") return { status: "error", message: "You already have a template with that name." };
    if (error || !data?.length) return { status: "error", message: "Could not update that template." };
  } else {
    const { data, error } = await sb.from("email_templates").insert({ ...row, user_id: user.id }).select("id").single();
    if (error?.code === "23505") return { status: "error", message: "You already have a template with that name." };
    if (error || !data) return { status: "error", message: "Could not save the template." };
    id = data.id as string;
  }
  await audit(user.id, "template.saved", { template_id: id });
  revalidatePath("/dashboard/templates");
  return { status: "saved", id, message: "Template saved." };
}

export async function deleteTemplate(fd: FormData) {
  const { sb, user } = await me();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return go("/dashboard/templates", "error", "Invalid template.");
  const { data, error } = await sb.from("email_templates").delete().eq("id", id.data).select("id");
  if (error || !data?.length) return go("/dashboard/templates", "error", "Could not delete that template.");
  await audit(user.id, "template.deleted", { template_id: id.data });
  revalidatePath("/dashboard/templates");
  return go("/dashboard/templates", "notice", "Template deleted.");
}

export async function deleteDraft(fd: FormData) {
  const { sb, user } = await me();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return go("/dashboard/compose", "error", "Invalid draft.");
  const { data, error } = await sb.from("campaigns").delete().eq("id", id.data).eq("status", "draft").select("id");
  if (error || !data?.length) return go("/dashboard/compose", "error", "Could not delete that draft.");
  await audit(user.id, "campaign.draft_deleted", { campaign_id: id.data });
  revalidatePath("/dashboard/compose");
  return go("/dashboard/compose", "notice", "Draft deleted.");
}

// ---------- Test email: a real email, delivered ONLY to the signed-in, verified account owner ----------
const TEST_BANNER_HTML = '<p style="margin:0 0 16px;padding:8px 12px;background:#fff4d6;border:1px solid #e6c36a;border-radius:6px;font:14px Arial,sans-serif">This is a test sent only to you. Each real recipient gets their own copy.</p>';
function sendError(e: unknown): string {
  if (e instanceof ProviderError) {
    if (e.kind === "auth") return "This sender needs to be reconnected on the Sender Accounts page.";
    if (e.kind === "quota") return "The provider's sending limit was reached. Try again later.";
    if (e.kind === "permanent") return "The provider rejected the test message.";
  }
  return "Could not reach the provider. Nothing was confirmed as sent; try again.";
}

export async function sendTest(_prev: TestState, fd: FormData): Promise<TestState> {
  const { sb, user } = await me();
  if (!user.email || !user.email_confirmed_at) return { status: "error", message: "Verify your account email before sending tests." };
  const c = readContent(fd);
  const senderId = uuid.safeParse(fd.get("sender_id"));
  if (!c.success) return { status: "error", message: TOO_BIG };
  if (!senderId.success) return { status: "error", message: "Choose a sender account first." };
  const { data: sender } = await sb.from("sender_accounts").select("id,user_id,provider,from_address,display_name,reply_to,status").eq("id", senderId.data).eq("status", "connected").maybeSingle();
  if (!sender) return { status: "error", message: "That sender isn't connected." };

  const loaded = await loadAudience(sb, listOf(c.data.audience));
  if (!loaded.ok) return { status: "error", message: `A test uses real data from one of your contacts but goes only to you. ${loaded.message}` };
  const wantId = uuid.safeParse(fd.get("contact_id")).data;
  const tpl = { subject: c.data.subject, html: c.data.html, text: c.data.text };
  const pickRows = loaded.audience.map((contact) => ({ contact, data: contactVariables(contact) }));
  const chosen = pickRows.find((r) => r.contact.id === wantId) ?? pickRows.find((r) => renderTemplate(tpl, r.data, { unsubscribe_url: PREVIEW_UNSUB }).ok);
  if (!chosen) return { status: "error", message: "No recipient in this audience can be rendered with this message yet. Run the preview to see what is missing." };
  const r = renderTemplate(tpl, chosen.data, { unsubscribe_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/unsubscribe/test-preview` });
  if (!r.ok) return { status: "error", message: `This recipient can't be rendered: ${r.messages.join(" ")}` };
  const m = finalizeMessage(r);

  const { data: allowed, error: usageErr } = await admin().rpc("claim_usage", { p_user: user.id, p_kind: "test_sends", p_limit: TEST_SENDS_PER_DAY });
  if (usageErr) return { status: "error", message: "Could not check your daily test limit. Try again." };
  if (!allowed) return { status: "error", message: `You've reached today's limit of ${TEST_SENDS_PER_DAY} test emails.` };

  const key = `test_${user.id}_${crypto.randomUUID()}`;
  try {
    const res = await providerFor(sender as SenderRow).send({
      to: user.email, subject: `[Test] ${m.subject}`, text: `[TEST: sent only to you]\n\n${m.text}`, html: m.html ? `${TEST_BANNER_HTML}${m.html}` : undefined,
      from: { name: sender.display_name ?? undefined, address: sender.from_address }, replyTo: sender.reply_to ?? undefined, idempotencyKey: key,
    });
    await audit(user.id, "compose.test_sent", { sender_id: sender.id, simulated: !!res.simulated });
    // Remember "a real test of THIS saved version was sent" (the review screen shows it). Editing the saved content clears it again.
    const cid = uuid.safeParse(fd.get("campaign_id")).data;
    if (cid && !res.simulated) {
      const { data: saved } = await sb.from("campaigns").select("subject,html_body,text_body").eq("id", cid).eq("status", "draft").maybeSingle();
      if (saved && saved.subject === c.data.subject && (saved.html_body ?? "") === c.data.html && (saved.text_body ?? "") === c.data.text)
        await admin().from("campaigns").update({ test_sent_at: new Date().toISOString() }).eq("id", cid).eq("user_id", user.id);
    }
    return { status: "sent", simulated: !!res.simulated, message: res.simulated
      ? `Simulated: development mode is on, so nothing was sent to ${user.email}.`
      : `The provider accepted your test email for ${user.email}. Accepted is not delivered: check your inbox in a minute.` };
  } catch (e) {
    await audit(user.id, "compose.test_failed", { sender_id: sender.id, kind: e instanceof ProviderError ? e.kind : "unknown" });
    return { status: "error", message: sendError(e) };
  }
}

// ---------- AI draft: produces text for the user to review. It cannot send anything. ----------
export async function generateDraft(_prev: DraftState, fd: FormData): Promise<DraftState> {
  const { sb, user } = await me();
  const provider = getAiProvider();
  if (!provider) return { status: "not_configured" };
  const p = z.object({ brief: z.string().trim().min(10).max(MAX_BRIEF), tone: z.enum(TONES), audience: z.union([uuid, z.literal("all")]) })
    .safeParse({ brief: fd.get("brief") ?? "", tone: fd.get("tone") ?? "professional", audience: fd.get("audience") ?? "all" });
  if (!p.success) return { status: "error", message: `Describe the email in 10 to ${MAX_BRIEF} characters.` };

  // Variable NAMES only (never values) are shared with the AI. They come from the user's own contacts, read server-side.
  let sample: { fields: unknown }[] = [];
  try { sample = await fetchAllContacts(sb, { listId: listOf(p.data.audience), max: 200 }); } catch { /* fall back to name/email */ }
  const names = new Set<string>(["name", "email"]);
  for (const s of sample) if (s.fields && typeof s.fields === "object") for (const k of Object.keys(s.fields as object)) if (VAR_NAME_RE.test(k) && names.size < 30) names.add(k);

  const { data: ok, error } = await admin().rpc("claim_usage", { p_user: user.id, p_kind: "ai_drafts", p_limit: aiDailyLimit() });
  if (error) return { status: "error", message: "Could not check your daily AI limit. Try again." };
  if (!ok) return { status: "error", message: `You've used today's ${aiDailyLimit()} AI drafts. Try again tomorrow.` };

  try {
    const draft = await generateEmailDraft(provider, { brief: p.data.brief, tone: p.data.tone, variables: [...names] });
    await audit(user.id, "ai.draft_generated", { tone: p.data.tone, provider: provider.id });
    return { status: "done", draft };
  } catch (e) {
    await audit(user.id, "ai.draft_failed", { code: e instanceof AiError ? e.code : "unknown" });
    return { status: "error", message: e instanceof AiError ? e.message : "Could not write a draft right now." };
  }
}
