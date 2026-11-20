"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
/** Re-reads the page's server data every few seconds while a campaign is active. Pauses while the tab is hidden. */
export function AutoRefresh({ active, ms = 5000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return active ? <p className="text-xs text-ink/60" aria-live="off">Updating automatically…</p> : null;
}
