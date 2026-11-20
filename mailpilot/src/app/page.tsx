import Link from "next/link";
import { PersonalizeDemo } from "@/components/personalize-demo";
const steps = [
  ["Connect your sender", "Link Gmail with Google sign-in, or verify a business domain through Resend. We never ask for your mailbox password."],
  ["Import recipients you may contact", "Paste addresses or upload a CSV. Duplicates, bad formats and missing fields are flagged before anything is queued."],
  ["Write once, personalize for everyone", "Use {{name}}-style variables or let AI draft the first version. You edit it; the AI never sends."],
  ["Approve and watch it go", "Send yourself a test, confirm the campaign, then follow each message from pending to delivered."],
];
const features = [
  ["One email per person", "Every recipient gets their own message. No one sees anyone else's address."],
  ["Missing data stops the send", "If a variable has no value for a recipient, that campaign is blocked until you fix it."],
  ["Honest delivery status", "“Accepted by provider” and “Delivered” are different. We only say delivered when the provider confirms it."],
  ["A queue that survives restarts", "Jobs live in the database with idempotency keys, rate limits and capped retries."],
];
const faqs = [
  ["Can I email a purchased list?", "No. MailPilot is for recipients you are authorized to contact, and every contact records its consent source."],
  ["Does AI send my emails?", "Never. AI only writes drafts that you review, edit and approve."],
  ["Which senders work today?", "Gmail / Google Workspace and Resend-verified domains. The adapter layer is built so Microsoft Graph can follow."],
  ["Is billing live?", "Not yet. Plans below are placeholders until billing is connected."],
];
export default function Home() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-xl font-bold">MailPilot</span>
        <nav className="flex items-center gap-5 text-sm">
          <a href="#features" className="hover:underline">Features</a><a href="#pricing" className="hover:underline">Pricing</a><a href="#faq" className="hover:underline">FAQ</a>
          <Link href="/login" className="hover:underline">Log in</Link>
          <Link href="/signup" className="rounded-full bg-ink px-4 py-2 text-white hover:bg-ink/90">Start Sending Smarter</Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-12 md:grid-cols-2">
        <div>
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">Hundreds of emails. Each one written for one person.</h1>
          <p className="mt-6 max-w-md text-lg text-ink/75">Connect your own mailbox, import people who agreed to hear from you, and send individually personalized messages you approve first.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-full bg-post px-6 py-3 font-medium text-white hover:opacity-90">Start Sending Smarter</Link>
            <a href="#features" className="rounded-full border border-ink/25 px-6 py-3 font-medium hover:bg-mist">Explore Features</a>
          </div>
        </div>
        <PersonalizeDemo />
      </section>
      <section className="bg-mist py-20" id="how">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display text-3xl font-bold">How MailPilot works</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-2">
            {steps.map(([t, d], n) => (<li key={t} className="border-l-4 border-post pl-5"><h3 className="font-display text-xl font-semibold">{n + 1}. {t}</h3><p className="mt-2 max-w-md text-ink/75">{d}</p></li>))}
          </ol>
        </div>
      </section>
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl font-bold">Built to be trusted with your recipients</h2>
        <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {features.map(([t, d]) => (<div key={t}><dt className="font-display text-lg font-semibold">{t}</dt><dd className="mt-1 text-ink/75">{d}</dd></div>))}
        </dl>
        <p className="mt-12 max-w-2xl rounded-xl bg-ink p-6 text-sky">Security: OAuth tokens are encrypted at rest, API keys stay on the server, and database row-level security keeps each workspace fully separate. Integrations: Gmail, Google Workspace, Resend business domains.</p>
      </section>
      <section id="pricing" className="bg-mist py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display text-3xl font-bold">Pricing</h2><p className="mt-2 text-ink/70">Placeholder plans — billing is not connected yet.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[["Starter", "Free", "100 emails / month"], ["Growth", "To be announced", "5,000 emails / month"], ["Scale", "To be announced", "Custom volume"]].map(([n, p, d]) => (
              <div key={n} className="rounded-xl bg-white p-6"><h3 className="font-display text-xl font-semibold">{n}</h3><p className="mt-1">{p}</p><p className="mt-3 text-sm text-ink/70">{d}</p></div>))}
          </div>
        </div>
      </section>
      <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-display text-3xl font-bold">Questions</h2>
        <div className="mt-6 divide-y divide-ink/15">
          {faqs.map(([q, a]) => (<details key={q} className="py-4"><summary className="cursor-pointer font-medium">{q}</summary><p className="mt-2 text-ink/75">{a}</p></details>))}
        </div>
      </section>
      <footer className="border-t border-ink/10 px-6 py-8 text-center text-sm text-ink/60">© MailPilot. Consent-based email only.</footer>
    </main>
  );
}
