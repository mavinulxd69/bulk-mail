export function PageLoading({ label = "Loading page" }: { label?: string }) {
  return (
    <section aria-busy="true" aria-live="polite" className="mx-auto w-full max-w-7xl space-y-6 py-6">
      <span className="sr-only">{label}</span>
      <div className="animate-pulse space-y-3 motion-reduce:animate-none">
        <div className="h-3 w-28 rounded bg-ink/10" />
        <div className="h-8 w-64 max-w-full rounded-lg bg-ink/10" />
        <div className="h-4 w-96 max-w-full rounded bg-ink/5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} aria-hidden="true" className="h-36 animate-pulse rounded-2xl border border-ink/10 bg-white motion-reduce:animate-none" />)}
      </div>
    </section>
  );
}
