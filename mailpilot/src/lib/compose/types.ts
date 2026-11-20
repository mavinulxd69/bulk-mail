import type { AudienceReport } from "@/lib/personalize/engine";
import type { EmailDraft } from "@/lib/ai/types";
import type { Notice } from "./checks";

export type PickerItem = { id: string; email: string; name: string | null; ok: boolean };
export type ComposeSample = { id: string; email: string; name: string | null; ok: boolean; subject?: string; html?: string | null; text?: string; textIsGenerated?: boolean; missing: string[]; messages: string[] };
export type ComposePreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; report: AudienceReport; suppressed: number; withoutConsent: number; picker: PickerItem[]; pickerTruncated: boolean; selected: ComposeSample | null; notices: Notice[] };
export type SaveState = { status: "idle" } | { status: "error"; message: string } | { status: "saved"; id: string; message: string };
export type TestState = { status: "idle" } | { status: "error"; message: string } | { status: "sent"; message: string; simulated: boolean };
export type DraftState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "not_configured" }
  | { status: "done"; draft: EmailDraft };
