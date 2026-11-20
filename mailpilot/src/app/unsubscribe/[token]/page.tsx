import { admin } from "@/lib/supabase/admin";
import { maskEmail, TOKEN_RE } from "@/lib/queue/unsubscribe";
import { confirmUnsubscribe } from "./actions";

export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
// A GET only shows a confirmation button. Mail scanners that pre-fetch links therefore can't unsubscribe anyone by accident.
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params; const { done } = await searchParams;
  let email: string | null = null, already = false;
  if (TOKEN_RE.test(token)) {
    const db = admin();
    const { data: r } = await db.from("campaign_recipients").select("user_id,email").eq("unsubscribe_token", token).maybeSingle();
    if (r?.email) { email = r.email as string; const { count } = await db.from("suppressions").select("id", { count: "exact", head: true }).eq("user_id", r.user_id).eq("email", r.email); already = (count ?? 0) > 0; }
  }
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="font-display text-2xl font-bold">Unsubscribe</h1>
      {!email ? <p className="mt-4 text-ink/80">This unsubscribe link isn&apos;t valid any more. If you still get email you don&apos;t want, reply to it and ask to be removed.</p> :
        done || already ? <p role="status" className="mt-4 rounded-lg bg-sky p-3">{maskEmail(email)} is unsubscribed. You won&apos;t get more email from this sender.</p> :
        <form action={confirmUnsubscribe} className="mt-4 space-y-4"><p>Stop all email to <strong>{maskEmail(email)}</strong> from this sender?</p>
          <input type="hidden" name="token" value={token} /><button className="rounded-full bg-ink px-5 py-2 text-white">Yes, unsubscribe me</button></form>}
    </main>
  );
}
