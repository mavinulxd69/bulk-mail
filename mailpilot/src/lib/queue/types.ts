export type JobRow = {
  id: string; user_id: string; recipient_id: string; campaign_id: string; idempotency_key: string; status: string;
  attempts: number; max_attempts: number; provider: "gmail" | "resend" | null; locked_by: string | null;
};
export type RecipientRow = { id: string; email: string | null; rendered_subject: string | null; rendered_html: string | null; rendered_text: string | null; unsubscribe_token: string | null; erased_at: string | null };
export type CampaignInfo = { id: string; status: string; is_marketing: boolean; sender_id: string | null };
export type SenderInfo = { id: string; user_id: string; provider: "gmail" | "resend"; from_address: string; display_name: string | null; reply_to: string | null; status: string; pause_count: number };
export type JobContext = { job: JobRow; recipient: RecipientRow | null; campaign: CampaignInfo | null; sender: SenderInfo | null };

export type Fail = { kind: string; message: string; attempts: number };

/** Everything the worker needs from the database. Every mutation is guarded by the job's lease (id + locked_by + status 'processing') and returns false when the lease was lost. */
export interface QueueStore {
  heartbeat(worker: string): Promise<void>;
  housekeeping(leaseSeconds: number): Promise<void>;
  claim(p: { worker: string; batch: number; senderPerMinute: number; userPerDay: number }): Promise<JobRow[]>;
  loadContexts(jobs: JobRow[]): Promise<JobContext[]>;
  isSuppressed(userId: string, email: string): Promise<boolean>;
  /** Stamped just BEFORE the provider call; lets crash recovery tell "never tried" from "may have been sent". */
  markAttempt(job: JobRow): Promise<boolean>;
  markAccepted(job: JobRow, r: { senderId: string; messageId: string; simulated: boolean }): Promise<boolean>;
  markRetry(job: JobRow, r: Fail & { delaySeconds: number }): Promise<boolean>;
  markFailed(job: JobRow, r: Fail): Promise<boolean>;
  /** Back to pending WITHOUT using up an attempt (provider quota, sender needs reauth). */
  release(job: JobRow, r: { runAfter: Date; kind: string; message: string; event: string; payload?: Record<string, unknown> }): Promise<boolean>;
  markTerminal(job: JobRow, status: "suppressed" | "cancelled", r: { kind: string; message: string }): Promise<boolean>;
  pauseSender(senderId: string, reason: string, baseMinutes: number): Promise<Date>;
  markSenderNeedsReauth(senderId: string): Promise<void>;
  refreshCampaigns(ids: string[]): Promise<void>;
  refreshActive(): Promise<void>;
}
