import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { signup } from "../actions";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const q = await searchParams;
  return <AuthCard title="Create account" action={signup} error={q.error} notice={q.notice}  submit="Create account" footer={<><Link className="underline" href="/login">Already have an account? Log in</Link></>} />;
}
