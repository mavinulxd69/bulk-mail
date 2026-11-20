"use client";
import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { generateDraft, previewCompose, saveCampaignDraft, saveTemplate, sendTest } from "@/app/dashboard/compose/actions";
import { marketingIssues } from "@/lib/compose/checks";
import { htmlToText, textToHtml } from "@/lib/compose/html";
import type { ComposePreviewState, DraftState, SaveState, TestState } from "@/lib/compose/types";
import { TONES, TONE_LABELS, type EmailDraft } from "@/lib/ai/types";
import { validateTemplate } from "@/lib/personalize/engine";
import { SYSTEM_VARIABLES } from "@/lib/personalize/variables";
import { btn, btn2, inp } from "@/components/styles";

export type ComposerInitial = {
  campaignId: string | null; templateId: string | null; templateName: string; name: string; senderId: string;
  audience: string; isMarketing: boolean; subject: string; html: string; text: string;
};
type Props = {
  initial: ComposerInitial; senders: { id: string; label: string }[]; lists: { id: string; name: string; count: number }[];
  variables: string[]; aiEnabled: boolean; aiDailyLimit: number; mockMode: boolean;
};
type Field = "subject" | "html" | "text";

const EXAMPLE = {
  subject: "Your Boarding Confirmation - {{name}}",
  html: "<p>Hello {{name}},</p>\n<p>Your boarding details are ready.</p>\n<p>Your boarding code is: <b>{{boarding_code}}</b></p>\n<p>Thank you.</p>",
  text: "Hello {{name}},\n\nYour boarding details are ready.\n\nYour boarding code is: {{boarding_code}}\n\nThank you.",
};
const card = "space-y-4 rounded-xl border border-ink/10 bg-white p-5";
const idle = { status: "idle" } as const;

