export function ComingSoon({ title, phase, children }: { title: string; phase: number; children?: React.ReactNode }) {
  return (
    <section>
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-ink/30 p-8">
        <p className="font-medium">Not available yet</p>
        <p className="mt-1 text-sm text-ink/70">{children ?? "This page is built in Phase"} {phase}. Nothing here is simulated.</p>
      </div>
    </section>
  );
}
