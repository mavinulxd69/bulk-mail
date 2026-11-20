"use client";

import { useEffect } from "react";

export function RouteError({ error, reset, homeHref = "/" }: { error: Error & { digest?: string }; reset: () => void; homeHref?: string }) {
  useEffect(() => {
    console.error("[app] page rendering failed", error.digest ?? "no error digest");
  }, [error]);

  return (
    <section role="alert" className="mx-auto max-w-2xl rounded-2xl border border-post/20 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-post">Something went wrong</p>
      <h1 className="mt-2 font-display text-2xl font-bold">This page couldn&apos;t be loaded.</h1>
      <p className="mt-2 text-sm leading-6 text-ink/70">Try again, or return to a safe starting point.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post">
          Try again
        </button>
        <a href={homeHref} className="rounded-xl border border-ink/15 px-4 py-2.5 text-sm font-semibold transition hover:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post">
          Go back
        </a>
      </div>
    </section>
  );
}
