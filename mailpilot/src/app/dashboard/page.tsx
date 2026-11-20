import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { utc } from "@/components/campaigns/badges";
import { EVENT_LABEL } from "@/lib/queue/status";
export default async function Overview() {
  const sb = await createClient();
  const n = async (table: string, col?: string, vals?: string[]) => {
    let q = sb.from(table).select("id", { count: "exact", head: true });
    if (col && vals) q = q.in(col, vals);
    return (await q).count ?? 0;
  };
  const sentCount = async () => (await sb.from("sending_jobs").select("id", { count: "exact", head: true }).not("accepted_at", "is", null).eq("simulated", false)).count ?? 0;
  const since = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const [{ data: daily }, { data: recent }] = await Promise.all([
    sb.from("daily_send_stats").select("day,accepted").gte("day", since).order("day"),
    sb.from("sending_events").select("id,type,created_at,sending_jobs(campaign_id,campaign_recipients(email))").order("created_at", { ascending: false }).limit(8)]);
  const perDay = new Map((daily ?? []).map((d: { day: string; accepted: number }) => [d.day, d.accepted]));
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400_000).toISOString().slice(0, 10));
  const max = Math.max(1, ...days.map((d) => perDay.get(d) ?? 0));
  const [sent, pending, failed, senders, contacts, campaigns, active] = await Promise.all([
    sentCount(), n("sending_jobs", "status", ["pending", "processing"]),
    n("sending_jobs", "status", ["failed", "bounced"]), n("sender_accounts", "status", ["connected"]),
    n("contacts"), n("campaigns"), n("campaigns", "status", ["queued", "sending"])]);
  const stats: [string, number][] = [["Accepted by provider", sent], ["Active campaigns", active], ["Pending emails", pending], ["Failed emails", failed], ["Connected accounts", senders]];
  const steps: [string, string, boolean][] = [["Connect a sender account", "/dashboard/senders", senders > 0], ["Add recipients you may contact", "/dashboard/contacts", contacts > 0], ["Create your first campaign", "/dashboard/compose", campaigns > 0]];
  return (
    <div className="space-y-10">
      <h1 className="font-display text-3xl font-bold">Overview</h1>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map(([l, v]) => (<div key={l} className="rounded-xl border border-ink/10 bg-white p-4"><dt className="text-sm text-ink/70">{l}</dt><dd className="mt-1 font-display text-3xl font-bold">{v}</dd></div>))}
      </dl>
      {steps.some(([, , done]) => !done) && (
        <section aria-labelledby="start">
          <h2 id="start" className="font-display text-xl font-semibold">Get started</h2>
          <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">
            {steps.map(([t, href, done]) => (<li key={t} className="flex items-center justify-between px-4 py-3"><span className={done ? "text-ink/50 line-through" : ""}>{t}</span>{done ? <span className="text-sm text-ink/50">Done</span> : <Link className="text-sm underline" href={href}>Start</Link>}</li>))}
          </ul>
        </section>)}
      <section aria-labelledby="stats"><h2 id="stats" className="font-display text-xl font-semibold">Sending statistics</h2>
        <p className="mt-1 text-sm text-ink/70">Messages accepted by the provider, last 7 days (UTC).</p>
        <ul className="mt-3 flex h-32 items-end gap-2 rounded-xl border border-ink/10 bg-white p-4">{days.map((d) => { const v = perDay.get(d) ?? 0; return (
          <li key={d} className="flex flex-1 flex-col items-center justify-end gap-1 text-xs"><span>{v}</span><div className="w-full rounded bg-ink" style={{ height: `${Math.max(2, Math.round((v / max) * 64))}px` }} aria-hidden /><span className="text-ink/60">{d.slice(5)}</span></li>); })}</ul></section>
      <section aria-labelledby="recent"><div className="flex items-end justify-between"><h2 id="recent" className="font-display text-xl font-semibold">Recent activity</h2><Link href="/dashboard/activity" className="text-sm underline">See all</Link></div>
        {!recent?.length ? <p className="mt-2 text-sm text-ink/70">Nothing yet. Sends and delivery events appear here once you run a campaign.</p> :
          <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">{(recent as unknown as { id: string; type: string; created_at: string; sending_jobs: { campaign_id: string; campaign_recipients: { email: string | null } | null } | null }[]).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-2 text-sm"><span>{EVENT_LABEL[e.type] ?? e.type} · <span className="text-ink/70">{e.sending_jobs?.campaign_recipients?.email ?? "(deleted contact)"}</span></span><span className="whitespace-nowrap text-ink/60">{utc(e.created_at)}</span></li>))}</ul>}</section>
    </div>
  );
}
