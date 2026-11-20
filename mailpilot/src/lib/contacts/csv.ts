// Small RFC 4180 CSV parser: quoted fields, escaped quotes (""), embedded newlines, CRLF/LF/CR, BOM,
// and comma / semicolon / tab auto-detection (Excel in many locales exports semicolons).
export class CsvError extends Error {}
export type CsvRow = { line: number; cells: string[] };

export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false, seen = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === "\n" || ch === "\r")) { if (seen) break; continue; }
    if (!/\s/.test(ch)) seen = true;
    if (!inQuotes && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

export function parseCsv(input: string, opts: { delimiter?: string; maxRows?: number } = {}): { rows: CsvRow[]; delimiter: string } {
  const text = input.replace(/^\uFEFF/, "");
  const d = opts.delimiter ?? detectDelimiter(text);
  const rows: CsvRow[] = [];
  let row: string[] = [], cell = "", inQuotes = false, afterQuote = false, line = 1, rowLine = 1;
  const endCell = () => { row.push(cell); cell = ""; afterQuote = false; };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && (row[0] ?? "").trim() === "")) {
      rows.push({ line: rowLine, cells: row });
      if (opts.maxRows && rows.length > opts.maxRows) throw new CsvError(`The file has more than ${opts.maxRows} rows. Split it into smaller files.`);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; afterQuote = true; } }
      else { if (ch === "\n") line++; cell += ch; }
    } else if (ch === '"' && cell === "" && !afterQuote) inQuotes = true;
    else if (ch === d) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow(); line++; rowLine = line;
    } else if (afterQuote) {
      if (ch.trim() !== "") throw new CsvError(`Unexpected text after a closing quote on line ${line}.`);
    } else cell += ch;
  }
  if (inQuotes) throw new CsvError("A quoted value is never closed. Check for a stray double quote.");
  if (cell !== "" || row.length > 0) endRow();
  return { rows, delimiter: d };
}
