import type { AudienceReport } from "@/lib/personalize/engine";
export type RawRecord = { line: number; email: string; name: string; fields: Record<string, string>; consentSource: string; malformed?: boolean };
export type ImportRow = { line: number; email: string; name: string | null; fields: Record<string, string>; consentSource: string | null };
export type IssueCode = "invalid_email" | "duplicate_in_file" | "missing_required" | "malformed_row" | "value_too_long";
export type RowIssue = { line: number; email: string; code: IssueCode; message: string };

export type ImportSummary = {
  created: number; updated: number; skippedExisting: number;
  invalid: number; duplicatesInFile: number; missingRequired: number; otherRejected: number;
  alreadySuppressed: number; addedToList: number; listName: string | null;
};
export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; summary: ImportSummary; issues: RowIssue[]; issuesTruncated: boolean };

export type PreviewSample = { email: string; name: string | null; ok: boolean; subject?: string; html?: string | null; text?: string | null; missing: string[]; messages: string[] };
export type PreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; report: AudienceReport; suppressed: number; samples: PreviewSample[] };
