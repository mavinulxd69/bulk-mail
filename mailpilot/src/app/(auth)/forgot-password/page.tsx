import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { forgotPassword } from "../actions";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const q = await searchParams;
  return <AuthCard title="Send reset link" action={forgotPassword} error={q.error} notice={q.notice} password={false} submit="Send reset link" footer={<><Link className="underline" href="/login">Back to log in</Link></>} />;
}
