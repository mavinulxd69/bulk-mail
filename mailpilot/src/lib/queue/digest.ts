import { createHash } from "node:crypto";
import type { ContactRow } from "@/lib/contacts/db";

/**
 * Fingerprint of WHO is in the audience and what their data was when the user opened the review screen. If anything changes before
 * they confirm (someone added, edited, removed, consent changed), the digest no longer matches and they must look again.
 */
export function audienceDigest(contacts: Pick<ContactRow, "id" | "updated_at" | "consented_at">[]): string {
  const h = createHash("sha256");
  for (const c of [...contacts].sort((a, b) => (a.id < b.id ? -1 : 1))) h.update(`${c.id}|${c.updated_at ?? ""}|${c.consented_at ?? ""}\n`);
  return h.digest("hex");
}
