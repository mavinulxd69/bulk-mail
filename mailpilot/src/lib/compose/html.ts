// Pure helpers for turning message bodies into other formats. Used by the composer, AI drafts, and (Phase 6) the send queue.
import { escapeHtml, type RenderResult } from "@/lib/personalize/engine";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return NAMED[e.toLowerCase()] ?? m;
  });

/** Plain-text alternative for an HTML body. Keeps links readable as "label (url)". */
export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, a?: string, b?: string, label = "") => {
    const url = (a ?? b ?? "").trim(), text = label.replace(/<[^>]*>/g, "").trim();
    return !url || /^(mailto:|#)/i.test(url) || text === url ? text : `${text} (${url})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<(?:ul|ol)\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "- ").replace(/<\/(p|div|h[1-6]|tr|ul|ol|table|blockquote)>/gi, "\n\n").replace(/<\/(li|td|th)>/gi, "\n");
  s = decode(s.replace(/<[^>]*>/g, ""));
  return s.split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Safe plain-text → HTML. Everything is escaped first; only paragraphs, "- " bullet lists, **bold** and line breaks are produced.
 * AI drafts go through this, so model output can never smuggle in scripts, tracking pixels or arbitrary links.
 */
export function textToHtml(body: string): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  const bullet = /^\s*[-*•]\s+/;
  const blocks = body.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/).filter((b) => b.trim());
  const html = blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => bullet.test(l))) return `<ul style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li>${inline(l.replace(bullet, ""))}</li>`).join("")}</ul>`;
    return `<p style="margin:0 0 16px">${inline(b)}</p>`;
  }).join("\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a">\n${html}\n</div>`;
}

/** The plain-text version of a body, without markdown emphasis. */
export const stripEmphasis = (s: string) => s.replace(/\*\*([^*\n]+)\*\*/g, "$1");

/** A rendered message always carries a text part (some providers and spam filters expect one). */
export function finalizeMessage(r: Extract<RenderResult, { ok: true }>): { subject: string; html: string | null; text: string } {
  return { subject: r.subject, html: r.html, text: r.text ?? (r.html ? htmlToText(r.html) : "") };
}
