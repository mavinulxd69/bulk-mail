import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { AutoRefresh } from "@/components/campaigns/auto-refresh";
import { CampaignBadge, JobBadge, utc } from "@/components/campaigns/badges";
import { btn, btn2, card, inp } from "@/components/styles";
import { contactVariables } from "@/lib/contacts/fields";
import { finalizeMessage } from "@/lib/compose/html";
import { DEFAULT_SEND_RATE, SEND_RATE_CHOICES } from "@/lib/limits";
import { queueConfig } from "@/lib/queue/config";
import { audienceDigest } from "@/lib/queue/digest";
import { CAMPAIGN_COLUMNS, checkCampaignReady, type CampaignRow } from "@/lib/queue/ready";
import { ACTIVE_CAMPAIGN, JOB_LABEL } from "@/lib/queue/status";
import { analyzeAudience, renderTemplate } from "@/lib/personalize/engine";
import { SYSTEM_VARIABLES } from "@/lib/personalize/variables";
import { backToDraft, cancelCampaign, confirmCampaign, requestApproval } from "../actions";

export const maxDuration = 60; // the approval action can start the worker for a short while after it responds
const PAGE = 50;
type SP = { notice?: string; error?: string; status?: string; page?: string };
type Stat = { total: number; pending: number; processing: number; accepted: number; delivered: number; bounced: number; failed: number; suppressed: number; cancelled: number; simulated: number };
type JobRow = { id: string; status: string; attempts: number; max_attempts: number; last_error: string | null; accepted_at: string | null; delivered_at: string | null; run_after: string; simulated: boolean; campaign_recipients: { email: string | null } | null };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params; const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sb = await createClient();
  const { data: row } = await sb.from("campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle();
  if (!row) notFound();
  const c = row as CampaignRow;
  const [{ data: sender }, { data: statRow }] = await Promise.all([
    c.sender_id ? sb.from("sender_accounts").select("id,provider,from_address,display_name,status,paused_until,pause_reason,daily_quota").eq("id", c.sender_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("campaign_stats").select("*").eq("campaign_id", id).maybeSingle()]);
  const s: Stat = { total: 0, pending: 0, processing: 0, accepted: 0, delivered: 0, bounced: 0, failed: 0, suppressed: 0, cancelled: 0, simulated: 0, ...(statRow ?? {}) };
  const open = s.pending + s.processing;
  const done = s.total - open;

  return (
    <div className="space-y-8">
      <div><Link href="/dashboard/campaigns" className="text-sm underline">← Campaigns</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="font-display text-3xl font-bold">{c.name}</h1><CampaignBadge status={c.status} /></div>
        <p className="mt-1 text-sm text-ink/70">Subject: {c.subject || "(none)"} · From: {sender ? sender.from_address : "no sender chosen"} · Created {utc(c.created_at)}</p></div>
      {sp.error && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{sp.error}</p>}
      {sp.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{sp.notice}</p>}

      {c.status === "draft" && (
        <section className={card}><h2 className="font-display text-xl font-semibold">This is a draft</h2>
          <p className="mt-1 text-sm text-ink/70">Nothing has been sent. When the message is ready, send it for review: you will see exactly who gets what before anything goes out.</p>
          <div className="mt-4 flex flex-wrap gap-3"><Link href={`/dashboard/compose?campaign=${c.id}`} className={btn2}>Edit in composer</Link>
            <form action={requestApproval}><input type="hidden" name="id" value={c.id} /><button className={btn}>Review &amp; approve</button></form></div>
          {c.test_sent_at ? <p className="mt-3 text-sm text-ink/70">A test email of this saved version was sent on {utc(c.test_sent_at)}.</p> : <p className="mt-3 text-sm text-ink/70">Tip: send yourself a test from the composer first. It only goes to your own address.</p>}
        </section>)}

      {c.status === "awaiting_approval" && <Review c={c} sbPromise={sb} />}

      {c.status !== "draft" && c.status !== "awaiting_approval" && <>
        <PauseBanners c={c} sender={sender} open={open} />
        <section aria-labelledby="prog">
          <div className="flex items-end justify-between"><h2 id="prog" className="font-display text-xl font-semibold">Progress</h2><AutoRefresh active={ACTIVE_CAMPAIGN.has(c.status) || open > 0} /></div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={done}><div className="h-full bg-ink" style={{ width: `${s.total ? Math.round((done / s.total) * 100) : 0}%` }} /></div>
          <p className="mt-1 text-sm text-ink/70">{done} of {s.total} finished{c.skipped_count ? ` · ${c.skipped_count} left out at approval (missing data or no consent record)` : ""}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {([["Queued", s.pending + s.processing], ["Accepted by provider", s.accepted], ["Delivered", s.delivered], ["Bounced", s.bounced], ["Failed", s.failed], ["Suppressed", s.suppressed], ["Cancelled", s.cancelled], ["Total", s.total]] as const).map(([l, v]) => (
              <div key={l} className={card}><dt className="text-sm text-ink/70">{l}</dt><dd className="mt-1 font-display text-2xl font-bold">{v}</dd></div>))}
          </dl>
          {s.simulated > 0 && <p className="mt-3 rounded-lg border border-dashed border-ink/30 p-3 text-sm">{s.simulated} message{s.simulated === 1 ? " was" : "s were"} <strong>simulated</strong> (development mode). Nothing was really sent.</p>}
          {sender?.provider === "gmail" && s.accepted > 0 && <p className="mt-3 text-sm text-ink/70">Gmail doesn&apos;t report delivery back to MailPilot, so these stay at &quot;Accepted by provider&quot;. Bounces arrive in the sender&apos;s own inbox.</p>}
          {sender?.provider === "resend" && s.accepted > 0 && <p className="mt-3 text-sm text-ink/70">Messages move to &quot;Delivered&quot; or &quot;Bounced&quot; when the provider confirms, which can take a few minutes. If they never do, check that the Resend webhook is set up (README).</p>}
          <div className="mt-4 flex gap-3">{["queued", "sending"].includes(c.status) && <form action={cancelCampaign}><input type="hidden" name="id" value={c.id} /><button className={btn2}>Cancel unsent messages</button></form>}</div>
        </section>
        <Recipients id={id} sp={sp} />
      </>}
    </div>
  );
}

async function PauseBanners({ c, sender, open }: { c: CampaignRow; sender: { status: string; paused_until: string | null; provider: string } | null; open: number }) {
  const msgs: string[] = [];
  if (open > 0 && sender?.status === "needs_reauth") msgs.push("The sender account needs to be reconnected. Sending resumes as soon as you reconnect it on the Sender Accounts page.");
  if (open > 0 && sender?.paused_until && new Date(sender.paused_until) > new Date()) msgs.push(`The provider's sending limit was reached. Sending is paused until ${utc(sender.paused_until)} and will then try again automatically.`);
  if (open > 0 && ACTIVE_CAMPAIGN.has(c.status)) {
    const { data } = await admin().from("worker_heartbeats").select("beat_at").order("beat_at", { ascending: false }).limit(1);
    const last = data?.[0]?.beat_at ? new Date(data[0].beat_at).getTime() : 0;
    if (Date.now() - last > 3 * 60_000) msgs.push("The sending worker hasn't run recently, so queued messages are waiting. If you run this yourself, start the worker or check the cron job (README). Nothing is lost.");
  }
  return msgs.length ? <div className="space-y-2">{msgs.map((m) => <p key={m} role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">{m}</p>)}</div> : null;
}

async function Review({ c, sbPromise: sb }: { c: CampaignRow; sbPromise: Awaited<ReturnType<typeof createClient>> }) {
  const { data: { user } } = await sb.auth.getUser();
  const ready = await checkCampaignReady(sb, user ?? {}, c);
  const back = <form action={backToDraft}><input type="hidden" name="id" value={c.id} /><button className={btn2}>Back to draft</button></form>;
  if (!ready.ok) return <section className={card}><h2 className="font-display text-xl font-semibold">Can&apos;t be approved yet</h2><p role="alert" className="mt-2 text-sm text-post">{ready.message}</p><div className="mt-4">{back}</div></section>;

  const { audience, sender } = ready, contacts = audience.contacts;
  const rows = audience.audience.map((contact) => ({ contact, data: contactVariables(contact) }));
  const report = analyzeAudience(ready.template, rows.map((r) => ({ id: r.contact.id, data: r.data })));
  const needed = report.variables.filter((v) => !(SYSTEM_VARIABLES as readonly string[]).includes(v));
  const unconsented = audience.audience.filter((x) => !x.consented_at).length;
  // Default plan: people with a consent record whose message can be completed. (Opting in below adds the consent-less ones.)
  const lacks = (data: Record<string, string>) => report.templateErrors.length > 0 || needed.some((v) => !data[v]?.trim()); // report.blockedRecipients is capped at 100
  const sendable = rows.filter((r) => r.contact.consented_at && !lacks(r.data)).length;
  const sample = rows.find((r) => !lacks(r.data));
  const rendered = sample ? renderTemplate(ready.template, sample.data, { unsubscribe_url: `${ready.site}/unsubscribe/…` }) : null;
  const m = rendered && rendered.ok ? finalizeMessage(rendered) : null;
  const cfg = queueConfig();
  const perDay = Math.min(sender.daily_quota, cfg.userPerDay);
  const days = Math.ceil(sendable / perDay);

  return (
    <section className="space-y-6" aria-labelledby="rev">
      <h2 id="rev" className="font-display text-xl font-semibold">Review before sending</h2>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([["In the audience", contacts.length], ["Ready to send now", sendable], ["Missing data", report.blocked], ["Suppressed (won't be sent)", audience.suppressed]] as const).map(([l, v]) => (
          <div key={l} className={card}><dt className="text-sm text-ink/70">{l}</dt><dd className="mt-1 font-display text-2xl font-bold">{v}</dd></div>))}
      </dl>
      {days > 1 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">This sender can send about {perDay} emails per 24 hours, so {sendable} messages will take roughly {days} days. Sending continues automatically within those limits.</p>}
      {c.is_marketing && <p className="text-sm text-ink/70">Marketing mail: every message carries its own unsubscribe link and a one-click unsubscribe header. Unsubscribes, complaints and hard bounces are suppressed automatically.</p>}
      {m && <div><h3 className="font-medium">Example: what {sample!.contact.email} receives</h3><p className="mt-1 text-sm text-ink/70">Subject: {m.subject}</p>
        {m.html ? <iframe title="Example email" sandbox="" srcDoc={m.html} className="mt-2 h-64 w-full rounded-lg border border-ink/15 bg-white" /> : <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink/15 bg-white p-3 text-sm">{m.text}</pre>}</div>}
      {report.blocked > 0 && <p className="text-sm text-ink/70">{report.blocked} recipient{report.blocked === 1 ? " is" : "s are"} missing data for {needed.map((v) => `{{${v}}}`).join(", ")}. A message is never sent half-personalized.</p>}

      <form action={confirmCampaign} className="space-y-4 rounded-xl border border-ink/15 bg-white p-4">
        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="digest" value={audienceDigest(contacts)} />
        <label className="block text-sm font-medium">Sending speed<select name="rate" defaultValue={DEFAULT_SEND_RATE} className={inp}>{SEND_RATE_CHOICES.map((r) => <option key={r} value={r}>{r} per minute{r === DEFAULT_SEND_RATE ? " (recommended)" : ""}</option>)}</select></label>
        {report.blocked > 0 && <label className="flex gap-2 text-sm"><input type="checkbox" name="skip_blocked" className="mt-1" /><span>Skip the {report.blocked} recipient{report.blocked === 1 ? "" : "s"} with missing data and send to everyone else</span></label>}
        {unconsented > 0 && <label className="flex gap-2 text-sm"><input type="checkbox" name="include_unconsented" className="mt-1" /><span>Also send to {unconsented} contact{unconsented === 1 ? "" : "s"} with <strong>no consent record</strong> (added before consent tracking). I confirm I&apos;m authorized to contact them. Left unticked, they are skipped.</span></label>}
        <label className="flex gap-2 text-sm font-medium"><input type="checkbox" name="confirm" required className="mt-1" /><span>I have reviewed this campaign and I&apos;m authorized to email these recipients. Start sending.</span></label>
        <div className="flex flex-wrap gap-3"><button className={btn} disabled={sendable === 0}>Confirm and start sending</button></div>
      </form>
      <div className="flex gap-3">{back}<form action={cancelCampaign}><input type="hidden" name="id" value={c.id} /><button className={btn2}>Cancel campaign</button></form></div>
    </section>
  );
}

async function Recipients({ id, sp }: { id: string; sp: SP }) {
  const sb = await createClient();
  const pageNo = Math.max(1, Number(sp.page) || 1);
  const filter = sp.status && sp.status in JOB_LABEL ? sp.status : null;
  let q = sb.from("sending_jobs").select("id,status,attempts,max_attempts,last_error,accepted_at,delivered_at,run_after,simulated,campaign_recipients(email)", { count: "exact" }).eq("campaign_id", id).order("created_at").order("id").range((pageNo - 1) * PAGE, pageNo * PAGE - 1);
  if (filter) q = q.eq("status", filter);
  const { data, count } = await q;
  const rows = (data ?? []) as unknown as JobRow[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (p: number, st: string | null) => `/dashboard/campaigns/${id}?${new URLSearchParams({ ...(st ? { status: st } : {}), page: String(p) })}`;
  return (
    <section aria-labelledby="rc"><h2 id="rc" className="font-display text-xl font-semibold">Recipients</h2>
      <nav aria-label="Filter by status" className="mt-3 flex flex-wrap gap-2 text-sm">{[null, ...Object.keys(JOB_LABEL)].map((st) => (
        <Link key={st ?? "all"} href={href(1, st)} aria-current={filter === st ? "true" : undefined} className={`rounded-full border px-3 py-1 ${filter === st ? "border-ink bg-ink text-white" : "border-ink/25 hover:bg-mist"}`}>{st ? JOB_LABEL[st] : "All"}</Link>))}</nav>
      {!rows.length ? <p className="mt-3 text-sm text-ink/70">Nothing to show for this filter.</p> :
        <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white"><table className="w-full text-left text-sm">
          <thead className="border-b border-ink/10 text-ink/70"><tr><th className="p-3">Recipient</th><th className="p-3">Status</th><th className="p-3">Tries</th><th className="p-3">Time</th><th className="p-3">Note</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{rows.map((r) => (<tr key={r.id}>
            <td className="p-3">{r.campaign_recipients?.email ?? <span className="text-ink/50">(deleted contact)</span>}</td>
            <td className="p-3"><JobBadge status={r.status} simulated={r.simulated} /></td>
            <td className="p-3">{r.attempts}/{r.max_attempts}</td>
            <td className="p-3 whitespace-nowrap text-ink/70">{r.status === "pending" ? `next try ${utc(r.run_after)}` : utc(r.delivered_at ?? r.accepted_at)}</td>
            <td className="p-3 max-w-xs text-ink/70">{r.last_error ?? ""}</td></tr>))}</tbody></table></div>}
      {pages > 1 && <div className="mt-3 flex items-center gap-3 text-sm">{pageNo > 1 && <Link className="underline" href={href(pageNo - 1, filter)}>Previous</Link>}<span>Page {pageNo} of {pages}</span>{pageNo < pages && <Link className="underline" href={href(pageNo + 1, filter)}>Next</Link>}</div>}
    </section>);
}
