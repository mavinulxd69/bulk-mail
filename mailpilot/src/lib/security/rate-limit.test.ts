import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRequestLimit } from "./rate-limit";

describe("checkRequestLimit", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("allows a bounded number of requests in one process", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_PER_MINUTE", "2");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect((await checkRequestLimit("unit:test")).allowed).toBe(true);
    expect((await checkRequestLimit("unit:test")).allowed).toBe(true);
    expect((await checkRequestLimit("unit:test")).allowed).toBe(false);
  });

  it("fails closed in production when distributed limiting is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(await checkRequestLimit("unit:production")).toMatchObject({ allowed: false, thresholdCrossed: false });
  });

  it("increments and expires the Upstash bucket in one transaction", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ result: 3 }, { result: 1 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkRequestLimit("unit:upstash", 2)).toMatchObject({ allowed: false, thresholdCrossed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://redis.example/multi-exec");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual([
      ["INCR", expect.stringContaining("mailpilot:request:")],
      ["EXPIRE", expect.stringContaining("mailpilot:request:"), 60],
    ]);
  });
});
