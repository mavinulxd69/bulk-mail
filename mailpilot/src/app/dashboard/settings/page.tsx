import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
async function saveProfile(fd: FormData) {
  "use server";
  const name = z.string().trim().max(80).safeParse(fd.get("display_name"));
  if (!name.success) return;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) await sb.from("profiles").update({ display_name: name.data }).eq("id", user.id);
  revalidatePath("/dashboard/settings");
}
export default async function Settings() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: profile } = await sb.from("profiles").select("display_name").eq("id", user!.id).single();
  return (
    <section className="max-w-md">
      <h1 className="font-display text-3xl font-bold">Settings</h1>
      <form action={saveProfile} className="mt-6 space-y-4">
        <label className="block text-sm font-medium">Display name<input name="display_name" defaultValue={profile?.display_name ?? ""} maxLength={80} className="mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2" /></label>
        <button className="rounded-full bg-ink px-4 py-2 text-white">Save changes</button>
      </form>
      <p className="mt-10 text-sm text-ink/70">Password change and account deletion arrive in Phase 7 (deletion needs the server-side admin API).</p>
    </section>
  );
}
