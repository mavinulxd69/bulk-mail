import { updatePassword } from "../actions";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const q = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-6"><div className="w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold">Choose a new password</h1>
      {q.error && <p role="alert" className="mt-4 rounded-lg bg-post/10 p-3 text-sm text-post">{q.error}</p>}
      <form action={updatePassword} className="mt-6 space-y-4">
        <label className="block text-sm font-medium">New password<input name="password" type="password" required minLength={10} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-ink/25 bg-white px-3 py-2" /></label>
        <button className="w-full rounded-full bg-ink px-4 py-2.5 font-medium text-white">Update password</button>
      </form></div></main>
  );
}
