// Hard caps shared by server actions and the UI. Keep MAX_CONTACTS_PER_USER in sync with supabase/migrations/0003_contacts.sql.
export const MAX_IMPORT_ROWS = 5000;
export const MAX_CONTACTS_PER_USER = 10000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CUSTOM_FIELDS = 30;
export const MAX_FIELD_VALUE = 500;
export const MAX_NAME_LENGTH = 200;
export const MAX_LIST_NAME = 100;

// Phase 5
export const MAX_SUBJECT = 300;
export const MAX_BODY = 200_000;
export const MAX_CAMPAIGN_NAME = 120;
export const TEST_SENDS_PER_DAY = 10; // real emails, delivered only to the account owner

// Phase 6
export const MAX_CAMPAIGN_RECIPIENTS = 5000;
export const MAX_CAMPAIGN_RENDERED_BYTES = 100 * 1024 * 1024; // all stored per-recipient messages of one campaign
export const SEND_RATE_CHOICES = [5, 10, 30, 60, 120] as const; // per minute, per campaign
export const DEFAULT_SEND_RATE = 30;
