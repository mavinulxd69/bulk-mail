import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { logout } from "../(auth)/actions";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-ink/10 bg-white md:border-b-0 md:border-r">
        <Link href="/" className="block px-6 pt-5 font-display text-xl font-bold">MailPilot</Link>
        <Sidebar />
      </aside>
      <div>
        <header className="flex items-center justify-end gap-4 border-b border-ink/10 px-6 py-3 text-sm">
          <span className="text-ink/70">{user?.email}</span>
          <form action={logout}><button className="rounded-full border border-ink/25 px-3 py-1 hover:bg-mist">Log out</button></form>
        </header>
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      </div>
    </div>
  );
}
