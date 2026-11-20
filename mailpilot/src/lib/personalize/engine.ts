// Personalization engine. Pure and deterministic: the same code powers previews now and the send queue later (Phase 6).
// Guarantees:
//  - A message is rendered completely or not at all: any missing/blank variable or invalid placeholder fails the whole message.
//  - Recipient values are HTML-escaped in HTML, stripped of line breaks in subjects (header injection), and never executed.
//  - Only the recipient's own data is ever passed in; other recipients are unreachable from a render call.
import { SYSTEM_VARIABLES } from "./variables";

export type Template = { subject: string; html?: string | null; text?: string | null };
export type RecipientData = Record<string, string | null | undefined>;
export type Part = "subject" | "html" | "text";
export type TemplateIssue = { part: Part | "template"; message: string; code?: "marker" };

type Token = { type: "text"; value: string } | { type: "var"; name: string };
const PLACEHOLDER_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// "[[describe the missing fact]]" is how AI drafts (and people) flag text that still needs filling in. It must never reach a recipient.
const MARKER_RE = /\[\[([^\]\n]{1,100})\]\]/g;
export const findMarkers = (src: string): string[] => [...src.matchAll(MARKER_RE)].map((m) => m[1]!.trim());
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isBlank = (v: unknown) => v == null || String(v).trim() === "";

export function tokenize(src: string): { tokens: Token[]; errors: string[] } {
  const tokens: Token[] = [], errors: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf("{{", pos);
    if (open === -1) { tokens.push({ type: "text", value: src.slice(pos) }); break; }
    if (open > pos) tokens.push({ type: "text", value: src.slice(pos, open) });
    const close = src.indexOf("}}", open + 2);
    if (close === -1) { errors.push('A "{{" is never closed with "}}".'); tokens.push({ type: "text", value: src.slice(open) }); break; }
    const inner = src.slice(open + 2, close), name = inner.trim();
    if (PLACEHOLDER_RE.test(name)) tokens.push({ type: "var", name: name.toLowerCase() });
    else { errors.push(`Invalid placeholder "{{${inner.slice(0, 30)}}}". Use a plain name like {{name}}.`); tokens.push({ type: "text", value: src.slice(open, close + 2) }); }
    pos = close + 2;
  }
  return { tokens, errors };
}

const parts = (t: Template): [Part, string][] => {
  const p: [Part, string][] = [["subject", t.subject]];
  if (t.html?.trim()) p.push(["html", t.html]);
  if (t.text?.trim()) p.push(["text", t.text]);
  return p;
};

export function validateTemplate(t: Template): { variables: string[]; errors: TemplateIssue[] } {
  const errors: TemplateIssue[] = [], vars = new Set<string>();
  if (!t.subject.trim()) errors.push({ part: "subject", message: "The subject is empty." });
  if (/[\r\n]/.test(t.subject)) errors.push({ part: "subject", message: "The subject can't contain line breaks." });
  if (!t.html?.trim() && !t.text?.trim()) errors.push({ part: "template", message: "Add an HTML or plain-text body." });
  for (const [part, src] of parts(t)) {
    const { tokens, errors: e } = tokenize(src);
    e.forEach((message) => errors.push({ part, message }));
    findMarkers(src).slice(0, 5).forEach((m) => errors.push({ part, code: "marker", message: `Replace the placeholder [[${m}]] with real text before sending.` }));
    tokens.forEach((k) => k.type === "var" && vars.add(k.name));
  }
  return { variables: [...vars].sort(), errors };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const cleanSubject = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "");
const cleanText = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

// Blocks javascript:/data:/vbscript: in link and form targets (e.g. href="{{link}}" with a hostile value).
const URL_ATTR_RE = /\b(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
export function hasUnsafeUrl(html: string): boolean {
  for (const m of html.matchAll(URL_ATTR_RE)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? "").replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
    if (/^(javascript|vbscript|data):/.test(v)) return true;
  }
  return false;
}

export type RenderResult =
  | { ok: true; subject: string; html: string | null; text: string | null }
  | { ok: false; reason: "template_invalid" | "missing_variables" | "empty_subject" | "unsafe_content"; missing: string[]; messages: string[] };

/** All-or-nothing render for ONE recipient. `system` values (e.g. unsubscribe_url) win over contact data. */
export function renderTemplate(t: Template, data: RecipientData, system: Record<string, string> = {}): RenderResult {
  const check = validateTemplate(t);
  if (check.errors.length) return { ok: false, reason: "template_invalid", missing: [], messages: check.errors.map((e) => e.message) };
  const lookup = (n: string) => (has(system, n) ? system[n] : has(data, n) ? data[n] : undefined);
  const missing = check.variables.filter((n) => isBlank(lookup(n)));
  if (missing.length) return { ok: false, reason: "missing_variables", missing, messages: [`Missing: ${missing.join(", ")}`] };

  const render = (src: string, mode: Part) =>
    tokenize(src).tokens.map((k) => {
      if (k.type === "text") return k.value;
      const v = String(lookup(k.name)).trim();
      return mode === "html" ? escapeHtml(v) : mode === "subject" ? cleanSubject(v) : cleanText(v);
    }).join("");

  const subject = render(t.subject, "subject").trim();
  if (!subject) return { ok: false, reason: "empty_subject", missing: [], messages: ["The subject is empty for this recipient."] };
  const html = t.html?.trim() ? render(t.html, "html") : null;
  if (html && hasUnsafeUrl(html)) return { ok: false, reason: "unsafe_content", missing: [], messages: ["A link in the HTML would use an unsafe address (javascript:, data: or vbscript:)."] };
  return { ok: true, subject, html, text: t.text?.trim() ? render(t.text, "text") : null };
}

export type AudienceReport = {
  variables: string[]; templateErrors: TemplateIssue[]; total: number; ready: number; blocked: number;
  missingByVariable: Record<string, number>; unknownVariables: string[]; suggestions: Record<string, string>;
  blockedRecipients: { id: string; missing: string[] }[]; // capped at 100
};

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/** Checks a whole audience without rendering every message. Use renderTemplate per recipient for the actual content. */
export function analyzeAudience(t: Template, recipients: { id: string; data: RecipientData }[]): AudienceReport {
  const { variables, errors } = validateTemplate(t);
  const needed = variables.filter((v) => !(SYSTEM_VARIABLES as readonly string[]).includes(v));
  const missingByVariable: Record<string, number> = Object.fromEntries(needed.map((v) => [v, 0]));
  const blockedRecipients: AudienceReport["blockedRecipients"] = [];
  let blocked = 0;
  const known = new Set<string>();
  for (const r of recipients) {
    for (const [k, v] of Object.entries(r.data)) if (!isBlank(v)) known.add(k);
    const miss = needed.filter((v) => isBlank(has(r.data, v) ? r.data[v] : undefined));
    miss.forEach((v) => (missingByVariable[v] = (missingByVariable[v] ?? 0) + 1));
    if (miss.length) { blocked++; if (blockedRecipients.length < 100) blockedRecipients.push({ id: r.id, missing: miss }); }
  }
  const unknownVariables = recipients.length ? needed.filter((v) => missingByVariable[v] === recipients.length) : [];
  const suggestions: Record<string, string> = {};
  for (const u of unknownVariables) {
    const best = [...known].map((k) => [k, distance(u, k)] as const).sort((a, b) => a[1] - b[1])[0];
    if (best && best[1] <= 2) suggestions[u] = best[0];
  }
  return { variables, templateErrors: errors, total: recipients.length, ready: errors.length ? 0 : recipients.length - blocked, blocked, missingByVariable, unknownVariables, suggestions, blockedRecipients };
}
