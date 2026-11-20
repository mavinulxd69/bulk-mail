import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEmailDraft, parseDraftOutput } from "./draft";
import { buildDraftPrompt } from "./prompt";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { aiConfig } from "./index";
import { AiError, type AiProvider } from "./types";

const VARS = ["name", "email", "boarding_code"];
const BRIEF = "Write a professional boarding confirmation email. Include recipient name and boarding code.";
const fake = (...replies: string[]): AiProvider & { calls: number } => {
  const p = { id: "fake", calls: 0, async complete() { const r = replies[Math.min(p.calls, replies.length - 1)]!; p.calls++; return r; } };
  return p;
};
const good = JSON.stringify({ subject: "Your Boarding Confirmation - {{name}}", body: "Hello {{name}},\n\nYour boarding details are ready.\n\nYour boarding code is: **{{boarding_code}}**\n\nThank you." });

describe("buildDraftPrompt", () => {
  const p = buildDraftPrompt({ brief: BRIEF, tone: "formal", variables: VARS });
  it("lists only placeholder names and states the no-invention rules", () => {
    expect(p.system).toContain("{{boarding_code}}");
    expect(p.system).toMatch(/Never invent facts/);
    expect(p.system).toMatch(/\[\[/);
    expect(p.system).toContain("Formal");
  });
  it("contains the brief and no addresses: recipient data is never passed in", () => {
    expect(p.user).toContain(BRIEF);
    expect(p.system + p.user).not.toContain("@");
  });
});

describe("parseDraftOutput", () => {
  it("accepts JSON wrapped in fences or chatter", () => {
    expect(parseDraftOutput("```json\n" + good + "\n```").subject).toContain("Boarding");
    expect(parseDraftOutput("Here you go: " + good).body).toContain("Hello");
  });
  it("rejects garbage and wrong shapes", () => {
    for (const bad of ["no json", "{not json}", '{"subject":"x"}', '{"subject":"","body":"y"}']) expect(() => parseDraftOutput(bad)).toThrow(AiError);
  });
});

describe("generateEmailDraft", () => {
  it("produces subject, safe HTML and plain text with no warnings for a clean draft", async () => {
    const d = await generateEmailDraft(fake(good), { brief: BRIEF, tone: "professional", variables: VARS });
    expect(d.subject).toBe("Your Boarding Confirmation - {{name}}");
    expect(d.html).toContain("<strong>{{boarding_code}}</strong>");
    expect(d.text).toContain("Your boarding code is: {{boarding_code}}");
    expect(d.text).not.toContain("**");
    expect(d.warnings).toEqual([]);
    expect(d.usedVariables).toEqual(["boarding_code", "name"]);
  });
  it("neutralizes HTML and script in model output", async () => {
    const evil = JSON.stringify({ subject: "Hi\r\nBcc: x@y.dev", body: 'Hello {{name}} <script>alert(1)</script> <a href="javascript:x">c</a>' });
    const d = await generateEmailDraft(fake(evil), { brief: BRIEF, tone: "friendly", variables: VARS });
    expect(d.html).not.toContain("<script");
    expect(d.html).not.toContain("<a ");
    expect(d.subject).not.toMatch(/[\r\n]/);
  });
  it("warns about invented specifics (boarding code, date, link)", async () => {
    const inv = JSON.stringify({ subject: "Boarding", body: "Hello {{name}}, your boarding code is BD777 for Monday. See https://evil.dev" });
    const d = await generateEmailDraft(fake(inv), { brief: BRIEF, tone: "professional", variables: VARS });
    const w = d.warnings.map((x) => x.message).join(" ");
    expect(w).toContain("BD777");
    expect(w).toContain("Monday");
    expect(w).toContain("https://evil.dev");
  });
  it("flags unknown variables as errors and unresolved markers as must-fill", async () => {
    const r = JSON.stringify({ subject: "Hi {{first_name}}", body: "Hello {{name}}, departure is at [[departure time]]." });
    const d = await generateEmailDraft(fake(r), { brief: BRIEF, tone: "professional", variables: VARS });
    expect(d.warnings.find((w) => w.level === "error")?.message).toContain("{{first_name}}");
    expect(d.warnings.find((w) => w.message.includes("[[departure time]]"))).toBeTruthy();
  });
  it("retries once on unusable output, then gives up safely", async () => {
    const flaky = fake("oops", good);
    expect((await generateEmailDraft(flaky, { brief: BRIEF, tone: "professional", variables: VARS })).subject).toContain("Boarding");
    expect(flaky.calls).toBe(2);
    const broken = fake("oops");
    await expect(generateEmailDraft(broken, { brief: BRIEF, tone: "professional", variables: VARS })).rejects.toMatchObject({ code: "bad_output" });
    expect(broken.calls).toBe(2);
  });
  it("rejects too-short and too-long instructions without calling the AI", async () => {
    const p = fake(good);
    await expect(generateEmailDraft(p, { brief: "hi", tone: "formal", variables: VARS })).rejects.toBeInstanceOf(AiError);
    await expect(generateEmailDraft(p, { brief: "x".repeat(1001), tone: "formal", variables: VARS })).rejects.toBeInstanceOf(AiError);
    expect(p.calls).toBe(0);
  });
});

describe("adapters", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: () => Response | Error) => { const f = vi.fn(async (_url: string, _init?: RequestInit) => { const r = res(); if (r instanceof Error) throw r; return r; }); vi.stubGlobal("fetch", f); return f; };
  const json = (b: unknown, status = 200) => () => new Response(JSON.stringify(b), { status });
  const cfg = { apiKey: "sk-secret", model: "m", baseUrl: "https://example.test" };

  it("anthropic: sends the documented request and joins text blocks", async () => {
    const f = stub(json({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] }));
    expect(await anthropicProvider(cfg).complete({ system: "S", user: "U", maxTokens: 50 })).toBe("ab");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://example.test/v1/messages");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("sk-secret");
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: "m", max_tokens: 50, system: "S", messages: [{ role: "user", content: "U" }] });
  });
  it("openai: uses max_completion_tokens only for the official endpoint", async () => {
    const f = stub(json({ choices: [{ message: { content: "hi" } }] }));
    await openaiProvider({ ...cfg, baseUrl: "https://api.openai.com/v1" }).complete({ system: "S", user: "U", maxTokens: 9 });
    await openaiProvider({ ...cfg, baseUrl: "https://router.test/v1/" }).complete({ system: "S", user: "U", maxTokens: 9 });
    const bodies = f.mock.calls.map((c) => JSON.parse(c[1]!.body as string));
    expect(bodies[0]).toHaveProperty("max_completion_tokens", 9);
    expect(bodies[1]).toHaveProperty("max_tokens", 9);
    expect(f.mock.calls[1]![0]).toBe("https://router.test/v1/chat/completions");
  });
  it("maps failures to safe messages that never leak the key or body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stub(json({ error: "bad key sk-secret" }, 401));
    const e1 = await anthropicProvider(cfg).complete({ system: "S", user: "U", maxTokens: 5 }).catch((e) => e);
    expect(e1).toMatchObject({ code: "provider" });
    expect(e1.message).not.toContain("sk-secret");
    stub(json({}, 429));
    await expect(openaiProvider(cfg).complete({ system: "S", user: "U", maxTokens: 5 })).rejects.toMatchObject({ code: "rate_limited" });
    stub(() => Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(anthropicProvider(cfg).complete({ system: "S", user: "U", maxTokens: 5 })).rejects.toMatchObject({ code: "timeout" });
    stub(json({ content: [] }));
    await expect(anthropicProvider(cfg).complete({ system: "S", user: "U", maxTokens: 5 })).rejects.toMatchObject({ code: "bad_output" });
  });
});

describe("aiConfig", () => {
  it("is null (honest 'not configured') without a provider and key", () => {
    expect(aiConfig({})).toBeNull();
    expect(aiConfig({ AI_PROVIDER: "anthropic" })).toBeNull();
    expect(aiConfig({ AI_API_KEY: "k" })).toBeNull();
    expect(aiConfig({ AI_PROVIDER: "nope", AI_API_KEY: "k" })).toBeNull();
  });
  it("defaults the Anthropic model but requires one for OpenAI-compatible endpoints", () => {
    expect(aiConfig({ AI_PROVIDER: "anthropic", AI_API_KEY: "k" })).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5" });
    expect(aiConfig({ AI_PROVIDER: "openai", AI_API_KEY: "k" })).toBeNull();
    expect(aiConfig({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "x", AI_BASE_URL: "http://localhost:11434/v1" })).toMatchObject({ baseUrl: "http://localhost:11434/v1" });
  });
});
