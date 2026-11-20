import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export default async function Admin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: p } = user ? await sb.from("profiles").select("is_admin").eq("id", user.id).single() : { data: null };
  if (!p?.is_admin) notFound();
  return <main className="mx-auto max-w-3xl p-6"><h1 className="font-display text-3xl font-bold">Admin</h1><p className="mt-2 text-sm text-ink/70">Abuse monitoring and user management arrive in Phase 7.</p></main>;
}
