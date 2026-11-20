import Link from "next/link";
import { PersonalizeDemo } from "@/components/personalize-demo";

const iconPaths = {
  shield: ["M12 3 19 6v5c0 4.7-3 8.2-7 10-4-1.8-7-5.3-7-10V6l7-3Z", "m9 12 2 2 4-4"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M20 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  mail: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "m22 7-10 6L2 7"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 8v4l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  layers: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 16 9 5 9-5"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4", "M12 15v2"],
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
} as const;

type IconName = keyof typeof iconPaths;

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {iconPaths[name].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

const steps = [
  { n: "01", title: "Connect your sender", text: "Link Gmail with Google sign-in or verify a business domain through Resend. MailPilot never asks for your mailbox password." },
  { n: "02", title: "Choose your audience", text: "Import authorized contacts and select who should receive this campaign. Consent and suppression checks happen before sending." },
  { n: "03", title: "Write once, personalize", text: "Add contact fields to a message or ask AI for a first draft. Every email is rendered separately for its recipient." },
  { n: "04", title: "Preview, then approve", text: "Send yourself a test, review campaign details, and explicitly confirm before anything enters the sending queue." },
];

const features = [
  { icon: "users" as const, title: "Personal, not a mail merge", text: "Use each contact's own details to create a separate, one-to-one message." },
  { icon: "shield" as const, title: "Respect the recipient", text: "Consent records, unsubscribe links, and suppression checks are part of the workflow." },
  { icon: "check" as const, title: "Nothing sends by surprise", text: "Review and explicitly approve every campaign. AI can draft, but it never sends." },
  { icon: "layers" as const, title: "A durable sending queue", text: "Messages are tracked individually, with bounded retries and sending limits." },
  { icon: "mail" as const, title: "One address per message", text: "Each recipient gets their own email. Other contacts are never exposed in a shared To or CC field." },
  { icon: "clock" as const, title: "Clear delivery activity", text: "See queued, accepted, delivered, and failed states without treating provider acceptance as delivery." },
];

const faqs = [
  ["Can I upload a purchased list?", "No. MailPilot is for people you are authorized to contact. Imports require an authorization attestation, and campaigns recheck consent and suppression status."],
  ["Does AI send messages for me?", "No. AI can suggest a draft, but you review the content, preview personalized messages, and explicitly confirm the campaign yourself."],
  ["Which email accounts can I connect?", "MailPilot currently supports Gmail and Google Workspace through OAuth, plus Resend with a verified sending domain."],
  ["Does MailPilot read my inbox?", "The Google integration requests permission to send mail, not to read your inbox. You can disconnect an account from Sender Accounts."],
  ["Are subscriptions available?", "Not yet. The plan section is a billing-ready preview only; no payment is collected and no plan can be purchased from this page."],
  ["What does “accepted” mean?", "It means the email provider accepted the send request. It is not a guarantee of delivery. MailPilot shows delivery only when a provider confirms it."],
];

const safeguards: { icon: IconName; title: string; text: string }[] = [
  { icon: "lock", title: "Encrypted credentials", text: "OAuth tokens are encrypted at rest; server credentials stay on the server." },
  { icon: "users", title: "Tenant isolation", text: "Row-level security separates each workspace's user data." },
  { icon: "shield", title: "Consent-aware sending", text: "Authorization, unsubscribe, and suppression checks are built into campaigns." },
  { icon: "check", title: "Human approval", text: "A person must explicitly confirm a campaign before it can enter the queue." },
];

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" aria-label="MailPilot home" className={`inline-flex items-center gap-2.5 font-display text-xl font-bold tracking-tight ${inverse ? "text-white" : "text-ink"}`}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-post text-white">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path d="m3 11 18-8-7.5 18-2.2-7.2L3 11Z" fill="currentColor" />
          <path d="m11.3 13.8 4.5-4.5" stroke="#E5484D" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      MailPilot
    </Link>
  );
}

