export type LaunchCheck = { key: string; required: boolean; configured: boolean };

export function getLaunchChecks(): LaunchCheck[] {
  const checks: LaunchCheck[] = [
    ["NEXT_PUBLIC_SUPABASE_URL", true],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", true],
    ["SUPABASE_SERVICE_ROLE_KEY", true],
    ["NEXT_PUBLIC_SITE_URL", true],
    ["TOKEN_ENCRYPTION_KEY", true],
    ["CRON_SECRET", true],
  ].map(([key, required]) => ({
    key: key as string,
    required: required as boolean,
    configured: Boolean(process.env[key as string]?.trim()),
  }));

  if (process.env.RESEND_API_KEY?.trim()) {
    checks.push({ key: "RESEND_WEBHOOK_SECRET", required: true, configured: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()) });
  }
  if (process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    checks.push(
      { key: "GOOGLE_CLIENT_ID", required: true, configured: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()) },
      { key: "GOOGLE_CLIENT_SECRET", required: true, configured: Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim()) },
    );
  }
  if (process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    checks.push(
      { key: "UPSTASH_REDIS_REST_URL", required: true, configured: Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim()) },
      { key: "UPSTASH_REDIS_REST_TOKEN", required: true, configured: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) },
    );
  }
  return checks;
}

export function productionLaunchReady() {
  const checks = getLaunchChecks();
  const missing = checks.filter((check) => check.required && !check.configured).map((check) => check.key);
  const mockEnabled = process.env.MAILPILOT_MOCK_PROVIDER === "1";
  if (process.env.NODE_ENV === "production" && mockEnabled) missing.push("MAILPILOT_MOCK_PROVIDER must not be enabled");
  return { ready: missing.length === 0, missing, checks };
}
