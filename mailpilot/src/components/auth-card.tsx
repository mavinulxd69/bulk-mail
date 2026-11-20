import Link from "next/link";
export function AuthCard({ title, action, error, notice, password = true, submit, footer }: { title: string; action: (fd: FormData) => Promise<void>; error?: string; notice?: string; password?: boolean; submit: string; footer: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-bold">MailPilot</Link>
        <h1 className="mt-6 font-display text-3xl font-bold">{title}</h1>
        {error && <p role="alert" className="mt-4 rounded-lg bg-post/10 p-3 text-sm text-post">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg bg-sky p-3 text-sm">{notice}</p>}
        <form action={action} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2 text-ink" /></label>
          {password && <label className="block text-sm font-medium">Password<input name="password" type="password" required minLength={10} autoComplete="current-password" className="mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2 text-ink" /></label>}
          <button className="w-full rounded-full bg-ink px-4 py-2.5 font-medium text-white hover:bg-ink/90">{submit}</button>
        </form>
        <div className="mt-6 space-y-1 text-sm text-ink/70">{footer}</div>
      </div>
    </main>
  );
}
