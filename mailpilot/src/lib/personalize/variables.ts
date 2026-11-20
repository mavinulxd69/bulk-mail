// Variable naming rules shared by the CSV importer (column names) and the template engine ({{placeholders}}).
export const VAR_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Supplied by the platform at send time. Contacts can never define or override these. */
export const SYSTEM_VARIABLES = ["unsubscribe_url"] as const;

/** Column names that map to real contact columns or system values, so they can't be custom fields. */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(["email", "name", "consent_source", ...SYSTEM_VARIABLES]);

/** "Boarding Code" -> "boarding_code". Returns null when no valid variable name can be derived. */
export function normalizeVarName(raw: string): string | null {
  const n = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return VAR_NAME_RE.test(n) ? n : null;
}
