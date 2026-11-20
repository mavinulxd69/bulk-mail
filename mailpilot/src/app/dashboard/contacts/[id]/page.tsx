import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formatFieldLines } from "@/lib/contacts/fields";
import { btn, inp } from "@/components/styles";
import { setMemberships, updateContact } from "../actions";

export default async function EditContact({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([params, searchParams]);
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) notFound();
  const sb = await createClient();
  const { data: c } = await sb.from("contacts").select("id,email,name,fields,consent_source,consented_at,created_at").eq("id", id.data!).maybeSingle();
  if (!c) notFound(); // also what another tenant's id returns: RLS hides it
  const [{ data: lists }, { data: mine }, { data: events }, { data: sup }] = await Promise.all([
    sb.from("contact_lists").select("id,name").order("name"), sb.from("contact_list_members").select("list_id").eq("contact_id", c.id),
    sb.from("consent_events").select("event,source,created_at").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(20),
    sb.from("suppressions").select("reason").eq("email", c.email).maybeSingle()]);
  const member = new Set((mine ?? []).map((m: { list_id: string }) => m.list_id));
  return (
    <div className="max-w-2xl space-y-10">
      <div><Link href="/dashboard/contacts" className="text-sm underline">Back to contacts</Link><h1 className="mt-2 break-all font-display text-3xl font-bold">{c.email}</h1></div>
      {sp.error && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{sp.error}</p>}
      {sp.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{sp.notice}</p>}
      {sup && <p className="rounded-lg bg-post/10 p-3 text-sm text-post">This address is on your suppression list ({sup.reason}). It will never be emailed.</p>}

      <form action={updateContact} className="space-y-4 rounded-xl border border-ink/10 bg-white p-5"><input type="hidden" name="id" value={c.id} />
        <label className="block text-sm font-medium">Email<input value={c.email} readOnly aria-describedby="em" className={`${inp} bg-mist`} /><span id="em" className="mt-1 block text-xs font-normal text-ink/60">Addresses can't be changed because consent is tied to them. Delete the contact and add the new address instead.</span></label>
        <label className="block text-sm font-medium">Name<input name="name" defaultValue={c.name ?? ""} maxLength={200} className={inp} /></label>
        <label className="block text-sm font-medium">Custom fields<textarea name="fields" rows={6} defaultValue={formatFieldLines(c.fields)} spellCheck={false} className={`${inp} font-mono text-sm`} />
          <span className="mt-1 block text-xs font-normal text-ink/60">One per line, like <code>boarding_code: BD101</code>. Use them in emails as {"{{boarding_code}}"}. A blank value counts as missing.</span></label>
        <button className={btn}>Save changes</button></form>

      <section><h2 className="font-display text-xl font-semibold">Lists</h2>
        {!lists?.length ? <p className="mt-2 text-sm text-ink/70">You have no lists yet. Create one on the Contacts page.</p> :
          <form action={setMemberships} className="mt-3 space-y-2 rounded-xl border border-ink/10 bg-white p-5"><input type="hidden" name="id" value={c.id} />
            {lists.map((l: { id: string; name: string }) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="list_ids" value={l.id} defaultChecked={member.has(l.id)} /> {l.name}</label>)}
            <button className={`${btn} mt-2`}>Save lists</button></form>}</section>

      <section><h2 className="font-display text-xl font-semibold">Consent</h2>
        <p className="mt-2 text-sm">{c.consent_source ? <>Source: {c.consent_source}. Recorded {new Date(c.consented_at).toISOString().replace("T", " ").slice(0, 16)} UTC.</> : "No consent source was recorded for this contact."}</p>
        {events?.length ? <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white text-sm">{events.map((e: { event: string; source: string | null; created_at: string }, i: number) => <li key={i} className="flex justify-between gap-4 px-4 py-2"><span>{e.event}{e.source ? ` · ${e.source}` : ""}</span><span className="text-ink/60">{new Date(e.created_at).toISOString().slice(0, 10)}</span></li>)}</ul> : null}</section>
    </div>
  );
}
