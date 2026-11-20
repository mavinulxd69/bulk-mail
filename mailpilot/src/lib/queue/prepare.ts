// Turns a frozen campaign + the current audience into the exact messages that will be queued. Pure: no database, no sending.
// Every message is rendered for ONE recipient from that recipient's own data, all-or-nothing, with that recipient's own unsubscribe link.
import type { ContactRow } from "@/lib/contacts/db";
import { contactVariables } from "@/lib/contacts/fields";
import { finalizeMessage } from "@/lib/compose/html";
import { renderTemplate, validateTemplate, type Template } from "@/lib/personalize/engine";
import { newUnsubscribeToken, unsubscribeUrl } from "./unsubscribe";

export type PreparedMessage = { contactId: string; email: string; subject: string; html: string | null; text: string; token: string; bytes: number };
export type PrepareInput = {
  template: Template; contacts: ContactRow[]; suppressedEmails: ReadonlySet<string>; includeUnconsented: boolean; siteUrl: string; newToken?: () => string;
};
export type Prepared = {
  messages: PreparedMessage[];
  suppressed: ContactRow[];                              // on the suppression list: recorded as "suppressed", never sent
  unconsented: ContactRow[];                             // no consent record and not opted in: left out
  blocked: { contact: ContactRow; reason: string }[];    // can't be personalized completely: left out only if the user chose to skip them
  templateErrors: string[];
  totalBytes: number;
};

export function prepareCampaign(input: PrepareInput): Prepared {
  const out: Prepared = { messages: [], suppressed: [], unconsented: [], blocked: [], templateErrors: [], totalBytes: 0 };
  const check = validateTemplate(input.template);
  if (check.errors.length) { out.templateErrors = check.errors.map((e) => e.message); return out; }
  const token = input.newToken ?? newUnsubscribeToken;
  for (const contact of input.contacts) {
    if (input.suppressedEmails.has(contact.email)) { out.suppressed.push(contact); continue; }
    if (!contact.consented_at && !input.includeUnconsented) { out.unconsented.push(contact); continue; }
    const t = token();
    const r = renderTemplate(input.template, contactVariables(contact), { unsubscribe_url: unsubscribeUrl(input.siteUrl, t) });
    if (!r.ok) { out.blocked.push({ contact, reason: r.messages.join(" ") }); continue; }
    const m = finalizeMessage(r);
    const bytes = Buffer.byteLength(m.subject) + Buffer.byteLength(m.html ?? "") + Buffer.byteLength(m.text);
    out.messages.push({ contactId: contact.id, email: contact.email, subject: m.subject, html: m.html, text: m.text, token: t, bytes });
    out.totalBytes += bytes;
  }
  return out;
}
