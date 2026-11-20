import { afterEach, describe, expect, it, vi } from "vitest";
import { getLaunchChecks, productionLaunchReady } from "./runtime-config";

describe("production launch configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires core production variables", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("MAILPILOT_MOCK_PROVIDER", "");
    expect(productionLaunchReady().ready).toBe(false);
  });

  it("reports no missing values for a complete core configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mailpilot.example");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "token-key");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("MAILPILOT_MOCK_PROVIDER", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(productionLaunchReady().ready).toBe(true);
  });

  it("lists optional provider variables only when a provider is partially configured", () => {
    vi.stubEnv("RESEND_API_KEY", "configured");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect(getLaunchChecks().some((check) => check.key === "RESEND_WEBHOOK_SECRET")).toBe(true);
  });
});
