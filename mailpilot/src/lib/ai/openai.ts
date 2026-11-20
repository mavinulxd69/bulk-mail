// Works with OpenAI and any OpenAI-compatible endpoint (OpenRouter, Azure OpenAI, vLLM, Ollama...) via AI_BASE_URL.
import { AiError, type AiProvider } from "./types";
import { postJson, type AdapterConfig } from "./anthropic";

export function openaiProvider(c: AdapterConfig): AiProvider {
  const base = c.baseUrl.replace(/\/+$/, "");
  const official = /^https:\/\/api\.openai\.com(\/|$)/.test(base); // newer OpenAI models reject max_tokens
  return {
    id: "openai",
    async complete({ system, user, maxTokens }) {
      const j = (await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${c.apiKey}` },
        { model: c.model, [official ? "max_completion_tokens" : "max_tokens"]: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }, c.timeoutMs)) as { choices?: { message?: { content?: unknown } }[] };
      const text = j.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new AiError("bad_output", "The AI returned an empty draft.");
      return text;
    },
  };
}
