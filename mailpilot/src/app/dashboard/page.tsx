import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { utc } from "@/components/campaigns/badges";
import { EVENT_LABEL } from "@/lib/queue/status";

type Activity = {
  id: string;
  type: string;
  created_at: string;
  sending_jobs: { campaign_id: string; campaign_recipients: { email: string | null } | null } | null;
};

const card = "rounded-2xl border border-ink/10 bg-white shadow-sm shadow-slate-950/[0.02]";

export default async function Overview() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const count = async (table: string, col?: string, vals?: string[]) => {
    let query = sb.from(table).select("id", { count: "exact", head: true });
    if (col && vals) query = query.in(col, vals);
    const { count: result } = await query;
    return result ?? 0;
  };
  const sentCount = async () => {
    const { count: result } = await sb.from("sending_jobs").select("id", { count: "exact", head: true })
      .not("accepted_at", "is", null).eq("simulated", false);
    return result ?? 0;
  };
  const since = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const [{ data: daily }, { data: recent }, { data: profile }] = await Promise.all([
    sb.from("daily_send_stats").select("day,accepted").gte("day", since).order("day"),
    sb.from("sending_events").select("id,type,created_at,sending_jobs(campaign_id,campaign_recipients(email))")
      .order("created_at", { ascending: false }).limit(6),
    user ? sb.from("profiles").select("display_name,trial_send_limit").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const trialQuota = async () => {
    if (profile?.trial_send_limit == null) return null;
    const [{ count: accepted }, { count: reserved }] = await Promise.all([
      sb.from("sending_jobs").select("id", { count: "exact", head: true }).not("accepted_at", "is", null).eq("simulated", false),
      sb.from("sending_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    ]);
    return {
      limit: profile.trial_send_limit,
      remaining: Math.max(0, profile.trial_send_limit - (accepted ?? 0) - (reserved ?? 0)),
    };
  };
  const [sent, pending, failed, senders, contacts, campaigns, active, trial] = await Promise.all([
    sentCount(),
    count("sending_jobs", "status", ["pending", "processing"]),
    count("sending_jobs", "status", ["failed", "bounced"]),
    count("sender_accounts", "status", ["connected"]),
    count("contacts"),
    count("campaigns"),
    count("campaigns", "status", ["queued", "sending"]),
    trialQuota(),
  ]);

  const byDay = new Map((daily ?? []).map((row: { day: string; accepted: number }) => [row.day, row.accepted]));
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400_000).toISOString().slice(0, 10));
  const max = Math.max(1, ...days.map((day) => byDay.get(day) ?? 0));
  const weekTotal = days.reduce((total, day) => total + (byDay.get(day) ?? 0), 0);
  const name = profile?.display_name?.trim() || user?.email?.split("@")[0] || "there";
  const steps = [
    { title: "Connect a sender", detail: "Link Gmail or verify your sending domain.", href: "/dashboard/senders", done: senders > 0 },
    { title: "Add your recipients", detail: "Import contacts you’re authorized to email.", href: "/dashboard/contacts", done: contacts > 0 },
    { title: "Build your first campaign", detail: "Personalize, preview, and review before sending.", href: "/dashboard/compose", done: campaigns > 0 },
  ];
  const completed = steps.filter((step) => step.done).length;
  const activity = (recent ?? []) as unknown as Activity[];
  const metrics = [
    { label: "Emails sent", value: sent, helper: "Accepted by provider", tone: "text-indigo-700 bg-indigo-50", icon: <><path d="m4 12 5 5L20 6" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" /></> },
    { label: "Active campaigns", value: active, helper: "Currently in progress", tone: "text-violet-700 bg-violet-50", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 7 9 6 9-6" /></> },
    { label: "Pending emails", value: pending, helper: "Waiting or processing", tone: "text-amber-700 bg-amber-50", icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
    { label: "Failed emails", value: failed, helper: "Failed or bounced", tone: "text-rose-700 bg-rose-50", icon: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></> },
    { label: "Connected accounts", value: senders, helper: "Ready to send", tone: "text-emerald-700 bg-emerald-50", icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></> },
  ];

  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-indigo-600">WORKSPACE OVERVIEW</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Welcome back, {name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/70">A clear view of your sending activity, campaign health, and what’s next.</p>
        </div>
        <Link href="/dashboard/compose" className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post sm:self-auto">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path strokeLinecap="round" d="M12 5v14m-7-7h14" /></svg>
          Create campaign
        </Link>
      </section>
      {trial && <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
        <strong>Free verified-email trial:</strong> {trial.remaining} of {trial.limit} campaign emails remaining. Queued emails reserve trial credits; only emails accepted by your provider use them permanently.
      </p>}

      <section aria-labelledby="onboarding-title" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#18285b] via-[#273b78] to-[#364b8d] p-5 text-white shadow-xl shadow-indigo-950/10 sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-sky/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-1/3 h-56 w-56 rounded-full bg-indigo-300/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky/80">{completed === steps.length ? "You’re ready" : "Your launch checklist"}</p>
            <h2 id="onboarding-title" className="mt-2 font-display text-2xl font-bold tracking-tight">{completed === steps.length ? "Your workspace is ready to go." : "Let’s get your workspace ready."}</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-indigo-100/80">{completed === steps.length ? "You’ve completed the essentials. Create a campaign whenever you’re ready." : "A few quick steps will get you from setup to a reviewed, personalized campaign."}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3">
            <div className="relative h-11 w-11">
              <svg aria-hidden="true" viewBox="0 0 36 36" className="h-11 w-11 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${(completed / steps.length) * 94.25} 94.25`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{completed}/{steps.length}</span>
            </div>
            <div><p className="text-sm font-semibold">{completed === steps.length ? "All set" : "Setup progress"}</p><p className="text-xs text-indigo-100/70">{completed} of {steps.length} complete</p></div>
          </div>
        </div>
        <ol className="relative mt-6 grid gap-3 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <Link href={step.href} aria-current={step.done ? undefined : "step"} className={`group flex h-full gap-3 rounded-2xl border p-4 transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky ${step.done ? "border-white/10 bg-white/[0.06]" : "border-white/15 bg-white/[0.1] hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.14]"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.done ? "bg-emerald-300/20 text-emerald-200" : "bg-white/10 text-white"}`}>
                  {step.done ? <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="m4 10 4 4 8-8" /></svg> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">{step.title}<span className="text-xs font-medium text-sky/80">{step.done ? "Done" : "Start →"}</span></span>
                  <span className="mt-1 block text-xs leading-5 text-indigo-100/70">{step.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Sending summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <article key={metric.label} className={`${card} p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-ink/70">{metric.label}</p>
              <span aria-hidden="true" className={`flex h-9 w-9 items-center justify-center rounded-xl ${metric.tone}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">{metric.icon}</svg>
              </span>
            </div>
            <p className="mt-4 font-display text-3xl font-bold tracking-tight">{metric.value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-ink/60">{metric.helper}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.9fr)]">
        <section aria-labelledby="sending-title" className={`${card} p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 id="sending-title" className="font-display text-lg font-bold">Sending activity</h2><p className="mt-1 text-sm text-ink/60">Provider-accepted emails over the last 7 days</p></div>
            <div className="rounded-xl bg-indigo-50 px-3 py-2 text-right"><p className="font-display text-xl font-bold text-indigo-950">{weekTotal.toLocaleString()}</p><p className="text-[11px] font-medium text-indigo-700">this week</p></div>
          </div>
          <div role="img" aria-label={`Sending activity, last 7 days. ${weekTotal} emails accepted by providers.`} className="mt-7 grid h-44 grid-cols-7 items-end gap-2 sm:gap-4">
            {days.map((day) => {
              const value = byDay.get(day) ?? 0;
              const height = value ? Math.max(8, Math.round((value / max) * 112)) : 5;
              return (
                <div key={day} className="flex h-full flex-col items-center justify-end gap-2">
                  <span className="text-[11px] font-medium tabular-nums text-ink/60">{value || ""}</span>
                  <div className="flex h-28 w-full items-end rounded-lg bg-mist/80">
                    <div className="w-full rounded-lg bg-gradient-to-t from-indigo-700 to-violet-400 transition-all duration-500" style={{ height: `${height}px` }} />
                  </div>
                  <span className="text-[11px] text-ink/50">{new Date(`${day}T12:00:00Z`).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 border-t border-ink/10 pt-4 text-xs leading-5 text-ink/60">“Accepted” means the email provider accepted the request; it doesn’t guarantee inbox delivery. Delivery is shown only when confirmed by the provider.</p>
        </section>

        <section aria-labelledby="recent-title" className={`${card} p-5 sm:p-6`}>
          <div className="flex items-center justify-between gap-3">
            <div><h2 id="recent-title" className="font-display text-lg font-bold">Recent activity</h2><p className="mt-1 text-sm text-ink/60">The latest campaign events</p></div>
            <Link href="/dashboard/activity" className="rounded-lg px-2 py-1 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post">View all <span aria-hidden="true">→</span></Link>
          </div>
          {!activity.length ? (
            <div className="mt-5 rounded-2xl border border-dashed border-ink/15 bg-paper p-5 text-center">
              <span aria-hidden="true" className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              </span>
              <p className="mt-3 text-sm font-semibold">Your activity will show up here</p>
              <p className="mt-1 text-xs leading-5 text-ink/60">Once a campaign starts, you’ll see provider and delivery updates.</p>
              <Link href="/dashboard/compose" className="mt-4 inline-flex rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink/90">Create a campaign</Link>
            </div>
          ) : (
            <ol className="mt-4 divide-y divide-ink/10">
              {activity.map((event) => (
                <li key={event.id} className="flex gap-3 py-3 first:pt-1">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500 ring-4 ring-indigo-50" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{EVENT_LABEL[event.type] ?? event.type}</p>
                    <p className="mt-0.5 truncate text-xs text-ink/60">{event.sending_jobs?.campaign_recipients?.email ?? "Recipient removed"} · {utc(event.created_at)}</p>
                  </div>
                  {event.sending_jobs?.campaign_id && <Link href={`/dashboard/campaigns/${event.sending_jobs.campaign_id}`} aria-label="Open campaign" className="self-center rounded-lg px-2 py-1 text-ink/50 hover:bg-mist hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-post">↗</Link>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
