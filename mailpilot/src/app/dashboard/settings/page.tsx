import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
async function saveProfile(fd: FormData) {
  "use server";
  const name = z.string().trim().max(80).safeParse(fd.get("display_name"));
  if (!name.success) return;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) await sb.from("profiles").update({ display_name: name.data }).eq("id", user.id);
  revalidatePath("/dashboard/settings");
}

async function changePassword(fd: FormData) {
  "use server";
  const password = z.string().min(10).max(128).safeParse(fd.get("password"));
  if (!password.success) redirect("/dashboard/settings?error=Password+must+be+10+to+128+characters");
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: password.data });
  if (error) redirect("/dashboard/settings?error=Could+not+change+your+password");
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?notice=Password+changed");
}

async function deleteAccount(fd: FormData) {
  "use server";
  if (fd.get("confirm") !== "on") redirect("/dashboard/settings?error=Confirm+account+deletion");
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const db = admin();
  await db.from("audit_logs").insert({ user_id: user.id, action: "account.delete_requested", detail: {} });
  await db.from("abuse_events").insert({ user_id: user.id, kind: "account_delete", detail: {} });
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) redirect("/dashboard/settings?error=Could+not+delete+your+account");
  await sb.auth.signOut();
  redirect("/?notice=Account+deleted");
}
export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const q = await searchParams;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: profile } = await sb.from("profiles").select("display_name").eq("id", user!.id).single();
  return (
    <section className="max-w-md">
      <h1 className="font-display text-3xl font-bold">Settings</h1>
      {q.error && <p role="alert" className="mt-4 rounded-lg bg-post/10 p-3 text-sm text-post">{q.error}</p>}
      {q.notice && <p role="status" className="mt-4 rounded-lg bg-sky p-3 text-sm">{q.notice}</p>}
      <form action={saveProfile} className="mt-6 space-y-4">
        <label className="block text-sm font-medium">Display name<input name="display_name" defaultValue={profile?.display_name ?? ""} maxLength={80} className="mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2" /></label>
        <button className="rounded-full bg-ink px-4 py-2 text-white">Save changes</button>
      </form>
      <form action={changePassword} className="mt-10 space-y-3">
        <h2 className="font-display text-xl font-semibold">Change password</h2>
        <label className="block text-sm font-medium">New password<input name="password" type="password" minLength={10} maxLength={128} required className="mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2" /></label>
        <button className="rounded-full bg-ink px-4 py-2 text-white">Change password</button>
      </form>
      <form action={deleteAccount} className="mt-10 rounded-xl border border-post/30 p-4">
        <h2 className="font-display text-xl font-semibold text-post">Delete account</h2>
        <p className="mt-2 text-sm text-ink/70">This permanently deletes your account and all MailPilot workspace data. It cannot be undone.</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" value="on" required /> I understand this is permanent</label>
        <button className="mt-4 rounded-full bg-post px-4 py-2 text-sm text-white">Delete my account</button>
      </form>
    </section>
  );
}