function SampleCampaign() {
  return (
    <div aria-label="Illustrative MailPilot campaign preview" className="relative mx-auto w-full max-w-[550px]">
      <div className="absolute -left-7 top-16 hidden h-28 w-28 rounded-full bg-[#dbe9ff] blur-2xl sm:block" />
      <div className="absolute -right-4 bottom-8 hidden h-36 w-36 rounded-full bg-[#ffe1dc] blur-2xl sm:block" />
      <div className="relative rounded-[26px] border border-white/80 bg-white/90 p-3 shadow-[0_30px_90px_-40px_rgba(14,27,61,0.42)] backdrop-blur">
        <div className="rounded-[19px] border border-ink/10 bg-[#fbfcfe] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#67c7a2]" />
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/55">Illustrative campaign</span>
            </div>
            <span className="rounded-full bg-[#fff1e8] px-3 py-1 text-[11px] font-semibold text-[#9b4a2b]">Ready for review</span>
          </div>

          <div className="mt-7 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink/50">CAMPAIGN</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">A note for your community</h2>
            </div>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#eaf0ff] text-[#4265ba]">
              <Icon name="mail" className="h-5 w-5" />
            </span>
          </div>

          <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-4">
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 pb-3">
              <span className="text-sm font-semibold text-ink">Personalized preview</span>
              <span className="text-xs text-ink/50">One recipient</span>
            </div>
            <div className="space-y-3 py-4 text-sm">
              <p><span className="inline-block w-14 text-ink/45">To</span><span className="font-medium text-ink">Jordan Lee</span><span className="ml-2 text-ink/45">&lt;jordan@example.com&gt;</span></p>
              <p><span className="inline-block w-14 text-ink/45">Subject</span><span className="font-medium text-ink">A quick update for Jordan</span></p>
            </div>
            <div className="rounded-xl bg-[#f7f8fc] p-4 text-sm leading-6 text-ink/75">
              <p>Hello Jordan,</p>
              <p className="mt-2">Here is the update we discussed. Your message is rendered with Jordan&apos;s own details.</p>
              <p className="mt-3 text-xs text-ink/40">Unsubscribe link included</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {[["Audience", "Selected"], ["Test email", "Reviewed"], ["Approval", "Required"]].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white px-3 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-ink/45">{label}</p>
                <p className="mt-1 text-xs font-semibold text-ink sm:text-sm">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-ink/40">A product illustration — no campaign is being sent.</p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="overflow-hidden bg-[#fbfcfe] text-ink">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-white p-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-ink/5 bg-[#fbfcfe]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3.5 sm:px-8">
          <Brand />
          <nav aria-label="Main navigation" className="hidden items-center gap-7 text-sm font-medium text-ink/65 lg:flex">
            <a href="#how" className="transition hover:text-ink">How it works</a>
            <a href="#features" className="transition hover:text-ink">Features</a>
            <a href="#security" className="transition hover:text-ink">Security</a>
            <a href="#pricing" className="transition hover:text-ink">Pricing</a>
            <a href="#faq" className="transition hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden rounded-full px-3 py-2 text-sm font-medium text-ink/70 transition hover:text-ink sm:inline-flex">Log in</Link>
            <Link href="/signup" className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1b2c55] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post sm:px-5">
              Get started <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <details className="relative lg:hidden">
              <summary aria-label="Open navigation menu" className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-full border border-ink/10 text-ink [&::-webkit-details-marker]:hidden">
                <span className="sr-only">Menu</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
              </summary>
              <nav aria-label="Mobile navigation" className="absolute right-0 top-12 grid min-w-48 gap-1 rounded-2xl border border-ink/10 bg-white p-2 text-sm shadow-xl">
                {[["How it works", "#how"], ["Features", "#features"], ["Security", "#security"], ["Pricing", "#pricing"], ["FAQ", "#faq"], ["Log in", "/login"]].map(([label, href]) => (
                  <a key={href} href={href} className="rounded-xl px-3 py-2.5 text-ink/75 hover:bg-mist hover:text-ink">{label}</a>
                ))}
              </nav>
            </details>
          </div>
        </div>
      </header>

      <div id="main-content">
        <section className="relative isolate">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_75%_35%,rgba(220,232,255,0.68),transparent_36%),radial-gradient(ellipse_at_15%_5%,rgba(255,230,226,0.48),transparent_30%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10 lg:pb-28 lg:pt-24">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#dce4f1] bg-white/80 px-3.5 py-2 text-xs font-semibold text-ink/65 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[#69b99a]" />
                Thoughtful email, built around people
              </div>
              <h1 className="mt-7 font-display text-[2.8rem] font-semibold leading-[1.05] tracking-[-0.045em] text-ink sm:text-6xl lg:text-[4.25rem]">
                Send one message.<br />
                <span className="text-[#516caa]">Make it personal.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-ink/65 sm:text-lg sm:leading-8">
                MailPilot helps you create thoughtful, individualized email campaigns for people you&apos;re authorized to contact—then gives you the final say before anything sends.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-post px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(229,72,77,0.7)] transition hover:-translate-y-0.5 hover:bg-[#d83d43] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                  Start Sending Smarter <Icon name="arrow" className="h-4 w-4" />
                </Link>
                <a href="#features" className="inline-flex min-h-12 items-center justify-center rounded-full border border-ink/15 bg-white/70 px-6 py-3 text-sm font-semibold text-ink transition hover:border-ink/30 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-post">
                  Explore Features
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-ink/55">
                <span className="inline-flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-[#38836b]" /> Review before sending</span>
                <span className="inline-flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-[#38836b]" /> Built for authorized outreach</span>
              </div>
            </div>
            <SampleCampaign />
          </div>
        </section>

        <section aria-label="Product principles" className="border-y border-ink/5 bg-white">
          <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:grid-cols-3 sm:px-8 sm:py-7">
            {[
              ["01", "Your voice", "Write it yourself or refine an AI-assisted draft."],
              ["02", "Your audience", "Work with contacts you have permission to reach."],
              ["03", "Your approval", "Nothing enters the queue without your confirmation."],
            ].map(([n, title, text]) => (
              <div key={n} className="flex gap-4 sm:px-4">
                <span className="font-display text-sm font-semibold text-post">{n}</span>
                <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-ink/55">{text}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">Meet MailPilot</p>
            <h2 className="mt-4 max-w-xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Campaign tools with a more human point of view.</h2>
          </div>
          <div>
            <p className="text-base leading-7 text-ink/65">A campaign shouldn&apos;t mean a compromise between doing things at scale and treating people like people. MailPilot turns your contact details into individual messages, then keeps audience checks, previews, approvals, and delivery activity in one clear workflow.</p>
            <a href="#how" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#405a98] transition hover:gap-3">
              See how it works <Icon name="arrow" className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section id="how" className="scroll-mt-24 bg-[#f2f5fa] py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">A clear workflow</p>
              <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">From first draft to approved send.</h2>
              <p className="mt-4 leading-7 text-ink/60">Keep the important decisions in your hands, with practical checks at each step.</p>
            </div>
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step) => (
                <li key={step.n} className="rounded-2xl border border-ink/5 bg-white p-6 shadow-[0_10px_30px_-28px_rgba(14,27,61,0.45)]">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0ee] font-display text-sm font-bold text-post">{step.n}</span>
                  <h3 className="mt-5 font-display text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/60">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">Made for considered communication</p>
              <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">The details that make a campaign feel considered.</h2>
            </div>
            <p className="max-w-md leading-7 text-ink/60">A focused toolkit for useful outreach—not a collection of tricks to push more email.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article key={feature.title} className="rounded-2xl border border-ink/10 bg-white p-6 transition hover:-translate-y-0.5 hover:border-[#cbd6e9] hover:shadow-lg hover:shadow-ink/5">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#eef3ff] text-[#5069a7]"><Icon name={feature.icon} className="h-5 w-5" /></span>
                <h3 className="mt-5 font-display text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink/60">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="personalization" className="scroll-mt-24 border-y border-ink/5 bg-[#f8f9fc] py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">Personalization, made visible</p>
              <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">See the message each person will receive.</h2>
              <p className="mt-5 leading-7 text-ink/65">Preview contact-specific details before approval. If a message can&apos;t be personalized safely, MailPilot flags it for you instead of sending a half-filled email.</p>
              <div className="mt-7 space-y-3">
                {["Switch between recipients", "Check subject and message fields", "Review individual unsubscribe links"].map((item) => (
                  <p key={item} className="flex items-center gap-3 text-sm font-medium text-ink/75"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e8f4ee] text-[#398365]"><Icon name="check" className="h-3.5 w-3.5" /></span>{item}</p>
                ))}
              </div>
            </div>
            <div className="rounded-[28px] bg-[#e8edf7] p-4 sm:p-7">
              <PersonalizeDemo />
              <p className="mt-4 text-center text-xs text-ink/50">Interactive sample — select a recipient to view their personalized message.</p>
            </div>
          </div>
        </section>

        <section id="integrations" className="scroll-mt-24 mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">Connect your sender</p>
              <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Send from accounts you already trust.</h2>
              <p className="mt-4 max-w-xl leading-7 text-ink/60">Connect a Gmail or Google Workspace account with Google OAuth, or use Resend with a verified sending domain. You stay in control of which sender each campaign uses.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="rounded-2xl border border-ink/10 bg-white p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f3f5f8] font-display text-lg font-bold text-[#5575c8]">G</span>
                  <div><h3 className="font-semibold">Gmail &amp; Google Workspace</h3><p className="mt-0.5 text-xs text-ink/50">Connect with Google OAuth</p></div>
                </div>
                <p className="mt-5 text-sm leading-6 text-ink/60">Send-only access. Revoke the connection from your account settings whenever you choose.</p>
              </article>
              <article className="rounded-2xl border border-ink/10 bg-white p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff0e8] font-display text-lg font-bold text-[#d15e33]">R</span>
                  <div><h3 className="font-semibold">Resend</h3><p className="mt-0.5 text-xs text-ink/50">Verified business domains</p></div>
                </div>
                <p className="mt-5 text-sm leading-6 text-ink/60">Use a domain you own and complete verification before sending campaigns from it.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="security" className="scroll-mt-24 bg-[#101b36] py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff9b91]">Security &amp; privacy</p>
              <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Trust is part of the product—not a checkbox.</h2>
              <p className="mt-5 max-w-xl leading-7 text-white/65">Email touches real people. MailPilot is designed to keep access limited, data separated, and sending intentional.</p>
              <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#101b36] transition hover:bg-[#e9eef8]">
                Start Sending Smarter <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {safeguards.map(({ icon, title, text }) => (
                <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-[#ffb0a7]"><Icon name={icon} className="h-5 w-5" /></span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/60">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 bg-[#f2f5fa] py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">Plans</p>
              <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Straightforward plans, when billing is ready.</h2>
              <p className="mt-4 leading-7 text-ink/60">Plan structure preview. Billing is not connected, these are not purchasable, and no payment will be collected.</p>
            </div>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {[
                { name: "Starter", volume: "Up to 100", detail: "emails per month", note: "A considered place to begin." },
                { name: "Growth", volume: "Up to 5,000", detail: "emails per month", note: "For growing communication needs.", featured: true },
                { name: "Scale", volume: "Up to 100,000", detail: "emails per month", note: "For larger, established teams." },
              ].map((plan) => (
                <article key={plan.name} className={`relative rounded-2xl border p-6 ${plan.featured ? "border-[#9eafd8] bg-white shadow-xl shadow-[#293e70]/10" : "border-ink/10 bg-white/70"}`}>
                  {plan.featured && <span className="absolute right-5 top-5 rounded-full bg-[#eef2fc] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#4c6198]">Plan preview</span>}
                  <h3 className="font-display text-xl font-semibold">{plan.name}</h3>
                  <p className="mt-6 font-display text-3xl font-semibold tracking-tight">{plan.volume}</p>
                  <p className="mt-1 text-sm text-ink/55">{plan.detail}</p>
                  <p className="mt-5 border-t border-ink/10 pt-4 text-sm text-ink/60">{plan.note}</p>
                  <p className="mt-6 text-xs font-medium text-ink/45">Billing not active</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 mx-auto max-w-4xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-post">Good to know</p>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Frequently asked questions</h2>
          </div>
          <div className="mt-10 divide-y divide-ink/10 border-y border-ink/10">
            {faqs.map(([question, answer]) => (
              <details key={question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-semibold marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-post [&::-webkit-details-marker]:hidden">
                  {question}
                  <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#f0f3f9] text-ink/55 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-3xl pr-10 text-sm leading-7 text-ink/60">{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

      <footer className="bg-[#0b142b] text-white">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-14">
          <div className="flex flex-col justify-between gap-10 border-b border-white/10 pb-10 sm:flex-row sm:items-start">
            <div>
              <Brand inverse />
              <p className="mt-4 max-w-sm text-sm leading-6 text-white/55">Thoughtful, individualized email for people you&apos;re authorized to contact.</p>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm sm:gap-x-16">
              <a href="#how" className="text-white/65 transition hover:text-white">How it works</a>
              <a href="#features" className="text-white/65 transition hover:text-white">Features</a>
              <a href="#security" className="text-white/65 transition hover:text-white">Security</a>
              <a href="#pricing" className="text-white/65 transition hover:text-white">Pricing</a>
              <a href="#faq" className="text-white/65 transition hover:text-white">FAQ</a>
              <Link href="/login" className="text-white/65 transition hover:text-white">Log in</Link>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} MailPilot. Consent-based communication only.</p>
            <p className="inline-flex items-center gap-1.5"><Icon name="shield" className="h-3.5 w-3.5" /> No scraping. No surprise sends.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
