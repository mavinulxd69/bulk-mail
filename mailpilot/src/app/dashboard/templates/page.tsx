import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteTemplate } from "../compose/actions";

export default async function Templates({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { data: templates, error } = await (await createClient()).from("email_templates").select("id,name,subject,updated_at").order("updated_at", { ascending: false }).limit(200);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-bold">Templates</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink/70">Reusable subjects and messages with variables. Open one in the composer to use or change it.</p></div>
        <Link href="/dashboard/compose" className="rounded-full bg-ink px-4 py-2 text-sm text-white">New email</Link>
      </div>
      {sp.error && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{sp.error}</p>}
      {sp.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{sp.notice}</p>}
      {error ? <p role="alert" className="text-sm text-post">Could not load templates. Try again.</p> : !templates?.length ?
        <p className="rounded-lg border border-dashed border-ink/30 p-4 text-sm">No templates yet. Write an email in <Link href="/dashboard/compose" className="underline">Compose</Link> and choose &ldquo;Save as template&rdquo;.</p> :
        <ul className="divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">{templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0"><p className="font-medium">{t.name}</p><p className="truncate text-sm text-ink/60">{t.subject}</p></div>
            <div className="flex shrink-0 items-center gap-4 text-sm"><Link href={`/dashboard/compose?template=${t.id}`} className="underline">Use</Link>
              <form action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><button className="underline">Delete</button></form></div></li>))}</ul>}
    </div>
  );
}
