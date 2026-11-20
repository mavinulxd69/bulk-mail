// Strict-but-practical address validation. Rejects control characters outright (header-injection defence).
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const normalizeEmail = (s: string) => s.trim().toLowerCase();

export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  if (e.length < 3 || e.length > 254 || /[\s\u0000-\u001f\u007f]/.test(e)) return false;
  const at = e.lastIndexOf("@");
  if (at < 1 || e.indexOf("@") !== at) return false;
  const local = e.slice(0, at), domain = e.slice(at + 1);
  if (local.length > 64 || !LOCAL_RE.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return false;
  const tld = labels[labels.length - 1]!;
  return tld.length >= 2 && !/^\d+$/.test(tld);
}

export type ParsedAddress = { line: number; email: string; name: string };

/**
 * Pasted text: one or many addresses separated by newlines, commas, semicolons or spaces.
 * Also understands `Jane Doe <jane@example.com>`. (A comma inside a display name is not supported.)
 */
export function parseAddressList(text: string): ParsedAddress[] {
  const out: ParsedAddress[] = [];
  text.split(/\r\n|\r|\n/).forEach((lineText, i) => {
    const line = i + 1;
    let rest = lineText;
    rest = rest.replace(/([^<>,;]*)<([^<>\s,;]+)>/g, (_m, name: string, addr: string) => {
      out.push({ line, email: addr, name: name.trim().replace(/^"+|"+$/g, "").trim() });
      return " ";
    });
    for (const tok of rest.split(/[\s,;]+/)) if (tok) out.push({ line, email: tok, name: "" });
  });
  return out;
}
