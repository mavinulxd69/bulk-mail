import { createClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/providers/gmail";
import { resendConfigured } from "@/lib/providers/resend";
import { addDomain, addResendSender, checkDomain, disconnectSender } from "./actions";
const inp = "mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2";
const btn = "rounded-full bg-ink px-4 py-2 text-sm text-white";
type Rec = { record?: string; type?: string; name?: string; value?: string; status?: string };
export default async function Senders({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const q = await searchParams;
  const sb = await createClient();
  const [{ data: senders }, { data: domains }] = await Promise.all([
    sb.from("sender_accounts").select("id,provider,from_address,display_name,status,paused_until").neq("status", "disconnected").order("created_at"),
    sb.from("sender_domains").select("id,domain,status,dns_records").order("created_at")]);
  const g = googleConfigured(), r = resendConfigured();
  return (
    <div className="space-y-10">
      <h1 className="font-display text-3xl font-bold">Sender Accounts</h1>
      {q.error && <p role="alert" className="rounded-lg bg-post/10 p-3 text-sm text-post">{q.error}</p>}
      {q.notice && <p role="status" className="rounded-lg bg-sky p-3 text-sm">{q.notice}</p>}
      <section><h2 className="font-display text-xl font-semibold">Connected</h2>
        {!senders?.length ? <p className="mt-2 text-sm text-ink/70">No sender yet. Connect Gmail or add a business domain below.</p> :
          <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">{senders.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div><p className="font-medium">{s.from_address}</p><p className="text-sm text-ink/60">{s.provider === "gmail" ? "Gmail" : "Business email (Resend)"} · {s.status === "needs_reauth" ? "Reconnect needed" : s.status}{s.paused_until && new Date(s.paused_until) > new Date() ? ` · sending paused until ${new Date(s.paused_until).toISOString().slice(0, 16).replace("T", " ")} UTC (provider limit)` : ""}</p></div>
              <form action={disconnectSender}><input type="hidden" name="id" value={s.id} /><button className="text-sm underline">Disconnect</button></form></li>))}</ul>}
      </section>
      <section><h2 className="font-display text-xl font-semibold">Gmail / Google Workspace</h2>
        <p className="mt-1 max-w-xl text-sm text-ink/70">MailPilot asks only for permission to send mail as you. It cannot read your inbox, and you can disconnect any time.</p>
        {g ? <a href="/api/oauth/google/start" className={`${btn} mt-3 inline-block`}>Connect Gmail</a> : <p className="mt-3 rounded-lg border border-dashed border-ink/30 p-3 text-sm">Not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY (see README).</p>}
      </section>
      <section><h2 className="font-display text-xl font-semibold">Business email</h2>
        {!r ? <p className="mt-2 rounded-lg border border-dashed border-ink/30 p-3 text-sm">Not configured: set RESEND_API_KEY (see README).</p> : <>
          <form action={addDomain} className="mt-3 flex max-w-md items-end gap-3"><label className="flex-1 text-sm font-medium">Sending domain<input name="domain" placeholder="example.com" required className={inp} /></label><button className={btn}>Add domain</button></form>
          {domains?.map((d) => { const recs = (Array.isArray(d.dns_records) ? d.dns_records : []) as Rec[]; return (
            <div key={d.id} className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
              <div className="flex items-center justify-between"><p className="font-medium">{d.domain} <span className="text-sm text-ink/60">· {d.status}</span></p>
                {d.status !== "verified" && <form action={checkDomain}><input type="hidden" name="id" value={d.id} /><button className="text-sm underline">Check status</button></form>}</div>
              {d.status !== "verified" && <div className="mt-3 overflow-x-auto"><p className="text-sm text-ink/70">Add these DNS records at your domain provider:</p>
                <table className="mt-2 w-full text-left text-sm"><thead><tr><th className="pr-4">Type</th><th className="pr-4">Name</th><th>Value</th></tr></thead><tbody>{recs.map((x, i) => (<tr key={i} className="align-top"><td className="pr-4">{x.type}</td><td className="pr-4 break-all">{x.name}</td><td className="break-all">{x.value}</td></tr>))}</tbody></table></div>}
              {d.status === "verified" && <form action={addResendSender} className="mt-3 grid gap-3 md:grid-cols-4"><input type="hidden" name="domain_id" value={d.id} />
                <label className="text-sm font-medium">Address<input name="local" placeholder="hello" required className={inp} /></label>
                <label className="text-sm font-medium">Sender name<input name="name" className={inp} /></label>
                <label className="text-sm font-medium">Reply-to<input name="reply_to" type="email" className={inp} /></label>
                <button className={`${btn} self-end`}>Add sender</button></form>}
            </div>); })}</>}
      </section>
    </div>
  );
}
