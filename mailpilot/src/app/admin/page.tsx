import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

async function setAccountStatus(fd: FormData) {
  "use server";
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: actor } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!actor?.is_admin) notFound();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) redirect("/admin");
  const disabled = fd.get("disabled") === "on";
  const db = admin();
  const { error } = await db.auth.admin.updateUserById(id.data, { ban_duration: disabled ? "876000h" : "none" });
  if (!error) await db.from("audit_logs").insert({ user_id: id.data, action: disabled ? "account.disabled" : "account.enabled", detail: { by: user.id } });
  revalidatePath("/admin");
  redirect("/admin");
}

async function setPlan(fd: FormData) {
  "use server";
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: actor } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!actor?.is_admin) notFound();
  const id = z.string().uuid().safeParse(fd.get("id"));
  const plan = z.enum(["starter", "growth", "scale"]).safeParse(fd.get("plan"));
  if (!id.success || !plan.success) redirect("/admin");
  const limits = { starter: 100, growth: 5000, scale: 100000 };
  const db = admin();
  await db.from("profiles").update({ plan: plan.data, monthly_send_limit: limits[plan.data] }).eq("id", id.data);
  await db.from("audit_logs").insert({ user_id: id.data, action: "account.plan_changed", detail: { plan: plan.data, by: user.id } });
  revalidatePath("/admin");
  redirect("/admin");
}

export default async function Admin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: p } = user ? await sb.from("profiles").select("is_admin").eq("id", user.id).single() : { data: null };
  if (!p?.is_admin) notFound();
  const db = admin();
  const [{ data: profiles }, { data: recentAudit }, { data: abuse }] = await Promise.all([
    db.from("profiles").select("id,display_name,plan,monthly_send_limit,created_at").order("created_at", { ascending: false }).limit(100),
    db.from("audit_logs").select("id,user_id,action,detail,created_at").order("created_at", { ascending: false }).limit(50),
    db.rpc("abuse_summary", { p_since: new Date(Date.now() - 86400_000).toISOString() }),
  ]);
  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6">
      <h1 className="font-display text-3xl font-bold">Admin</h1>
      <section>
        <h2 className="font-display text-xl font-semibold">Abuse summary — 24 hours</h2>
        {!abuse?.length ? <p className="mt-2 text-sm text-ink/70">No abuse events recorded.</p> :
          <ul className="mt-3 rounded-xl border border-ink/10 bg-white">{abuse.map((a: { kind: string; events: number }) => <li key={a.kind} className="flex justify-between px-4 py-2 text-sm"><span>{a.kind}</span><strong>{a.events}</strong></li>)}</ul>}
      </section>
      <section>
        <h2 className="font-display text-xl font-semibold">Accounts</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-left text-sm"><thead><tr><th className="p-3">Account</th><th className="p-3">Plan / limit</th><th className="p-3">Actions</th></tr></thead><tbody className="divide-y divide-ink/10">
            {(profiles ?? []).map((p: { id: string; display_name: string | null; plan: string; monthly_send_limit: number }) => (
              <tr key={p.id}><td className="p-3">{p.display_name || p.id}</td><td className="p-3">{p.plan} / {p.monthly_send_limit}/month</td><td className="p-3">
                <form action={setPlan} className="inline-flex gap-2"><input type="hidden" name="id" value={p.id} /><select name="plan" defaultValue={p.plan} className="rounded border px-2 py-1"><option value="starter">Starter</option><option value="growth">Growth</option><option value="scale">Scale</option></select><button className="underline">Save plan</button></form>
                <form action={setAccountStatus} className="ml-4 inline"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="disabled" value="on" /><button className="text-post underline">Disable</button></form>
                <form action={setAccountStatus} className="ml-3 inline"><input type="hidden" name="id" value={p.id} /><button className="underline">Enable</button></form>
              </td></tr>))}
          </tbody></table>
        </div>
      </section>
      <section>
        <h2 className="font-display text-xl font-semibold">Recent audit log</h2>
        {!recentAudit?.length ? <p className="mt-2 text-sm text-ink/70">No audit events.</p> :
          <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">{recentAudit.map((e: { id: string; action: string; created_at: string }) => <li key={e.id} className="px-4 py-2 text-sm"><strong>{e.action}</strong><span className="ml-3 text-ink/60">{new Date(e.created_at).toISOString()}</span></li>)}</ul>}
      </section>
    </main>
  );
}
