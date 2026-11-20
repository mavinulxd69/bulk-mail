import "server-only";
import { gmailProvider } from "./gmail";
import { mockProvider } from "./mock";
import { resendProvider } from "./resend";
import type { EmailProvider } from "./types";

export type SenderRow = { id: string; user_id: string; provider: "gmail" | "resend"; from_address: string; display_name: string | null; reply_to: string | null; status: string };

/** Local development only. Never active in production builds, and it sends nothing. */
export const mockEnabled = () => process.env.MAILPILOT_MOCK_PROVIDER === "1" && process.env.NODE_ENV !== "production";

export function providerFor(s: SenderRow): EmailProvider {
  if (mockEnabled()) return mockProvider;
  return s.provider === "gmail" ? gmailProvider(s.id, s.user_id) : resendProvider;
}
