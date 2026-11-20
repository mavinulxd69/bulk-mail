// Turns a brief into a reviewable draft. DRAFT ONLY: this module has no access to any sending code.
import { z } from "zod";
import { findMarkers, validateTemplate } from "@/lib/personalize/engine";
import { SYSTEM_VARIABLES } from "@/lib/personalize/variables";
import { findUnsupportedFacts } from "@/lib/compose/checks";
import { stripEmphasis, textToHtml } from "@/lib/compose/html";
import { buildDraftPrompt, MAX_BRIEF } from "./prompt";
import { AiError, type AiProvider, type DraftWarning, type EmailDraft, type Tone } from "./types";

const Output = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) });

export function parseDraftOutput(raw: string): z.infer<typeof Output> {
  const s = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b <= a) throw new AiError("bad_output", "The AI did not return a usable draft.");
  let json: unknown;
  try { json = JSON.parse(s.slice(a, b + 1)); } catch { throw new AiError("bad_output", "The AI did not return a usable draft."); }
  const r = Output.safeParse(json);
  if (!r.success) throw new AiError("bad_output", "The AI did not return a usable draft.");
  return r.data;
}

export async function generateEmailDraft(provider: AiProvider, input: { brief: string; tone: Tone; variables: string[] }): Promise<EmailDraft> {
  const brief = input.brief.trim();
  if (brief.length < 10 || brief.length > MAX_BRIEF) throw new AiError("bad_output", `Describe the email in 10 to ${MAX_BRIEF} characters.`);
  const allowed = [...new Set([...input.variables, ...SYSTEM_VARIABLES])].map((v) => v.toLowerCase());
  const { system, user } = buildDraftPrompt({ brief, tone: input.tone, variables: input.variables });

  let out: z.infer<typeof Output> | undefined;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    const raw = await provider.complete({ system, user: attempt ? `${user}\n\nYour previous reply was not valid JSON. Reply with only the JSON object.` : user, maxTokens: 1500 });
    try { out = parseDraftOutput(raw); } catch (e) { if (attempt === 1 || !(e instanceof AiError)) throw e; }
  }
  if (!out) throw new AiError("bad_output", "The AI did not return a usable draft.");

  const subject = out.subject.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  const body = out.body.replace(/\r\n?/g, "\n");
  const html = textToHtml(body), text = stripEmphasis(body);

  const warnings: DraftWarning[] = [];
  const check = validateTemplate({ subject, html, text });
  for (const e of check.errors) if (e.code !== "marker") warnings.push({ level: "error", message: e.message });
  const markers = [...new Set([...findMarkers(subject), ...findMarkers(body)])];
  if (markers.length) warnings.push({ level: "warning", message: `The draft needs details only you have. Fill in: ${markers.map((m) => `[[${m}]]`).join(", ")}. It can't be sent until these are replaced.` });
  const unknown = check.variables.filter((v) => !allowed.includes(v));
  if (unknown.length) warnings.push({ level: "error", message: `The draft uses ${unknown.map((v) => `{{${v}}}`).join(", ")}, which none of your contacts has. Rename or remove ${unknown.length === 1 ? "it" : "them"}.` });
  const unsupported = findUnsupportedFacts(brief, `${subject}\n${body}`);
  if (unsupported.length) warnings.push({ level: "warning", message: `The draft mentions ${unsupported.map((u) => `“${u}”`).join(", ")}, which your instructions did not include. Check it is correct, or replace it with a variable.` });

  return { subject, body, html, text, warnings, usedVariables: check.variables };
}
