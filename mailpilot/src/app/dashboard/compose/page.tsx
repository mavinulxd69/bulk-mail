import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { Composer, type ComposerInitial } from "@/components/compose/composer";
import { aiConfigured, aiDailyLimit } from "@/lib/ai";
import { mockEnabled } from "@/lib/providers";
import { SYSTEM_VARIABLES } from "@/lib/personalize/variables";
import { btn2 } from "@/components/styles";
import { deleteDraft } from "./actions";

type SP = { campaign?: string; template?: string; notice?: string; error?: string };
const blank: ComposerInitial = { campaignId: null, templateId: null, templateName: "", name: "", senderId: "", audience: "all", isMarketing: false, subject: "", html: "", text: "" };

export default async function Compose({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sb = await createClient();
  const campaignId = z.string().uuid().safeParse(sp.campaign).data;
  const templateId = z.string().uuid().safeParse(sp.template).data;

  const [{ data: senders }, { data: lists }, { data: sample }, { data: drafts }] = await Promise.all([
    sb.from("sender_accounts").select("id,provider,from_address,display_name").eq("status", "connected").order("created_at"),
    sb.from("contact_lists").select("id,name,contact_list_members(count)").order("name"),
    sb.from("contacts").select("fields").order("created_at", { ascending: false }).limit(200),
    sb.from("campaigns").select("id,name,updated_at").eq("status", "draft").order("updated_at", { ascending: false }).limit(20)]);

  let initial = blank, loadError: string | null = null;
  if (campaignId) {
    const { data: c } = await sb.from("campaigns").select("id,name,sender_id,subject,html_body,text_body,is_marketing,status,audience,audience_list_id").eq("id", campaignId).maybeSingle();
    if (!c) loadError = "That draft wasn't found.";
    else if (c.status !== "draft") loadError = "Only drafts can be edited here.";
    else initial = {
      ...blank, campaignId: c.id, name: c.name, subject: c.subject, html: c.html_body ?? "", text: c.text_body ?? "", isMarketing: c.is_marketing,
      senderId: (senders ?? []).some((s) => s.id === c.sender_id) ? (c.sender_id as string) : "",
      audience: c.audience === "all" ? "all" : c.audience_list_id ?? "missing", // a deleted list never silently becomes "all contacts"
    };
  } else if (templateId) {
    const { data: t } = await sb.from("email_templates").select("id,name,subject,html_body,text_body").eq("id", templateId).maybeSingle();
    if (!t) loadError = "That template wasn't found.";
    else initial = { ...blank, templateId: t.id, templateName: t.name, subject: t.subject, html: t.html_body ?? "", text: t.text_body ?? "" };
  }

  const variables = [...new Set(["name", "email", ...(sample ?? []).flatMap((c: { fields: unknown }) => Object.keys((c.fields && typeof c.fields === "object" ? c.fields : {}) as object))])]
    .filter((v) => !(SYSTEM_VARIABLES as readonly string[]).includes(v)).slice(0, 30);
  const listOpts = (lists ?? []).map((l: { id: string; name: string; contact_list_members: { count: number }[] }) => ({ id: l.id, name: l.name, count: l.contact_list_members[0]?.count ?? 0 }));
  const senderOpts = (senders ?? []).map((s) => ({ id: s.id, label: `${s.display_name ? `${s.display_name} <${s.from_address}>` : s.from_address} · ${s.provider === "gmail" ? "Gmail" : "Business"}` }));
  const err = sp.error ?? loadError;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-bold">Compose Email</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink/70">Write one message with variables. MailPilot renders a separate email for each recipient and never shows anyone else&apos;s address.</p></div>
        {(campaignId || templateId) && <Link href="/dashboard/compose" className={btn2}>Start a new email</Link>}
      </div>
      {err && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{err}</p>}
      {sp.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{sp.notice}</p>}
      {!listOpts.length && !(sample ?? []).length && <p className="rounded-lg border border-dashed border-ink/30 p-3 text-sm">You have no contacts yet. <Link href="/dashboard/contacts" className="underline">Add recipients</Link> to preview personalization.</p>}

      <Composer key={`${initial.campaignId}-${initial.templateId}`} initial={initial} senders={senderOpts} lists={listOpts} variables={variables}
        aiEnabled={aiConfigured()} aiDailyLimit={aiDailyLimit()} mockMode={mockEnabled()} />

      <section aria-labelledby="dr-h"><h2 id="dr-h" className="font-display text-xl font-semibold">Your drafts</h2>
        {!drafts?.length ? <p className="mt-2 text-sm text-ink/70">No saved drafts yet. Drafts are saved campaigns that haven&apos;t been sent. Saving one never sends anything.</p> :
          <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">{drafts.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div><Link href={`/dashboard/compose?campaign=${d.id}`} className="font-medium underline">{d.name}</Link><p className="text-sm text-ink/60">Edited {new Date(d.updated_at).toISOString().slice(0, 10)}</p></div>
              <form action={deleteDraft}><input type="hidden" name="id" value={d.id} /><button className="text-sm underline">Delete</button></form></li>))}</ul>}
      </section>
    </div>
  );
}
