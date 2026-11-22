import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { login } from "../actions";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const q = await searchParams;
  return <AuthCard title="Log in" action={login} error={q.error} notice={q.notice}  submit="Log in" footer={<><Link className="underline" href="/forgot-password">Forgot password?</Link><br /><Link className="underline" href="/signup">Email me a sign-in link or start a free trial</Link></>} />;
}
