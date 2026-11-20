import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "../(auth)/actions";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[250px_minmax(0,1fr)]">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-white px-4 py-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-post">Skip to content</a>
      <aside className="border-b border-ink/10 bg-[#0c1732] text-white md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r md:border-white/5">
        <div className="flex items-center justify-between px-5 py-4 md:px-6 md:pb-7 md:pt-6">
          <Link href="/dashboard" className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky to-indigo-200 text-[#0c1732] shadow-lg shadow-sky/10">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 12 13l9-5.5M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path strokeLinecap="round" d="M8 3h8" /></svg>
            </span>
            <span><span className="block font-display text-lg font-bold tracking-tight">MailPilot</span><span className="block text-[11px] text-slate-400">EMAIL WORKSPACE</span></span>
          </Link>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200 md:hidden">Live</span>
        </div>
        <div className="hidden px-5 pb-4 md:block">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</p>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-slate-100">Personal workspace</span><svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-500"><path fillRule="evenodd" d="M5.2 7.5a.75.75 0 0 1 1.06 0L10 11.19l3.74-3.69a.75.75 0 1 1 1.05 1.07l-4.26 4.2a.75.75 0 0 1-1.05 0l-4.27-4.2a.75.75 0 0 1 0-1.07Z" clipRule="evenodd" /></svg></div>
          </div>
        </div>
        <p className="hidden px-7 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 md:block">Menu</p>
        <Sidebar />
        <div className="mt-auto hidden px-4 pb-4 md:block">
          <div className="mb-4 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4">
            <p className="text-sm font-semibold text-slate-100">Thoughtful sending, by design.</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">Every message is personalized, reviewed, and sent one recipient at a time.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-300 to-sky text-sm font-bold text-ink">{(user?.email?.[0] ?? "M").toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">{user?.email ?? "MailPilot user"}</span><span className="mt-0.5 block text-[10px] text-slate-500">Workspace owner</span></span>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-ink/10 bg-paper/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
          <div className="hidden text-sm sm:block"><span className="text-ink/50">MailPilot</span><span className="mx-2 text-ink/30">/</span><span className="font-medium">Workspace</span></div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <span aria-hidden="true" className="hidden h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-900 sm:flex">{(user?.email?.[0] ?? "M").toUpperCase()}</span>
            <span className="hidden max-w-[180px] truncate text-sm text-ink/70 lg:block">{user?.email}</span>
            <form action={logout}><button className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post">Log out</button></form>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-[1440px] px-4 py-7 sm:px-7 sm:py-9 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
