// Provider-independent AI interface. Adapters (anthropic.ts, openai.ts) implement it; nothing else knows which vendor is used.
export const TONES = ["professional", "friendly", "formal", "short_direct"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = { professional: "Professional", friendly: "Friendly", formal: "Formal", short_direct: "Short and direct" };

export type AiRequest = { system: string; user: string; maxTokens: number };
export interface AiProvider { id: string; complete(req: AiRequest): Promise<string> }

export type AiErrorCode = "not_configured" | "rate_limited" | "provider" | "timeout" | "bad_output";
/** `message` is always safe to show a user: it never contains provider response bodies, keys or prompts. */
export class AiError extends Error { constructor(public code: AiErrorCode, message: string) { super(message); } }

export type DraftWarning = { level: "error" | "warning"; message: string };
export type EmailDraft = { subject: string; body: string; html: string; text: string; warnings: DraftWarning[]; usedVariables: string[] };
