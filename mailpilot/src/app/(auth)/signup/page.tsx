import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { signup } from "../actions";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const q = await searchParams;
  return <AuthCard
    title="Start your free trial"
    action={signup}
    error={q.error}
    notice={q.notice}
    description="Enter your email and we’ll send a secure sign-in link. No password or full account setup. Verify your email to unlock 20 campaign emails; connect your own sender and email only people who agreed to hear from you."
    password={false}
    submit="Email me a sign-in link"
    footer={<><Link className="underline" href="/login">Already have an account? Log in</Link></>}
  />;
}
