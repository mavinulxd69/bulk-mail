"use client";
import { useActionState } from "react";
import { checkTemplate } from "@/app/dashboard/contacts/actions";
import type { PreviewState } from "@/lib/contacts/types";
import { btn, inp } from "@/components/styles";

const DEFAULTS = {
  subject: "Your Boarding Confirmation - {{name}}",
  html: "<p>Hello {{name}},</p>\n<p>Your boarding details are ready.</p>\n<p>Your boarding code is: <b>{{boarding_code}}</b></p>\n<p>Thank you.</p>",
  text: "Hello {{name}},\n\nYour boarding details are ready.\n\nYour boarding code is: {{boarding_code}}\n\nThank you.",
};

export function TemplateCheck({ lists, variables }: { lists: { id: string; name: string }[]; variables: string[] }) {
  const [state, action, pending] = useActionState<PreviewState, FormData>(checkTemplate, { status: "idle" });
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4 rounded-xl border border-ink/10 bg-white p-5">
        <p className="text-sm text-ink/70">Variables you can use: {variables.map((v) => <code key={v} className="mr-1.5 rounded bg-mist px-1.5 py-0.5">{`{{${v}}}`}</code>)}</p>
        <label className="block text-sm font-medium">Check against
          <select name="list_id" defaultValue="all" className={inp}><option value="all">All contacts</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="block text-sm font-medium">Subject<input name="subject" defaultValue={DEFAULTS.subject} maxLength={300} className={inp} /></label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">HTML body<textarea name="html" rows={7} defaultValue={DEFAULTS.html} spellCheck={false} className={`${inp} font-mono text-sm`} /></label>
          <label className="block text-sm font-medium">Plain-text body<textarea name="text" rows={7} defaultValue={DEFAULTS.text} spellCheck={false} className={`${inp} font-mono text-sm`} /></label>
        </div>
        <button className={btn} disabled={pending}>{pending ? "Checking…" : "Check personalization"}</button>
        <p className="text-xs text-ink/60">This renders in memory only. Nothing is sent or saved.</p>
      </form>
      <div aria-live="polite">
        {state.status === "error" && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{state.message}</p>}
        {state.status === "done" && <Report state={state} />}
      </div>
    </div>
  );
}

function Report({ state }: { state: Extract<PreviewState, { status: "done" }> }) {
  const r = state.report;
  const bad = r.templateErrors.length > 0 || r.blocked > 0;
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 text-sm ${bad ? "border-post/40 bg-post/5" : "border-ink/10 bg-sky/50"}`}>
        <p className="font-medium">{r.templateErrors.length ? "Fix the template before sending." : r.blocked ? `${r.blocked} of ${r.total} recipients can't be sent this email yet.` : `All ${r.total} recipients are ready.`}</p>
        {state.suppressed > 0 && <p className="mt-1 text-ink/70">{state.suppressed} suppressed contact{state.suppressed === 1 ? " was" : "s were"} left out. They are never emailed.</p>}
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {r.templateErrors.map((e, i) => <li key={i}>{e.part === "template" ? "" : `${e.part}: `}{e.message}</li>)}
          {Object.entries(r.missingByVariable).filter(([, n]) => n > 0).map(([v, n]) => (
            <li key={v}><code>{`{{${v}}}`}</code> is empty for {n} recipient{n === 1 ? "" : "s"}.{r.unknownVariables.includes(v) ? ` No contact has this field${r.suggestions[v] ? `. Did you mean {{${r.suggestions[v]}}}?` : "."}` : ""}</li>))}
        </ul>
        {r.blocked > 0 && !r.templateErrors.length && <p className="mt-2 text-ink/70">Blocked recipients are never sent a partly filled-in email. Fix their data or remove them from the list.</p>}
      </div>
      {state.samples.map((s) => (
        <article key={s.email} className="rounded-xl border border-ink/10 bg-white p-4 text-sm">
          <p className="text-xs text-ink/60">To: {s.email} (only this recipient) · {s.ok ? "Ready" : <span className="text-post">Blocked{s.missing.length ? `: missing ${s.missing.join(", ")}` : `: ${s.messages.join(" ")}`}</span>}</p>
          {s.ok && <>
            <p className="mt-1 font-display text-lg font-semibold">{s.subject}</p>
            {s.html && <iframe title={`HTML preview for ${s.email}`} sandbox="" srcDoc={s.html} className="mt-3 h-52 w-full rounded-lg border border-ink/10 bg-white" />}
            {s.text && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-mist p-3 font-sans text-sm">{s.text}</pre>}
          </>}
        </article>))}
    </div>
  );
}
