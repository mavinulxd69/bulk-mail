// The checks a campaign must pass before it may be put in front of the approval screen and again right before it is queued.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAudience, type AudienceResult } from "@/lib/compose/audience";
import { marketingIssues } from "@/lib/compose/checks";
import { validateTemplate, type Template } from "@/lib/personalize/engine";
import { MAX_CAMPAIGN_RECIPIENTS } from "@/lib/limits";
import { mockEnabled } from "@/lib/providers";
import { siteUrl } from "./config";

export type CampaignRow = {
  id: string; name: string; sender_id: string | null; subject: string; html_body: string | null; text_body: string | null; is_marketing: boolean;
  audience: "all" | "list"; audience_list_id: string | null; status: string; queue_started_at: string | null; test_sent_at: string | null;
  send_rate_per_minute: number; approved_at: string | null; created_at: string; queued_at: string | null; completed_at: string | null; cancelled_at: string | null; skipped_count: number;
};
export const CAMPAIGN_COLUMNS = "id,name,sender_id,subject,html_body,text_body,is_marketing,audience,audience_list_id,status,queue_started_at,test_sent_at,send_rate_per_minute,approved_at,created_at,queued_at,completed_at,cancelled_at,skipped_count";

export type SenderRow2 = { id: string; provider: "gmail" | "resend"; from_address: string; display_name: string | null; status: string; paused_until: string | null; pause_reason: string | null; daily_quota: number };
export type Ready =
  | { ok: true; sender: SenderRow2; audience: Extract<AudienceResult, { ok: true }>; template: Template; site: string }
  | { ok: false; message: string };

export async function checkCampaignReady(sb: SupabaseClient, user: { email?: string | null; email_confirmed_at?: string | null }, c: CampaignRow): Promise<Ready> {
  const no = (message: string): Ready => ({ ok: false, message });
  if (!user.email || !user.email_confirmed_at) return no("Verify your account email before sending campaigns.");
  if (!c.sender_id) return no("Choose a sender account in the composer.");
  const { data: sender } = await sb.from("sender_accounts").select("id,provider,from_address,display_name,status,paused_until,pause_reason,daily_quota").eq("id", c.sender_id).maybeSingle();
  if (!sender || sender.status !== "connected") return no("The sender account isn't connected. Pick another or reconnect it on the Sender Accounts page.");
  if (sender.provider === "resend" && !mockEnabled()) {
    const domain = sender.from_address.split("@")[1] ?? "";
    const { data: d } = await sb.from("sender_domains").select("status").eq("domain", domain).maybeSingle();
    if (d?.status !== "verified") return no(`The sending domain ${domain} isn't verified. Finish DNS verification on the Sender Accounts page.`);
  }
  if (c.audience === "list" && !c.audience_list_id) return no("The list this campaign was written for no longer exists. Choose an audience in the composer.");

  const template: Template = { subject: c.subject, html: c.html_body, text: c.text_body };
  const errs = validateTemplate(template).errors;
  if (errs.length) return no(`Fix the message first: ${errs.slice(0, 3).map((e) => e.message).join(" ")}`);
  const mk = marketingIssues(template, c.is_marketing);
  if (mk.length) return no(mk[0]!.message);

  const site = siteUrl();
  if (!site) return no("Set NEXT_PUBLIC_SITE_URL to your public https address. Every email carries an unsubscribe link that needs it.");

  const audience = await loadAudience(sb, c.audience === "list" ? c.audience_list_id! : undefined, MAX_CAMPAIGN_RECIPIENTS + 1);
  if (!audience.ok) return no(audience.message);
  if (audience.contacts.length > MAX_CAMPAIGN_RECIPIENTS) return no(`A campaign can have up to ${MAX_CAMPAIGN_RECIPIENTS.toLocaleString()} recipients. Split this audience into lists.`);
  return { ok: true, sender: sender as SenderRow2, audience, template, site };
}
