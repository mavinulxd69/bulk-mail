import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runTick } from "@/lib/queue/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const sha = (s: string) => createHash("sha256").update(s).digest();

// Called by a scheduler (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"). Never open: without CRON_SECRET it refuses to run.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(sha(given), sha(secret))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runTick({ budgetMs: 45_000 })); }
  catch (e) { console.error("[worker] tick failed", e instanceof Error ? e.message : e); return NextResponse.json({ error: "tick failed" }, { status: 500 }); }
}
export const GET = handle, POST = handle;
