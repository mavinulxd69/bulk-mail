"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [
  { label: "Overview", href: "/dashboard", icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></> },
  { label: "Compose Email", href: "/dashboard/compose", icon: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z" /></> },
  { label: "Campaigns", href: "/dashboard/campaigns", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 7 9 6 9-6M7 17h4" /></> },
  { label: "Contacts", href: "/dashboard/contacts", icon: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.2a3 3 0 0 1 0 5.6M18 14a5 5 0 0 1 3 4.6v1" /></> },
  { label: "Sender Accounts", href: "/dashboard/senders", icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6M7 15h3" /></> },
  { label: "Templates", href: "/dashboard/templates", icon: <><path d="M5 3h11l3 3v15H5z" /><path d="M9 3v6h6V3M8 14h8m-8 4h8" /></> },
  { label: "Email Activity", href: "/dashboard/activity", icon: <><path d="M3 12h4l3-8 4 16 3-8h4" /></> },
  { label: "Settings", href: "/dashboard/settings", icon: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2.9Z" /></> },
] as const;
export function Sidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-4 md:pb-0">
      <p className="sr-only">Workspace navigation</p>
      {items.map(({ label, href, icon }) => {
        const on = href === "/dashboard" ? path === href : path.startsWith(href);
        return <Link key={href} href={href} aria-current={on ? "page" : undefined}
          className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post ${on ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] shrink-0 ${on ? "text-sky" : "text-slate-400 group-hover:text-slate-200"}`}>{icon}</svg>
          <span>{label}</span>{label === "Compose Email" && <span className="ml-auto hidden rounded-md bg-post px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white md:inline">New</span>}
        </Link>;
      })}
    </nav>
  );
}
