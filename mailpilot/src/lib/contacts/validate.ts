import { MAX_FIELD_VALUE, MAX_NAME_LENGTH } from "@/lib/limits";
import { isValidEmail, normalizeEmail } from "./emails";
import type { ImportRow, RawRecord, RowIssue } from "./types";

/** Validates records and splits them into importable rows and per-row issues. Never throws. */
export function validateRecords(records: RawRecord[], opts: { required: string[] }): { valid: ImportRow[]; issues: RowIssue[] } {
  const valid: ImportRow[] = [], issues: RowIssue[] = [], accepted = new Set<string>();
  for (const r of records) {
    const email = normalizeEmail(r.email);
    const issue = (code: RowIssue["code"], message: string) => issues.push({ line: r.line, email: email.slice(0, 120), code, message });
    if (!isValidEmail(email)) { issue("invalid_email", "Not a valid email address."); continue; }
    if (r.malformed) { issue("malformed_row", "This row has more values than the header has columns."); continue; }
    const missing = opts.required.filter((k) => (k === "name" ? !r.name.trim() : !(r.fields[k] ?? "").trim()));
    if (missing.length) { issue("missing_required", `Missing required value: ${missing.join(", ")}.`); continue; }
    if (r.name.length > MAX_NAME_LENGTH || Object.values(r.fields).some((v) => v.length > MAX_FIELD_VALUE)) { issue("value_too_long", "A value is too long."); continue; }
    if (accepted.has(email)) { issue("duplicate_in_file", "Duplicate address in this import; the first occurrence was kept."); continue; }
    accepted.add(email);
    valid.push({ line: r.line, email, name: r.name.trim() || null, fields: r.fields, consentSource: r.consentSource || null });
  }
  return { valid, issues };
}
