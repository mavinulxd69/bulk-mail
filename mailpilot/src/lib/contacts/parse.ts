import { MAX_CUSTOM_FIELDS, MAX_IMPORT_ROWS } from "@/lib/limits";
import { normalizeVarName, RESERVED_FIELDS } from "@/lib/personalize/variables";
import { parseCsv, CsvError, detectDelimiter } from "./csv";
import { parseAddressList } from "./emails";
import type { RawRecord } from "./types";

const EMAIL_HEADERS = new Set(["email", "e_mail", "email_address"]);
const NAME_HEADERS = new Set(["name", "full_name"]);

export type ParseOutcome = { ok: true; kind: "csv" | "list"; records: RawRecord[]; fieldColumns: string[] } | { ok: false; error: string };

/** Turns pasted text or a CSV file's text into raw records. Pure: no validation of addresses yet. */
export function parseContactInput(text: string): ParseOutcome {
  const trimmed = text.replace(/^\uFEFF/, "");
  if (!trimmed.trim()) return { ok: false, error: "Nothing to import. Paste addresses or choose a CSV file." };
  const firstLine = trimmed.split(/\r\n|\r|\n/).find((l) => l.trim()) ?? "";
  const delim = detectDelimiter(trimmed);
  const looksLikeCsv = firstLine.split(delim).some((h) => EMAIL_HEADERS.has(normalizeVarName(h.replace(/^"|"$/g, "")) ?? ""));
  if (!looksLikeCsv) {
    if (!firstLine.includes("@")) return { ok: false, error: 'The first line has no email address. If this is a CSV, it needs an "email" column.' };
    const records = parseAddressList(trimmed).map((a) => ({ line: a.line, email: a.email, name: a.name, fields: {}, consentSource: "" }));
    if (records.length > MAX_IMPORT_ROWS) return { ok: false, error: `Too many addresses (limit ${MAX_IMPORT_ROWS} per import).` };
    return records.length ? { ok: true, kind: "list", records, fieldColumns: [] } : { ok: false, error: "No email addresses found." };
  }

  let parsed;
  try { parsed = parseCsv(trimmed, { delimiter: delim, maxRows: MAX_IMPORT_ROWS + 1 }); }
  catch (e) { return { ok: false, error: e instanceof CsvError ? e.message : "Could not read the CSV." }; }
  const [head, ...body] = parsed.rows;
  if (!head) return { ok: false, error: "The CSV has no header row." };

  let emailCol = -1, nameCol = -1, consentCol = -1;
  const fieldCols: { idx: number; key: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < head.cells.length; i++) {
    const raw = head.cells[i] ?? "";
    if (!raw.trim()) continue; // blank header: column ignored
    const key = normalizeVarName(raw);
    if (!key) return { ok: false, error: `Column "${raw.slice(0, 40)}" can't be used as a variable name. Use letters, numbers and underscores, starting with a letter.` };
    if (seen.has(key)) return { ok: false, error: `Two columns are both called "${key}". Rename one.` };
    seen.add(key);
    if (EMAIL_HEADERS.has(key)) { if (emailCol !== -1) return { ok: false, error: "More than one email column found." }; emailCol = i; }
    else if (NAME_HEADERS.has(key)) { if (nameCol !== -1) return { ok: false, error: "More than one name column found." }; nameCol = i; }
    else if (key === "consent_source") consentCol = i;
    else if (RESERVED_FIELDS.has(key)) return { ok: false, error: `"${key}" is reserved by MailPilot. Rename that column.` };
    else fieldCols.push({ idx: i, key });
  }
  if (emailCol === -1) return { ok: false, error: 'The CSV needs an "email" column.' };
  if (fieldCols.length > MAX_CUSTOM_FIELDS) return { ok: false, error: `Too many custom columns (limit ${MAX_CUSTOM_FIELDS}).` };

  const width = head.cells.length;
  const records: RawRecord[] = body.map((r) => {
    const fields: Record<string, string> = {};
    for (const { idx, key } of fieldCols) { const v = (r.cells[idx] ?? "").trim(); if (v) fields[key] = v; } // blank cell = no value
    return {
      line: r.line, email: r.cells[emailCol] ?? "", name: (nameCol >= 0 ? r.cells[nameCol] ?? "" : "").trim(), fields,
      consentSource: (consentCol >= 0 ? r.cells[consentCol] ?? "" : "").trim(), malformed: r.cells.some((c, i) => i >= width && c.trim() !== ""),
    };
  });
  if (!records.length) return { ok: false, error: "The CSV has a header but no rows." };
  return { ok: true, kind: "csv", records, fieldColumns: fieldCols.map((f) => f.key) };
}
