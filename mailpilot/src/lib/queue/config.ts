// Queue tuning, all from environment with safe bounds. A bad value falls back to the default instead of breaking sending.
const int = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return v && Number.isInteger(n) && n >= min && n <= max ? n : d; };

export type QueueConfig = {
  maxAttempts: number;      // per message, including the first try
  senderPerMinute: number;  // hard ceiling per sender account across all its campaigns
  userPerDay: number;       // rolling 24 h cap per user (accepted + in flight)
  batchSize: number;        // jobs claimed per round
  concurrency: number;      // jobs sent in parallel inside one worker
  leaseSeconds: number;     // a claimed job not finished by then is treated as a crashed worker's
  retryBaseSeconds: number; // first retry delay; grows x4 per attempt
  quotaPauseMinutes: number; // first pause after a provider quota error; doubles, capped at 24 h
};

export const queueConfig = (): QueueConfig => ({
  maxAttempts: int(process.env.SEND_MAX_ATTEMPTS, 4, 1, 10),
  senderPerMinute: int(process.env.SENDER_MAX_PER_MINUTE, 60, 1, 600),
  userPerDay: int(process.env.USER_DAILY_SEND_LIMIT, 500, 1, 1_000_000),
  batchSize: int(process.env.WORKER_BATCH_SIZE, 10, 1, 100),
  concurrency: int(process.env.WORKER_CONCURRENCY, 4, 1, 20),
  leaseSeconds: int(process.env.WORKER_LEASE_SECONDS, 120, 30, 3600),
  retryBaseSeconds: int(process.env.SEND_RETRY_BASE_SECONDS, 30, 1, 3600),
  quotaPauseMinutes: int(process.env.QUOTA_PAUSE_MINUTES, 30, 1, 720),
});

/** The public https address used in unsubscribe links. Null when it is missing or unsafe for real mail. */
export function siteUrl(env: { NEXT_PUBLIC_SITE_URL?: string; NODE_ENV?: string } = process.env): string | null {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(env.NODE_ENV !== "production" && u.protocol === "http:")) return null;
    return `${u.origin}`;
  } catch { return null; }
}
