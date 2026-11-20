import { AiError, type AiProvider } from "./types";

export type AdapterConfig = { apiKey: string; model: string; baseUrl: string; timeoutMs?: number };

/** Shared fetch wrapper: bounded time, and error messages that never echo provider bodies, keys or prompts. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 30_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new AiError("timeout", "The AI took too long to answer. Try again.");
    throw new AiError("provider", "Could not reach the AI service.");
  }
  if (!res.ok) {
    console.error(`[ai] provider returned HTTP ${res.status}`);
    if (res.status === 429) throw new AiError("rate_limited", "The AI service is busy. Try again in a minute.");
    throw new AiError("provider", "The AI service could not write a draft right now.");
  }
  try { return await res.json(); } catch { throw new AiError("provider", "The AI service returned an unreadable response."); }
}

export function anthropicProvider(c: AdapterConfig): AiProvider {
  return {
    id: "anthropic",
    async complete({ system, user, maxTokens }) {
      const j = (await postJson(`${c.baseUrl.replace(/\/+$/, "")}/v1/messages`, { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
        { model: c.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }, c.timeoutMs)) as { content?: { type?: string; text?: string }[] };
      const text = (j.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
      if (!text.trim()) throw new AiError("bad_output", "The AI returned an empty draft.");
      return text;
    },
  };
}