function Alert({ kind, children }: { kind: "error" | "warning" | "ok"; children: React.ReactNode }) {
  const c = kind === "error" ? "bg-post/10 text-post" : kind === "warning" ? "bg-amber-50 text-amber-900" : "bg-sky";
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${c}`}>{children}</p>;
}

export function Composer({ initial, senders, lists, variables, aiEnabled, aiDailyLimit, mockMode }: Props) {
  const [name, setName] = useState(initial.name);
  const [senderId, setSenderId] = useState(initial.senderId);
  const [audience, setAudience] = useState(initial.audience);
  const [marketing, setMarketing] = useState(initial.isMarketing);
  const [msg, setMsg] = useState({ subject: initial.subject, html: initial.html, text: initial.text });
  const [campaignId, setCampaignId] = useState(initial.campaignId);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [templateName, setTemplateName] = useState(initial.templateName);
  const [focused, setFocused] = useState<Field>("html");
  const [previewKey, setPreviewKey] = useState("");
  const [applied, setApplied] = useState<EmailDraft | null>(null);
  const refs = { subject: useRef<HTMLInputElement>(null), html: useRef<HTMLTextAreaElement>(null), text: useRef<HTMLTextAreaElement>(null) };

  const [preview, previewAction, previewing] = useActionState<ComposePreviewState, FormData>(previewCompose, idle);
  const [saved, saveAction, saving] = useActionState<SaveState, FormData>(async (p, fd) => { const r = await saveCampaignDraft(p, fd); if (r.status === "saved") setCampaignId(r.id); return r; }, idle);
  const [tplSaved, tplAction, tplSaving] = useActionState<SaveState, FormData>(async (p, fd) => { const r = await saveTemplate(p, fd); if (r.status === "saved") setTemplateId(r.id); return r; }, idle);
  const [test, testAction, testing] = useActionState<TestState, FormData>(sendTest, idle);
  const [ai, aiAction, aiBusy] = useActionState<DraftState, FormData>(generateDraft, idle);

  const known = useMemo(() => new Set<string>([...variables, ...SYSTEM_VARIABLES]), [variables]);
  const check = useMemo(() => validateTemplate(msg), [msg]);
  const unknown = check.variables.filter((v) => !known.has(v));
  const mkt = useMemo(() => marketingIssues(msg, marketing), [msg, marketing]);
  const audienceBroken = audience === "missing";
  const hasBody = !!(msg.html.trim() || msg.text.trim());
  const snapshot = JSON.stringify([msg, audience, marketing]);

  function insert(token: string) {
    const el = refs[focused].current, val = msg[focused];
    const s = el?.selectionStart ?? val.length, e = el?.selectionEnd ?? val.length;
    setMsg((m) => ({ ...m, [focused]: val.slice(0, s) + token + val.slice(e) }));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + token.length, s + token.length); });
  }
  const addUnsubscribe = () => setMsg((m) => ({
    ...m,
    html: m.html.trim() ? `${m.html.trimEnd()}\n<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>` : m.html,
    text: m.text.trim() ? `${m.text.trimEnd()}\n\nUnsubscribe: {{unsubscribe_url}}` : m.text,
  }));
  const field = (f: Field) => ({ name: f, value: msg[f], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setMsg((m) => ({ ...m, [f]: e.target.value })), onFocus: () => setFocused(f) });

  return (
    <div className="space-y-6">
      {mockMode && <Alert kind="warning">Development mode: the mock provider is on. Test emails are simulated and nothing is ever sent.</Alert>}

      <section aria-labelledby="ai-h" className={card}>
        <h2 id="ai-h" className="font-display text-xl font-semibold">Draft with AI <span className="text-sm font-normal text-ink/60">(optional)</span></h2>
        {!aiEnabled ? (
          <p className="rounded-lg border border-dashed border-ink/30 p-3 text-sm">AI drafting isn&apos;t configured on this server. Set <code>AI_PROVIDER</code> and <code>AI_API_KEY</code> (see README). You can still write your email below.</p>
        ) : (
          <form action={aiAction} className="space-y-3">
            <input type="hidden" name="audience" value={audience === "missing" ? "all" : audience} />
            <label className="block text-sm font-medium">What should the email say?
              <textarea name="brief" rows={3} maxLength={1000} required minLength={10} className={inp} placeholder="Write a professional boarding confirmation email. Include the recipient's name and boarding code." />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">Tone
                <select name="tone" defaultValue="professional" className={inp}>{TONES.map((t) => <option key={t} value={t}>{TONE_LABELS[t]}</option>)}</select></label>
              <button className={btn} disabled={aiBusy}>{aiBusy ? "Writing…" : "Write a draft"}</button>
            </div>
            <p className="text-xs text-ink/60">The AI only writes a draft for you to review; it never sends anything. Only your instructions and variable names (like {"{{name}}"}) are shared with the AI provider, never your contacts&apos; data. Limit: {aiDailyLimit} drafts a day.</p>
          </form>
        )}
        <div aria-live="polite" className="space-y-3">
          {ai.status === "error" && <Alert kind="error">{ai.message}</Alert>}
          {ai.status === "done" && (
            <div className="space-y-3 rounded-lg border border-ink/15 p-4">
              <p className="text-xs uppercase tracking-wide text-ink/60">AI draft (not saved, not sent)</p>
              <p className="font-display text-lg font-semibold">{ai.draft.subject}</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-mist p-3 font-sans text-sm">{ai.draft.text}</pre>
              {ai.draft.warnings.map((w, i) => <Alert key={i} kind={w.level === "error" ? "error" : "warning"}>{w.message}</Alert>)}
              {applied === ai.draft ? <p className="text-sm">Draft applied below. Edit it freely.</p> : (
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={btn} onClick={() => { setMsg({ subject: ai.draft.subject, html: ai.draft.html, text: ai.draft.text }); setApplied(ai.draft); }}>Use this draft</button>
                  <span className="self-center text-xs text-ink/60">{hasBody || msg.subject ? "This replaces the subject and both bodies below." : ""}</span>
                </div>)}
            </div>)}
          {ai.status === "not_configured" && <Alert kind="warning">AI drafting isn&apos;t configured on this server.</Alert>}
        </div>
      </section>

      <form className="space-y-6">
        <input type="hidden" name="campaign_id" value={campaignId ?? ""} />
        <input type="hidden" name="template_id" value={templateId ?? ""} />

        <section aria-labelledby="d-h" className={card}>
          <h2 id="d-h" className="font-display text-xl font-semibold">Details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Campaign name<input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Flight BD-1 boarding" className={inp} /></label>
            <label className="block text-sm font-medium">Send from
              <select name="sender_id" value={senderId} onChange={(e) => setSenderId(e.target.value)} className={inp}>
                <option value="">{senders.length ? "Choose a sender…" : "No connected sender"}</option>{senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              {!senders.length && <span className="mt-1 block text-xs font-normal text-ink/70"><Link href="/dashboard/senders" className="underline">Connect a sender</Link> to send test emails and campaigns.</span>}
            </label>
            <label className="block text-sm font-medium">Recipients
              <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)} className={inp}>
                {audienceBroken && <option value="missing" disabled>The list for this draft was deleted. Choose another.</option>}
                <option value="all">All contacts</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}</select>
              {audienceBroken && <span className="mt-1 block text-xs font-normal text-post">Pick a list or &ldquo;All contacts&rdquo; to continue.</span>}
            </label>
            <label className="flex items-start gap-2 self-end text-sm"><input type="checkbox" name="is_marketing" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-1" />
              <span><span className="font-medium">This is a marketing or promotional email</span><span className="block text-xs text-ink/60">Requires an unsubscribe link. Unsubscribes and complaints are honored automatically.</span></span></label>
          </div>
        </section>

        <section aria-labelledby="m-h" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="m-h" className="font-display text-xl font-semibold">Message</h2>
            <button type="button" className="text-sm underline" onClick={() => setMsg(EXAMPLE)}>Load the boarding example</button>
          </div>
          <div>
            <p className="text-sm font-medium" id="vars-l">Variables <span className="font-normal text-ink/60">(click to insert where your cursor is)</span></p>
            <div role="group" aria-labelledby="vars-l" className="mt-2 flex flex-wrap gap-1.5">
              {[...variables, ...SYSTEM_VARIABLES].map((v) => (
                <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{{${v}}}`)} className="rounded-full bg-mist px-2.5 py-1 font-mono text-xs hover:bg-sky">{`{{${v}}}`}</button>))}
            </div>
            <p className="mt-2 text-xs text-ink/60">Variables come from your contacts&apos; columns. <code>{"{{unsubscribe_url}}"}</code> is filled in by MailPilot for each recipient. A recipient with any empty variable is skipped, never sent a half-filled email.</p>
          </div>
          <label className="block text-sm font-medium">Subject<input ref={refs.subject} {...field("subject")} maxLength={300} placeholder="Your Boarding Confirmation - {{name}}" className={inp} /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">HTML body<textarea ref={refs.html} {...field("html")} rows={12} spellCheck={false} className={`${inp} font-mono text-sm`} /></label>
            <label className="block text-sm font-medium">Plain-text body<textarea ref={refs.text} {...field("text")} rows={12} spellCheck={false} className={`${inp} font-mono text-sm`} /></label>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <button type="button" className={btn2} disabled={!msg.html.trim()} onClick={() => setMsg((m) => ({ ...m, text: htmlToText(m.html) }))}>Make plain text from HTML</button>
            <button type="button" className={btn2} disabled={!msg.text.trim()} onClick={() => setMsg((m) => ({ ...m, html: textToHtml(m.text) }))}>Make HTML from plain text</button>
          </div>
          <div aria-live="polite" className="space-y-2">
            {check.errors.map((e, i) => <Alert key={i} kind="error">{e.part === "template" ? "" : `${e.part}: `}{e.message}</Alert>)}
            {unknown.length > 0 && <Alert kind="warning">No contact has {unknown.map((v) => `{{${v}}}`).join(", ")} yet. Recipients without a value are skipped. {unknown.length === 1 ? "Check the spelling or add the column to your contacts." : "Check the spelling or add the columns to your contacts."}</Alert>}
            {mkt.map((n, i) => <Alert key={i} kind="error">{n.message} <button type="button" className="underline" onClick={addUnsubscribe}>Add it for me</button></Alert>)}
          </div>
        </section>

        <section aria-labelledby="p-h" className={card}>
          <h2 id="p-h" className="font-display text-xl font-semibold">Preview</h2>
          <p className="text-sm text-ink/70">See exactly what one recipient would receive, and who would be skipped for missing data. Previewing sends and saves nothing.</p>
          <div className="flex flex-wrap items-end gap-3">
            {preview.status === "done" && (
              <>
                <label className="text-sm font-medium">Recipient
                  <select name="contact_id" defaultValue={preview.selected?.id} key={preview.selected?.id} className={inp}>
                    {preview.picker.map((p) => <option key={p.id} value={p.id}>{p.email}{p.ok ? "" : " (blocked)"}</option>)}</select></label>
                {preview.pickerTruncated && <label className="text-sm font-medium">…or type an address<input name="preview_email" type="email" className={inp} placeholder="alex@example.com" /></label>}
              </>)}
            <button type="submit" formAction={previewAction} onClick={() => setPreviewKey(snapshot)} className={btn} disabled={previewing || audienceBroken}>{previewing ? "Checking…" : preview.status === "done" ? "Refresh preview" : "Preview recipients"}</button>
          </div>
          <div aria-live="polite" className="space-y-3">
            {preview.status === "error" && <Alert kind="error">{preview.message}</Alert>}
            {preview.status === "done" && <PreviewResult p={preview} stale={previewKey !== snapshot} />}
          </div>
        </section>

        <section aria-labelledby="a-h" className={card}>
          <h2 id="a-h" className="font-display text-xl font-semibold">Save or test</h2>
          <div className="flex flex-wrap gap-3">
            <button type="submit" formAction={saveAction} className={btn} disabled={saving || audienceBroken}>{saving ? "Saving…" : campaignId ? "Save changes" : "Save as draft"}</button>
            <button type="submit" formAction={testAction} className={btn2} disabled={testing || !senderId || !hasBody || audienceBroken}>{testing ? "Sending…" : "Send a test to me"}</button>
          </div>
          <p className="text-xs text-ink/60">A test is a real email with real data from one contact, sent only to your own verified address. Choose the recipient in the preview. To send a campaign, save it as a draft, open its review page, and explicitly confirm sending.</p>
          <div aria-live="polite" className="space-y-2">
            {saved.status === "error" && <Alert kind="error">{saved.message}</Alert>}
            {saved.status === "saved" && <Alert kind="ok">{saved.message} <Link href={`/dashboard/campaigns/${saved.id}`} className="underline">Review &amp; approve →</Link></Alert>}
            {test.status === "error" && <Alert kind="error">{test.message}</Alert>}
            {test.status === "sent" && <Alert kind={test.simulated ? "warning" : "ok"}>{test.message}</Alert>}
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-ink/10 pt-4">
            <label className="text-sm font-medium">Template name<input name="template_name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={120} placeholder="Boarding confirmation" className={inp} /></label>
            <button type="submit" formAction={tplAction} className={btn2} disabled={tplSaving}>{templateId ? "Update template" : "Save as template"}</button>
            {templateId && <button type="button" className="text-sm underline" onClick={() => setTemplateId(null)}>Save as a new template instead</button>}
          </div>
          <div aria-live="polite">
            {tplSaved.status === "error" && <Alert kind="error">{tplSaved.message}</Alert>}
            {tplSaved.status === "saved" && <Alert kind="ok">{tplSaved.message}</Alert>}
          </div>
        </section>
      </form>
    </div>
  );
}

