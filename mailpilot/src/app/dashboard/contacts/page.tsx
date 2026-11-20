import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ImportForm } from "@/components/contacts/import-form";
import { TemplateCheck } from "@/components/contacts/template-check";
import { btn, btn2, inp } from "@/components/styles";
import { createList, deleteContact, deleteList } from "./actions";

const PAGE = 50;
type Row = { id: string; email: string; name: string | null; fields: unknown; consented_at: string | null };
type SP = { q?: string; list?: string; page?: string; error?: string; notice?: string };

export default async function Contacts({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sb = await createClient();
  const listId = z.string().uuid().safeParse(sp.list).data;
  const q = (sp.q ?? "").replace(/[^\p{L}\p{N}@._+\- ]/gu, "").trim().slice(0, 60);
  const page = Math.max(1, Math.min(1000, parseInt(sp.page ?? "1", 10) || 1));

  const cols: string = listId ? "id,email,name,fields,consented_at,contact_list_members!inner(list_id)" : "id,email,name,fields,consented_at";
  let query = sb.from("contacts")
    .select(cols, { count: "exact" })
    .order("created_at", { ascending: false }).order("id").range((page - 1) * PAGE, page * PAGE - 1);
  if (listId) query = query.eq("contact_list_members.list_id", listId);
  if (q) query = query.or(`email.ilike."%${q}%",name.ilike."%${q}%"`);

  const [{ data: rawContacts, count, error }, { data: lists }, { data: sample }] = await Promise.all([
    query, sb.from("contact_lists").select("id,name,contact_list_members(count)").order("name"),
    sb.from("contacts").select("fields").order("created_at", { ascending: false }).limit(200)]);
  const contacts = rawContacts as unknown as Row[] | null; // select string is dynamic, so the client cannot infer the row type
  const emails = (contacts ?? []).map((c) => c.email);
  const { data: sup } = emails.length ? await sb.from("suppressions").select("email").in("email", emails) : { data: [] };
  const suppressed = new Set((sup ?? []).map((s: { email: string }) => s.email));
  const variables = [...new Set(["name", "email", ...(sample ?? []).flatMap((c: { fields: unknown }) => Object.keys((c.fields && typeof c.fields === "object" ? c.fields : {}) as object))])].slice(0, 30);
  const listOpts = (lists ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }));
  const total = count ?? 0, pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number) => `/dashboard/contacts?${new URLSearchParams({ ...(q ? { q } : {}), ...(listId ? { list: listId } : {}), page: String(p) })}`;

  return (
    <div className="space-y-12">
      <h1 className="font-display text-3xl font-bold">Contacts</h1>
      {sp.error && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{sp.error}</p>}
      {sp.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{sp.notice}</p>}

      <section aria-labelledby="imp"><h2 id="imp" className="font-display text-xl font-semibold">Add recipients</h2>
        <p className="mb-3 mt-1 max-w-2xl text-sm text-ink/70">Only add people you are authorized to contact. MailPilot records where consent came from and when you imported them.</p>
        <ImportForm lists={listOpts} /></section>

      <section aria-labelledby="lists"><h2 id="lists" className="font-display text-xl font-semibold">Lists</h2>
        <form action={createList} className="mt-3 flex max-w-md items-end gap-3"><label className="flex-1 text-sm font-medium">New list<input name="name" required maxLength={100} placeholder="Flight BD-1" className={inp} /></label><button className={btn}>Create list</button></form>
        {!lists?.length ? <p className="mt-3 text-sm text-ink/70">No lists yet. Lists let you send one campaign to a specific group.</p> :
          <ul className="mt-4 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">{lists.map((l: { id: string; name: string; contact_list_members: { count: number }[] }) => (
            <li key={l.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div><Link href={`/dashboard/contacts?list=${l.id}`} className="font-medium underline">{l.name}</Link><p className="text-sm text-ink/60">{l.contact_list_members[0]?.count ?? 0} contacts</p></div>
              <form action={deleteList}><input type="hidden" name="id" value={l.id} /><button className="text-sm underline">Delete list</button></form></li>))}</ul>}
      </section>

      <section aria-labelledby="all"><h2 id="all" className="font-display text-xl font-semibold">{listId ? `List: ${listOpts.find((l) => l.id === listId)?.name ?? "unknown"}` : "All contacts"} <span className="text-base font-normal text-ink/60">({total})</span></h2>
        <form className="mt-3 flex max-w-xl flex-wrap items-end gap-3" role="search">
          <label className="flex-1 text-sm font-medium">Search<input name="q" defaultValue={q} placeholder="Email or name" className={inp} /></label>
          <label className="text-sm font-medium">List<select name="list" defaultValue={listId ?? ""} className={inp}><option value="">Any</option>{listOpts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <button className={btn2}>Filter</button></form>
        {error ? <p role="alert" className="mt-4 text-sm text-post">Could not load contacts. Try again.</p> : !contacts?.length ?
          <p className="mt-4 rounded-lg border border-dashed border-ink/30 p-4 text-sm">{q || listId ? "No contacts match this filter." : "No contacts yet. Paste addresses or upload a CSV above."}</p> :
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white"><table className="w-full text-left text-sm">
            <thead className="border-b border-ink/10"><tr><th className="px-4 py-2">Email</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Fields</th><th className="px-4 py-2">Consent recorded</th><th className="px-4 py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-ink/10">{contacts.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="px-4 py-2 break-all">{c.email}{suppressed.has(c.email) && <span className="ml-2 rounded-full bg-post/10 px-2 py-0.5 text-xs text-post">Suppressed</span>}</td>
                <td className="px-4 py-2">{c.name ?? <span className="text-ink/40">—</span>}</td>
                <td className="px-4 py-2 text-ink/70">{Object.keys((c.fields && typeof c.fields === "object" ? c.fields : {}) as object).join(", ") || "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap text-ink/70">{c.consented_at ? new Date(c.consented_at).toISOString().slice(0, 10) : "Not recorded"}</td>
                <td className="px-4 py-2 whitespace-nowrap text-right"><Link href={`/dashboard/contacts/${c.id}`} className="underline">Edit</Link>
                  <form action={deleteContact} className="ml-3 inline"><input type="hidden" name="id" value={c.id} /><button className="underline">Delete</button></form></td></tr>))}</tbody></table></div>}
        {pages > 1 && <nav aria-label="Pagination" className="mt-4 flex items-center gap-4 text-sm">
          {page > 1 ? <Link className="underline" href={href(page - 1)}>Previous</Link> : <span className="text-ink/40">Previous</span>}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link className="underline" href={href(page + 1)}>Next</Link> : <span className="text-ink/40">Next</span>}</nav>}
      </section>

      <section aria-labelledby="chk"><h2 id="chk" className="font-display text-xl font-semibold">Personalization check</h2>
        <p className="mb-3 mt-1 max-w-2xl text-sm text-ink/70">Test a subject and message against your real contacts. MailPilot shows exactly who would be blocked for missing data and previews individual emails.</p>
        <TemplateCheck lists={listOpts} variables={variables} /></section>
    </div>
  );
}
