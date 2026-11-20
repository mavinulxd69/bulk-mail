import type { EmailProvider } from "./types";
// Dev-only. Sends NOTHING; results are flagged simulated so the UI can never show them as delivered.
export const mockProvider: EmailProvider = {
  id: "mock",
  async send(i) { console.info(`[mock] would send "${i.subject}" to ${i.to}`); return { status: "accepted", providerMessageId: `mock_${i.idempotencyKey}`, simulated: true }; },
};