function PreviewResult({ p, stale }: { p: Extract<ComposePreviewState, { status: "done" }>; stale: boolean }) {
  const r = p.report, bad = r.templateErrors.length > 0 || r.blocked > 0, s = p.selected;
  return (
    <div className="space-y-3">
      {stale && <Alert kind="warning">You&apos;ve edited the message since this preview. Refresh it to see the latest.</Alert>}
      <div className={`rounded-xl border p-4 text-sm ${bad ? "border-post/40 bg-post/5" : "border-ink/10 bg-sky/50"}`}>
        <p className="font-medium">{r.templateErrors.length ? "Fix the message before sending." : r.blocked ? `${r.ready} ready, ${r.blocked} skipped for missing data (of ${r.total}).` : `All ${r.total} recipients are ready.`}</p>
        {p.suppressed > 0 && <p className="mt-1 text-ink/70">{p.suppressed} suppressed contact{p.suppressed === 1 ? " was" : "s were"} left out. They are never emailed.</p>}
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {r.templateErrors.map((e, i) => <li key={i}>{e.part === "template" ? "" : `${e.part}: `}{e.message}</li>)}
          {Object.entries(r.missingByVariable).filter(([, n]) => n > 0).map(([v, n]) => (
            <li key={v}><code>{`{{${v}}}`}</code> is empty for {n} recipient{n === 1 ? "" : "s"}.{r.unknownVariables.includes(v) ? ` No contact has this field${r.suggestions[v] ? `. Did you mean {{${r.suggestions[v]}}}?` : "."}` : ""}</li>))}
        </ul>
        {r.blocked > 0 && !r.templateErrors.length && <p className="mt-2 text-ink/70">Skipped recipients are never sent a partly filled-in email. Fix their data or remove them from the list.</p>}
      </div>
      {p.notices.map((n, i) => <Alert key={i} kind={n.level === "error" ? "error" : "warning"}>{n.message}</Alert>)}
      {s && (
        <article className="rounded-xl border border-ink/10 p-4 text-sm">
          <p className="text-xs text-ink/60">To: {s.email} (only this recipient) · {s.ok ? "Ready" : <span className="text-post">Blocked{s.missing.length ? `: missing ${s.missing.join(", ")}` : `: ${s.messages.join(" ")}`}</span>}</p>
          {s.ok && <>
            <p className="mt-1 font-display text-lg font-semibold">{s.subject}</p>
            {s.html && <iframe title={`HTML preview for ${s.email}`} sandbox="" referrerPolicy="no-referrer" srcDoc={s.html} className="mt-3 h-64 w-full rounded-lg border border-ink/10 bg-white" />}
            {s.text && <><p className="mt-3 text-xs text-ink/60">Plain-text version{s.textIsGenerated ? " (generated from the HTML, since you didn't write one)" : ""}</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-mist p-3 font-sans text-sm">{s.text}</pre></>}
          </>}
        </article>)}
    </div>
  );
}
