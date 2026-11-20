import { CAMPAIGN_LABEL, JOB_HELP, JOB_LABEL } from "@/lib/queue/status";
const tone = (s: string) =>
  ["failed", "bounced"].includes(s) ? "bg-post/10 text-post" :
  ["completed", "delivered"].includes(s) ? "bg-emerald-100 text-emerald-900" :
  ["sending", "processing", "queued", "pending", "awaiting_approval"].includes(s) ? "bg-sky text-ink" :
  ["partially_failed"].includes(s) ? "bg-amber-100 text-amber-900" : "bg-mist text-ink/80";
export const CampaignBadge = ({ status }: { status: string }) => <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tone(status)}`}>{CAMPAIGN_LABEL[status] ?? status}</span>;
export const JobBadge = ({ status, simulated }: { status: string; simulated?: boolean }) => (
  <span title={JOB_HELP[status]} className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tone(status)}`}>{JOB_LABEL[status] ?? status}{simulated ? " (simulated)" : ""}</span>);
export const utc = (v: string | null | undefined) => (v ? `${new Date(v).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");
