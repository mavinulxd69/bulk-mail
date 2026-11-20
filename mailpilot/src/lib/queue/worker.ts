import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { providerFor } from "@/lib/providers";
import { queueConfig, siteUrl, type QueueConfig } from "./config";
import { processJob, type Outcome, type ProcessDeps } from "./process";
import { supabaseStore } from "./store";
import type { QueueStore, SenderInfo } from "./types";

export type TickSummary = { worker: string; claimed: number; outcomes: Partial<Record<Outcome, number>>; errors: number; ms: number };

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]!); }));
}

/**
 * One worker run: housekeeping, then claim-and-send rounds until `budgetMs` is used up or nothing is due.
 * Safe to call from anywhere at any time and from many places at once (cron, a standalone process, the approval screen):
 * the database hands each job to exactly one caller, and everything it does is persisted, so an interrupted run loses nothing.
 */
export async function runTick(opts: { budgetMs?: number; store?: QueueStore; config?: QueueConfig; deps?: Partial<ProcessDeps>; worker?: string } = {}): Promise<TickSummary> {
  const started = Date.now(), deadline = started + (opts.budgetMs ?? 25_000);
  const store = opts.store ?? supabaseStore(), config = opts.config ?? queueConfig();
  const worker = opts.worker ?? `w-${randomUUID().slice(0, 8)}`;
  const deps: ProcessDeps = { store, config, siteUrl: siteUrl(), providerFor: (s: SenderInfo) => providerFor(s), ...opts.deps };
  const sum: TickSummary = { worker, claimed: 0, outcomes: {}, errors: 0, ms: 0 };
  const touched = new Set<string>();

  await store.heartbeat(process.env.VERCEL ? "vercel" : hostname().slice(0, 60)); // one row per host, not per run
  await store.housekeeping(config.leaseSeconds);
  do {
    const jobs = await store.claim({ worker, batch: config.batchSize, senderPerMinute: config.senderPerMinute, userPerDay: config.userPerDay });
    if (!jobs.length) break;
    sum.claimed += jobs.length;
    const contexts = await store.loadContexts(jobs);
    await pool(contexts, config.concurrency, async (ctx) => {
      touched.add(ctx.job.campaign_id);
      try { const o = await processJob(ctx, deps); sum.outcomes[o] = (sum.outcomes[o] ?? 0) + 1; }
      catch (e) { sum.errors++; console.error("[queue] job failed to record", ctx.job.id, e instanceof Error ? e.message : e); } // stays 'processing'; crash recovery handles it after the lease
    });
    await store.refreshCampaigns([...touched]);
  } while (Date.now() < deadline);
  await store.refreshActive();
  sum.ms = Date.now() - started;
  return sum;
}
