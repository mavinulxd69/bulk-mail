"use client";
import { useActionState } from "react";
import { importContacts } from "@/app/dashboard/contacts/actions";
import type { ImportState } from "@/lib/contacts/types";
import { btn, inp } from "@/components/styles";

export function ImportForm({ lists }: { lists: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importContacts, { status: "idle" });
  return (
    <form action={action} className="space-y-4 rounded-xl border border-ink/10 bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium md:col-span-2">Paste addresses or CSV
          <textarea name="paste" rows={6} spellCheck={false} className={`${inp} font-mono text-sm`}
            placeholder={"alex@example.com, john@example.com\n\nor with columns:\nemail,name,boarding_code\nalex@example.com,Alex,BD101"} />
          <span className="mt-1 block text-xs font-normal text-ink/60">Addresses can be separated by lines, commas, semicolons or spaces. For personalization data, start with a header row that includes <code>email</code>.</span>
        </label>
        <label className="block text-sm font-medium">…or upload a CSV file
          <input name="file" type="file" accept=".csv,text/csv,text/plain" className="mt-1 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-mist file:px-3 file:py-1.5" />
          <span className="mt-1 block text-xs font-normal text-ink/60">Up to 2 MB and 5,000 rows. A file replaces the pasted text.</span>
        </label>
        <label className="block text-sm font-medium">Required columns <span className="font-normal text-ink/60">(optional)</span>
          <input name="required" placeholder="boarding_code" className={inp} />
          <span className="mt-1 block text-xs font-normal text-ink/60">Rows missing any of these are rejected, so no one is imported without the data your email needs.</span>
        </label>
        <label className="block text-sm font-medium">Add to list
          <select name="list_id" defaultValue="" className={inp}><option value="">No list</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <label className="block text-sm font-medium">…or create a new list
          <input name="new_list" maxLength={100} placeholder="Flight BD-1" className={inp} />
        </label>
        <label className="block text-sm font-medium md:col-span-2">Where did consent come from?
          <input name="consent_source" required minLength={3} maxLength={200} placeholder="Booking form, Oct 2026" className={inp} />
          <span className="mt-1 block text-xs font-normal text-ink/60">Saved with each contact and the time of import.</span>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="update_existing" className="mt-1" /> Update the name and fields of contacts I already have</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent_ack" required className="mt-1" /> I confirm I am authorized to contact everyone in this import and that they agreed to hear from me.</label>
      <button className={btn} disabled={pending}>{pending ? "Importing…" : "Import contacts"}</button>
      <div aria-live="polite">{state.status === "error" && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{state.message}</p>}
        {state.status === "done" && <Result state={state} />}</div>
    </form>
  );
}

function Result({ state }: { state: Extract<ImportState, { status: "done" }> }) {
  const s = state.summary;
  const rows: [string, number][] = [
    ["New contacts added", s.created], ["Existing contacts updated", s.updated], ["Existing contacts skipped", s.skippedExisting],
    ["Invalid email addresses", s.invalid], ["Duplicates within the import", s.duplicatesInFile], ["Missing a required column", s.missingRequired], ["Other rejected rows", s.otherRejected],
  ];
  return (
    <div className="space-y-3 rounded-lg bg-sky/60 p-4 text-sm">
      <p className="font-medium">Import finished{s.listName ? ` · list “${s.listName}”` : ""}</p>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">{rows.filter(([, n], i) => i < 2 || n > 0).map(([l, n]) => <div key={l} className="flex justify-between"><dt>{l}</dt><dd className="font-medium">{n}</dd></div>)}
        {s.listName && <div className="flex justify-between"><dt>Newly added to the list</dt><dd className="font-medium">{s.addedToList}</dd></div>}</dl>
      {s.alreadySuppressed > 0 && <p>{s.alreadySuppressed} address{s.alreadySuppressed === 1 ? " is" : "es are"} on your suppression list. They were saved but will never be emailed.</p>}
      {state.issues.length > 0 && (
        <details><summary className="cursor-pointer underline">Show rejected rows{state.issuesTruncated ? " (first 100)" : ""}</summary>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="pr-4">Row</th><th className="pr-4">Address</th><th>Problem</th></tr></thead>
            <tbody>{state.issues.map((i, n) => <tr key={n} className="align-top"><td className="pr-4">{i.line}</td><td className="break-all pr-4">{i.email || "(empty)"}</td><td>{i.message}</td></tr>)}</tbody></table></div></details>)}
    </div>
  );
}
