"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [["Overview","/dashboard"],["Compose Email","/dashboard/compose"],["Campaigns","/dashboard/campaigns"],["Contacts","/dashboard/contacts"],["Sender Accounts","/dashboard/senders"],["Templates","/dashboard/templates"],["Email Activity","/dashboard/activity"],["Settings","/dashboard/settings"]] as const;
export function Sidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto p-3 md:flex-col">
      {items.map(([label, href]) => {
        const on = href === "/dashboard" ? path === href : path.startsWith(href);
        return <Link key={href} href={href} aria-current={on ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${on ? "bg-ink text-white" : "hover:bg-mist"}`}>{label}</Link>;
      })}
    </nav>
  );
}
