import { MAX_CUSTOM_FIELDS, MAX_FIELD_VALUE } from "@/lib/limits";
import { normalizeVarName, RESERVED_FIELDS } from "@/lib/personalize/variables";

/** Edit-form format: one `key: value` (or `key=value`) per line. */
export function parseFieldLines(text: string): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const fields: Record<string, string> = {};
  for (const [i, raw] of text.split(/\r\n|\r|\n/).entries()) {
    if (!raw.trim()) continue;
    const m = raw.match(/^\s*([^:=]+?)\s*[:=]\s*(.*)$/);
    if (!m) return { ok: false, error: `Line ${i + 1}: use the form  name: value` };
    const key = normalizeVarName(m[1]!);
    if (!key) return { ok: false, error: `Line ${i + 1}: "${m[1]!.slice(0, 30)}" can't be used as a variable name.` };
    if (RESERVED_FIELDS.has(key)) return { ok: false, error: `Line ${i + 1}: "${key}" is reserved.` };
    const value = m[2]!.trim();
    if (value.length > MAX_FIELD_VALUE) return { ok: false, error: `Line ${i + 1}: value is too long.` };
    if (value) fields[key] = value;
  }
  if (Object.keys(fields).length > MAX_CUSTOM_FIELDS) return { ok: false, error: `Too many fields (limit ${MAX_CUSTOM_FIELDS}).` };
  return { ok: true, fields };
}

export const formatFieldLines = (fields: unknown): string =>
  fields && typeof fields === "object" ? Object.entries(fields as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join("\n") : "";

/** Contact row -> variables available to templates. Contact columns win over any same-named custom field. */
export function contactVariables(c: { email: string; name?: string | null; fields?: unknown }): Record<string, string> {
  const base: Record<string, string> = {};
  if (c.fields && typeof c.fields === "object") for (const [k, v] of Object.entries(c.fields as Record<string, unknown>)) if (typeof v === "string") base[k] = v;
  base.email = c.email;
  if (c.name) base.name = c.name; else delete base.name;
  return base;
}
