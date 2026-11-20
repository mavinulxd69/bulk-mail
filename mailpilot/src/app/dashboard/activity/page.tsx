import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { utc } from "@/components/campaigns/badges";
import { EVENT_LABEL, JOB_LABEL } from "@/lib/queue/status";

type Ev = { id: string; type: string; created_at: string; provider_payload: { message?: string; simulated?: boolean } | null; sending_jobs: { status: string; campaign_id: string; campaign_recipients: { email: string | null } | null } | null };
export default async function Activity({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const sp = await searchParams;
  const sb = await createClient();
  const campaign = z.string().uuid().safeParse(sp.campaign).data;
  let q = sb.from("sending_events").select("id,type,created_at,provider_payload,sending_jobs!inner(status,campaign_id,campaign_recipients(email))").order("created_at", { ascending: false }).limit(100);
  if (campaign) q = q.eq("sending_jobs.campaign_id", campaign);
  const [{ data }, { data: camps }] = await Promise.all([q, sb.from("campaigns").select("id,name").order("created_at", { ascending: false }).limit(100)]);
  const names = new Map((camps ?? []).map((c) => [c.id as string, c.name as string]));
  const rows = (data ?? []) as unknown as Ev[];
  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-3xl font-bold">Email Activity</h1><p className="mt-1 max-w-2xl text-sm text-ink/70">Every step MailPilot took and every confirmation the provider sent back, newest first. &quot;Accepted by provider&quot; is not delivery.</p></div>
      {campaign && <p className="text-sm">Showing one campaign. <Link href="/dashboard/activity" className="underline">Show all</Link></p>}
      {!rows.length ? <div className="rounded-xl border border-dashed border-ink/30 p-8"><p className="font-medium">No activity yet</p><p className="mt-1 text-sm text-ink/70">Sends, retries and delivery confirmations appear here once a campaign runs.</p></div> :
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white"><table className="w-full text-left text-sm">
          <thead className="border-b border-ink/10 text-ink/70"><tr><th className="p-3">When</th><th className="p-3">Event</th><th className="p-3">Recipient</th><th className="p-3">Campaign</th><th className="p-3">Now</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{rows.map((e) => (<tr key={e.id}>
            <td className="whitespace-nowrap p-3 text-ink/70">{utc(e.created_at)}</td>
            <td className="p-3">{EVENT_LABEL[e.type] ?? e.type}{e.provider_payload?.simulated ? " (simulated)" : ""}{e.provider_payload?.message ? <p className="max-w-xs text-ink/60">{e.provider_payload.message}</p> : null}</td>
            <td className="p-3">{e.sending_jobs?.campaign_recipients?.email ?? <span className="text-ink/50">(deleted contact)</span>}</td>
            <td className="p-3">{e.sending_jobs ? <Link className="underline" href={`/dashboard/campaigns/${e.sending_jobs.campaign_id}`}>{names.get(e.sending_jobs.campaign_id) ?? "Campaign"}</Link> : ""}</td>
            <td className="p-3 text-ink/70">{e.sending_jobs ? JOB_LABEL[e.sending_jobs.status] ?? e.sending_jobs.status : ""}</td></tr>))}</tbody></table></div>}
    </div>
  );
}
