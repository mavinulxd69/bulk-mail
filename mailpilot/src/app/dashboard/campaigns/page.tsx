import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CampaignBadge, utc } from "@/components/campaigns/badges";
import { btn } from "@/components/styles";

type Stat = { campaign_id: string; total: number; pending: number; processing: number; accepted: number; delivered: number; bounced: number; failed: number; suppressed: number; cancelled: number };
export default async function Campaigns({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: campaigns }, { data: stats }, { data: senders }] = await Promise.all([
    sb.from("campaigns").select("id,name,subject,status,sender_id,created_at").order("created_at", { ascending: false }).limit(100),
    sb.from("campaign_stats").select("*").limit(100),
    sb.from("sender_accounts").select("id,from_address")]);
  const st = new Map(((stats ?? []) as Stat[]).map((s) => [s.campaign_id, s]));
  const from = new Map((senders ?? []).map((s) => [s.id, s.from_address as string]));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-bold">Campaigns</h1><p className="mt-1 text-sm text-ink/70">Each recipient gets their own email. &quot;Sent&quot; here means the provider accepted it; delivery is shown only when the provider confirms it.</p></div>
        <Link href="/dashboard/compose" className={btn}>New campaign</Link>
      </div>
      {sp.error && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{sp.error}</p>}
      {sp.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{sp.notice}</p>}
      {!campaigns?.length ? <div className="rounded-xl border border-dashed border-ink/30 p-8"><p className="font-medium">No campaigns yet</p><p className="mt-1 text-sm text-ink/70">Write an email in Compose, save it as a draft, then review and approve it here.</p></div> :
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/10 text-ink/70"><tr><th className="p-3">Campaign</th><th className="p-3">Status</th><th className="p-3">Sender</th><th className="p-3 text-right">Recipients</th><th className="p-3 text-right">Queued</th><th className="p-3 text-right">Sent</th><th className="p-3 text-right">Failed</th><th className="p-3">Created</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{campaigns.map((c) => { const s = st.get(c.id); const draft = c.status === "draft";
              return (<tr key={c.id}>
                <td className="p-3"><Link href={`/dashboard/campaigns/${c.id}`} className="font-medium underline">{c.name}</Link><p className="max-w-xs truncate text-ink/60">{c.subject}</p></td>
                <td className="p-3"><CampaignBadge status={c.status} /></td>
                <td className="p-3 text-ink/70">{c.sender_id ? from.get(c.sender_id) ?? "—" : "—"}</td>
                <td className="p-3 text-right">{draft ? "—" : s?.total ?? 0}</td>
                <td className="p-3 text-right">{draft ? "—" : (s?.pending ?? 0) + (s?.processing ?? 0)}</td>
                <td className="p-3 text-right">{draft ? "—" : (s?.accepted ?? 0) + (s?.delivered ?? 0)}</td>
                <td className="p-3 text-right">{draft ? "—" : (s?.failed ?? 0) + (s?.bounced ?? 0)}</td>
                <td className="p-3 text-ink/70">{utc(c.created_at).slice(0, 10)}</td></tr>); })}</tbody>
          </table></div>}
    </div>
  );
}
