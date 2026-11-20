import { tokenize, type Template } from "@/lib/personalize/engine";

export type Notice = { level: "error" | "warning"; message: string };

/** Marketing mail must carry an unsubscribe link in every body part. The platform fills {{unsubscribe_url}} per recipient. */
export function marketingIssues(t: Template, isMarketing: boolean): Notice[] {
  if (!isMarketing) return [];
  const missing: string[] = [];
  for (const [label, src] of [["HTML", t.html], ["plain-text", t.text]] as const) {
    if (!src?.trim()) continue;
    if (!tokenize(src).tokens.some((k) => k.type === "var" && k.name === "unsubscribe_url")) missing.push(label);
  }
  if (!t.html?.trim() && !t.text?.trim()) return [];
  return missing.length ? [{ level: "error", message: `Marketing emails need an unsubscribe link. Add {{unsubscribe_url}} to the ${missing.join(" and ")} body.` }] : [];
}

const MONTHS = "January|February|April|June|July|August|September|October|November|December";
const DAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const strip = (s: string) => s.replace(/\{\{[^}]*\}\}/g, " ").replace(/\[\[[^\]]*\]\]/g, " ");

/**
 * Facts that look specific (numbers, codes, times, links, addresses, month and weekday names) in AI output that the
 * sender's own instructions never mentioned. Not proof of invention, but a prompt to check before sending.
 */
export function findUnsupportedFacts(brief: string, output: string): string[] {
  const source = brief.toLowerCase();
  const found = new Set<string>();
  const text = strip(output);
  const grab = (re: RegExp, norm: (s: string) => string = (s) => s) => {
    for (const m of text.matchAll(re)) {
      const raw = m[0].replace(/[.,;:!?)]+$/, "");
      if (raw && !source.includes(norm(raw).toLowerCase())) found.add(raw);
    }
  };
  grab(/https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/gi);
  grab(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g);
  grab(/[A-Za-z0-9$€£#]*\d[A-Za-z0-9:./,%$€£-]*/g);
  grab(new RegExp(`\\b(?:${MONTHS}|${DAYS})\\b`, "g"));
  return [...found].slice(0, 8);
}
