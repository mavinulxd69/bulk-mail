import "server-only";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import type { AiProvider } from "./types";

type Cfg = { provider: "anthropic" | "openai"; apiKey: string; model: string; baseUrl: string };

/** null when AI isn't configured. The UI then shows an honest setup state; there is no fake AI. */
export function aiConfig(env: Record<string, string | undefined> = process.env): Cfg | null {
  const provider = env.AI_PROVIDER === "anthropic" || env.AI_PROVIDER === "openai" ? env.AI_PROVIDER : null;
  const apiKey = env.AI_API_KEY?.trim();
  if (!provider || !apiKey) return null;
  const model = env.AI_MODEL?.trim() || (provider === "anthropic" ? "claude-haiku-5-5" : "");
  if (!model) return null; // OpenAI-compatible endpoints need an explicit model name
  const baseUrl = env.AI_BASE_URL?.trim() || (provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
  return { provider, apiKey, model, baseUrl };
}
export const aiConfigured = () => aiConfig() !== null;
export function getAiProvider(): AiProvider | null {
  const c = aiConfig();
  return !c ? null : c.provider === "anthropic" ? anthropicProvider(c) : openaiProvider(c);
}
export const aiDailyLimit = () => { const n = parseInt(process.env.AI_DAILY_LIMIT ?? "", 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 20; };
