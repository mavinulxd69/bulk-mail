// Plain-language names for statuses. Honest by construction: "accepted" is never called "sent to inbox" or "delivered".
export const JOB_LABEL: Record<string, string> = {
  pending: "Queued", processing: "Sending", accepted: "Accepted by provider", delivered: "Delivered", bounced: "Bounced",
  failed: "Failed", suppressed: "Suppressed", cancelled: "Cancelled",
};
export const JOB_HELP: Record<string, string> = {
  pending: "Waiting its turn (or waiting to retry).",
  processing: "A worker is handing this message to the provider right now.",
  accepted: "The provider took the message. This is not proof of delivery.",
  delivered: "The provider confirmed the receiving mail server accepted it.",
  bounced: "The receiving server rejected it.",
  failed: "MailPilot gave up on this message. See the reason.",
  suppressed: "Not sent: the address is unsubscribed, bounced earlier, or complained.",
  cancelled: "Not sent: cancelled before it went out.",
};
export const CAMPAIGN_LABEL: Record<string, string> = {
  draft: "Draft", awaiting_approval: "Awaiting approval", queued: "Queued", sending: "Sending", completed: "Completed",
  partially_failed: "Partially failed", failed: "Failed", cancelled: "Cancelled",
};
export const EVENT_LABEL: Record<string, string> = {
  accepted: "Accepted by provider", retry_scheduled: "Retry scheduled", failed: "Failed", quota_paused: "Paused: provider limit reached",
  sender_unavailable: "Sender unavailable", auth_failed: "Sender needs attention", suppressed: "Suppressed", cancelled: "Cancelled",
  lease_expired: "Worker stopped mid-send", delivered: "Delivered", bounced: "Bounced", complained: "Spam complaint", delivery_delayed: "Delivery delayed",
};
export const ACTIVE_CAMPAIGN = new Set(["queued", "sending"]);
export const isOpenJob = (s: string) => s === "pending" || s === "processing";
