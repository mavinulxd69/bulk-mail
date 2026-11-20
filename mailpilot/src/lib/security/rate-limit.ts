import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

const memory = new Map<string, { count: number; reset: number }>();
const minute = 60_000;

function defaultLimit() {
  const n = Number.parseInt(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? "10", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 10;
}

function bucketHash(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export type LimitResult = { allowed: boolean; retryAfter: number; thresholdCrossed: boolean };

export async function checkRequestLimit(key: string, limit = defaultLimit()): Promise<LimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const currentMinute = Math.floor(Date.now() / minute);
  const hashedKey = bucketHash(key);
  const bucket = `mailpilot:request:${currentMinute}:${hashedKey}`;

  if (url && token) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/multi-exec`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", bucket], ["EXPIRE", bucket, 60]]),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Upstash returned HTTP ${res.status}`);
      const results = await res.json() as { result?: number; error?: string }[];
      const count = results?.[0]?.result;
      if (results?.[0]?.error || results?.[1]?.error || typeof count !== "number") throw new Error("Upstash returned an invalid rate-limit response");
      return { allowed: count <= limit, retryAfter: 60, thresholdCrossed: count === limit + 1 };
    } catch (error) {
      console.error("[rate-limit] Upstash request failed", error instanceof Error ? error.message : "unknown error");
      return { allowed: false, retryAfter: 60, thresholdCrossed: false };
    }
  }

  if (process.env.NODE_ENV === "production") {
    console.error("[rate-limit] Upstash is required in production but is not configured");
    return { allowed: false, retryAfter: 60, thresholdCrossed: false };
  }

  const now = Date.now();
  const reset = now - (now % minute) + minute;
  const entry = memory.get(bucket);
  if (!entry || entry.reset <= now) memory.set(bucket, { count: 1, reset });
  else entry.count += 1;
  const count = memory.get(bucket)!.count;
  if (memory.size > 1000) {
    for (const [k, item] of memory) if (item.reset <= now) memory.delete(k);
  }
  return { allowed: count <= limit, retryAfter: Math.ceil((reset - now) / 1000), thresholdCrossed: count === limit + 1 };
}

function clientIp(h: Headers) {
  return h.get("x-vercel-forwarded-for")
    ?? h.get("x-real-ip")
    ?? h.get("cf-connecting-ip")
    ?? h.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export async function checkIncomingRequestLimit(scope: string, h: Headers, identity?: string, limit = defaultLimit()) {
  const ip = clientIp(h);
  const result = await checkRequestLimit(`${scope}:ip:${ip}`, limit);
  if (!result.allowed || !identity) return { ...result, ip, bucket: "ip" as const };
  const identityResult = await checkRequestLimit(`${scope}:identity:${identity.trim().toLowerCase().slice(0, 320)}`, limit);
  return { ...identityResult, ip, bucket: "identity" as const };
}

export async function checkClientRequestLimit(scope: string, identity?: string, limit = defaultLimit()) {
  return checkIncomingRequestLimit(scope, await headers(), identity, limit);
}
