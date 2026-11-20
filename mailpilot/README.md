# MailPilot

Multi-tenant personalized email automation. **Status: Phase 7 of 7** (security, abuse controls, account administration, testing and deployment preparation).

## Plan
| Phase | Scope |
|---|---|
| 1 | Next.js + Tailwind, landing page, Supabase auth (signup, verify, login, reset), route protection |
| 2 | Migrations, all tables, RLS + isolation tests, dashboard shell |
| 3 | Gmail OAuth, Resend domains, provider adapter interface, token encryption |
| 4 | Contacts, CSV import, consent, variable engine with missing-variable blocking |
| 5 | Composer, AI drafts (provider-independent, draft-only) |
| 6 | Persistent queue + worker, idempotency, retries, webhooks, honest statuses |
| 7 | Rate limits, audit logs, admin, tests, deployment docs |

## Setup
1. `npm install`
2. Create a Supabase project; copy `.env.example` to `.env.local` and fill the URL and anon key.
3. In Supabase Auth: enable email confirmation; add `http://localhost:3000/auth/callback` as a redirect URL.
4. Apply `supabase/migrations/*.sql` in order (SQL editor or `supabase db push`), then run the files in `supabase/tests/`; each must report "all checks passed". Migration 0004 needs Postgres 15+ (Supabase projects have it).
5. Make yourself admin: `update profiles set is_admin = true where id = '<your user id>';`
6. `npm run dev`

Without Supabase variables the auth pages show a setup error and never pretend to work.
The UI uses plain Tailwind components (shadcn/ui was not adopted). See Testing.

## Phase 3 setup
- `TOKEN_ENCRYPTION_KEY`: `openssl rand -base64 32`. Tokens are AES-256-GCM encrypted; back this key up.
- Google: create a Web OAuth client, add redirect URI `<SITE_URL>/api/oauth/google/callback`, enable the Gmail API. The `gmail.send` scope is "sensitive": production use needs Google's OAuth app verification (testing mode works for up to 100 listed test users).
- Resend: set `RESEND_API_KEY`. All tenants' domains live in one platform Resend account.
- Providers implement `EmailProvider` (`src/lib/providers/types.ts`); add Microsoft Graph by adding one file.
- `mock.ts` is a dev provider that sends nothing and flags results as simulated.

## Phase 4: contacts and personalization
Apply `supabase/migrations/0003_contacts.sql` (adds integrity constraints, a per-user cap of 10,000 contacts, `updated_at`).

**Contacts** (`/dashboard/contacts`)
- Add recipients by pasting addresses (lines, commas, semicolons, spaces, or `Name <addr>`), pasting CSV, or uploading a CSV (2 MB / 5,000 rows per import). Comma, semicolon and tab delimiters are detected.
- CSV needs an `email` column; `name` is optional; every other column becomes a custom field usable as `{{column_name}}` (headers are lower-cased, `Boarding Code` becomes `boarding_code`). Blank cells count as missing. `unsubscribe_url`, `consent_source`, `email` and `name` can't be custom fields.
- Each import needs a consent source and an "I'm authorized" confirmation. Source and timestamp are stored on every contact and in `consent_events`.
- Results show created / updated / skipped, and every rejected row with its line and reason (invalid address, duplicate in file, missing required column, malformed row). "Required columns" rejects rows missing data instead of importing them half-complete.
- Existing contacts are skipped unless "update existing" is ticked; updating never rewrites their original consent date.
- Lists, search, pagination, edit (name, custom fields, list membership, consent history) and delete. A contact's email can't be edited, since consent belongs to the address.
- Addresses on your suppression list can be imported but are flagged and are never included in the personalization check; the queue (Phase 6) must exclude them too.

**Personalization engine** (`src/lib/personalize/engine.ts`, pure and unit-tested)
- `{{name}}`, `{{ boarding_code }}`; names are case-insensitive. No defaults/filters, on purpose: a message is rendered completely or not at all.
- Missing or blank variable, malformed placeholder (`{{name`, `{{a b}}`), empty subject or unsafe link makes `renderTemplate` return `ok: false` with the reason. The queue must treat that as "do not send".
- Values are HTML-escaped in HTML, stripped of line breaks in subjects (header injection), and `javascript:`/`data:`/`vbscript:` links are blocked. Template HTML itself is trusted author content.
- `analyzeAudience` reports ready/blocked counts, which variable is missing for how many people, variables no contact has (with a "did you mean" suggestion) and the blocked recipients.
- The "Personalization check" panel on the Contacts page runs this against real contacts and previews individual emails in a sandboxed iframe. It renders in memory only: nothing is sent or saved.

## Phase 5: composer, AI drafting, templates
Apply `supabase/migrations/0004_compose.sql`. It adds the campaign audience columns, length limits, template constraints, daily usage counters and the `claim_usage` function, and **tightens campaign writes** (see Security notes).

**Composer** (`/dashboard/compose`)
- Choose a sender (connected accounts only), recipients (all contacts or one list), subject, HTML body and plain-text body. Click a variable chip to insert `{{variable}}` at the cursor. Chips come from your contacts' columns; `{{unsubscribe_url}}` is filled in per recipient by MailPilot.
- Live checks as you type: malformed placeholders, variables no contact has, unresolved `[[markers]]`, and (for marketing mail) a missing unsubscribe link, with a one-click fix.
- **Preview** renders the real message for one chosen recipient in a sandboxed iframe (no scripts), shows how many recipients are ready or skipped and why, and counts suppressed contacts. A plain-text part is generated from the HTML when you only wrote HTML. Preview never sends or stores anything.
- **Save as draft** stores a campaign with status `draft`. Drafts reopen from "Your drafts" on the same page. A list that is later deleted leaves the draft with *no audience* (the composer asks you to choose one); it never silently becomes "all contacts".
- **Send a test to me** sends one real email, using one contact's data, **only** to your own verified account address, subject-prefixed `[Test]`, with a visible banner. Limit 10 a day. The result says "accepted by the provider", never "delivered".
- **Templates** (`/dashboard/templates`): save, update, reuse and delete subject+body pairs.
- Sending a campaign (approval, queue, tracking) is Phase 6; nothing in the composer can send to your recipients.

**AI drafting** (`src/lib/ai/`)
- Provider-independent: `AiProvider` interface with Anthropic and OpenAI-compatible adapters. Set `AI_PROVIDER`, `AI_API_KEY` (and `AI_MODEL` for OpenAI-compatible endpoints). Without them the composer says AI isn't configured. There is no fake AI.
- Draft only: the module has no access to sending code, and the result is shown for review. "Use this draft" copies it into the editor, where you can change it.
- Tones: professional, friendly, formal, short and direct.
- **Privacy:** only your instructions and variable *names* go to the AI vendor, never contact names, addresses or field values.
- **No invented facts:** the prompt forbids inventing names, codes, dates, links and so on, and tells the model to leave `[[marker]]` placeholders for facts it lacks. Markers block rendering until replaced, so a draft with a gap can't be sent. In code, the draft is also scanned for specifics (numbers, codes, times, weekdays and months, links, addresses) that your instructions never contained and each is flagged. This is a safety net, not proof, so read what you approve.
- **Safe output:** the model returns plain text. MailPilot builds the HTML itself (escaped paragraphs, bullets and bold only), so AI output can't add scripts, tracking pixels or links.
- Limits: instructions 10 to 1,000 characters, `AI_DAILY_LIMIT` drafts per user per day (default 20), 30 s timeout. Failed attempts count toward the limit.

**Local development without real mail**
Set `MAILPILOT_MOCK_PROVIDER=1` (ignored in production). Test emails are then simulated: nothing is sent, and the UI says so. You still need a sender row; insert one by hand in dev:
`insert into sender_accounts (user_id, provider, from_address, status) values ('<your user id>', 'gmail', 'dev@example.com', 'connected');`

**Security notes (migration 0004)**
- Browsers can now create, edit and delete campaigns only while `status = 'draft'` and `approved_at is null`. Approval, queueing and cancelling must be done server-side with the service role (Phase 6), so a user can't mark their own campaign "queued" through the API.
- `campaign_recipients` (the rendered messages that get sent) is read-only for users; only the server writes it.
- `claim_usage` (daily counters) is callable by the service role only.

## Phase 6: approval, sending queue, tracking

**Flow.** Composer saves a *draft* → **Review & approve** freezes it (`awaiting_approval`; the browser can no longer edit it) → the review screen shows who is in, who is skipped and why, an example message, speed and quota estimates → **Confirm and start sending** (an explicit checkbox) renders one message per recipient from that recipient's own data, writes recipients + jobs, and only then flips the campaign to `queued` in one atomic step. If anything fails, it rolls back to a reviewable state and nothing is sent. A digest of the audience is checked at confirmation: if contacts changed since the screen was opened, you must review again.

**Who is never sent to.** Suppressed addresses (recorded as "suppressed", not sent). Contacts with no consent record unless you tick an attestation box (logged). Recipients whose message can't be fully personalized unless you tick "skip them". Nothing is ever sent half-personalized.

**The queue** (`supabase/migrations/0005_queue.sql`, `src/lib/queue/`). Postgres is the queue; nothing lives in memory.
- `claim_send_jobs` hands each due job to exactly one worker (`FOR UPDATE SKIP LOCKED`; verified with 12 parallel claimers) and enforces: sender connected and not paused; sender rolling-24h quota (`daily_quota`); per-sender and per-campaign per-minute rates; a per-user rolling-24h cap.
- Idempotency: every job has a stable key `mp:<job id>`, sent to Resend as `Idempotency-Key`. The Gmail API has **no** idempotency, see crash rules below.
- Retries: temporary errors back off x4 (+-25 % jitter, base `SEND_RETRY_BASE_SECONDS`) up to `SEND_MAX_ATTEMPTS`, then fail with the reason.
- Provider quota errors (429/quota) **pause that sender** (30 min, doubling to 24 h) without consuming attempts or losing a message; after the pause one round is tried again and the provider decides whether sending resumes. The campaign page and Sender Accounts show the pause.
- Crash rules. The job is stamped `provider_attempted_at` *before* the provider call. A worker that dies before that: job just goes again. After it: **Resend** retries safely (same idempotency key); **Gmail** jobs are failed as "unknown outcome" and **not** retried, because a retry could send a duplicate and send-only access can't look the message up. Same rule for Gmail network timeouts.
- Cancel stops every unsent message; messages already handed to the provider can't be recalled. A message is re-checked (cancelled? contact deleted? suppressed? sender connected?) immediately before sending.
- Campaign status is derived from the jobs (`refresh_campaign_status`): Queued → Sending → Completed / Partially failed / Failed. A bounce arriving later can move Completed to Partially failed.

**Honest statuses.** Pending ("Queued"), Processing, **Accepted by provider** (API said yes; *not* delivery), **Delivered** (only when Resend confirms by webhook), Bounced, Failed, Suppressed, Cancelled. Gmail never reports delivery to a send-only app, so Gmail messages stay at "Accepted by provider" and the UI says so. In dev mock mode jobs are marked **simulated** everywhere and excluded from usage and stats.

**Webhooks (Resend).** `POST /api/webhooks/resend`, Svix-signature verified (`RESEND_WEBHOOK_SECRET`, 5-minute replay window), idempotent by event id. Events are stored first and applied after, so a "delivered" that beats our own "accepted" write isn't lost. Hard bounces and spam complaints add the address to your suppression list. Opens and clicks are deliberately not tracked. In Resend: Webhooks → add `https://<your-domain>/api/webhooks/resend`, events `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`, `email.failed`, `email.suppressed`.

**Unsubscribe.** Each recipient gets their own 256-bit token. Marketing campaigns require `{{unsubscribe_url}}` and also send `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click, `POST /api/unsubscribe/<token>`). The link opens a confirmation page (a GET never unsubscribes, so link scanners can't); confirming suppresses the address for that sender, stops its pending messages in every campaign, records a consent revocation, and writes an audit entry without the address.

**Contact deletion** now keeps delivery records but erases the person: pending messages are cancelled, and email, rendered content and token on their recipient rows are wiped.

**Running the worker** (pick one; they can be combined, the database makes it safe):
| Where | How |
|---|---|
| Vercel (Pro, per-minute cron) | `vercel.json` already schedules `GET /api/worker/tick` every minute. Set `CRON_SECRET`. Vercel Hobby only allows daily crons: use a scheduler below or the standalone worker. |
| Any scheduler (GitHub Actions, cron-job.org, ...) | `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/worker/tick` every minute. |
| A server / Docker / Railway / Fly | `npm run worker` (same code, loops until SIGTERM). |
Approving a campaign also starts a short best-effort run, so sending begins immediately. The campaign page warns if no worker has run for 3 minutes. A tick that is cut off loses nothing.

**Settings** (all optional, bounded, see `.env.example`): `SEND_MAX_ATTEMPTS`, `SENDER_MAX_PER_MINUTE`, `USER_DAILY_SEND_LIMIT`, `WORKER_*`, `QUOTA_PAUSE_MINUTES`. Per-campaign speed (5-120/min) is chosen at approval. `NEXT_PUBLIC_SITE_URL` must be your public https address (unsubscribe links).

## Testing
```bash
npm test                 # unit tests (CSV, validation, engine, composer, AI, queue/retry/webhook logic); no database needed
npm run typecheck
```

## Development standards
- Put reusable UI in `src/components/`, provider adapters in `src/lib/providers/`, and queue/compose/business rules in `src/lib/`; keep server actions focused on validation, authorization, orchestration, and user-facing results.
- Validate all client-submitted values on the server. Use the existing provider interface and keep tests explicit when an adapter is faked.
- Route-level loading and error boundaries provide feedback during navigation or unexpected failures. Forms and data pages should keep their empty states and inline success/error notices accessible with status roles.
- `MAILPILOT_MOCK_PROVIDER=1` is local-development only. The mock never calls an email provider, marks every result simulated, and is ignored in production. Simulated sends are never counted as real delivery or usage.
- Add schema changes as ordered Supabase migrations, including indexes for new query paths, and cover tenant isolation with database tests before deploying.

Database tests (use a local or throwaway Supabase/Postgres, never production):
1. Apply all migrations (Postgres 15+), then `supabase/tests/rls_isolation.sql`, `rls_contacts.sql`, `rls_compose.sql`, `rls_all_tables.sql` and `queue.sql` (claiming, quotas, rates, pauses, crash recovery, status, approval steps, unsubscribe, webhooks, erasure, privileges). Each must print "all checks passed". `rls_all_tables.sql` verifies RLS is enabled on every exposed and server-only table, tenant A data is invisible to tenant B, and token/webhook/abuse data is not readable by browser roles. On a plain local Postgres (not Supabase) run `supabase/tests/local_bootstrap.sql` first; it recreates Supabase's roles and `auth` stub. Never run it on Supabase.
2. Integration test of the real import pipeline and page queries through the REST API with RLS on, as two tenants:
   run `supabase/tests/seed_integration_users.sql`, then
   `PGRST_URL=<rest url> PGRST_JWT_SECRET=<jwt secret> NEXT_PUBLIC_SITE_URL=https://app.test npm test`. This also runs `queue.integration.test.ts`: the real approval pipeline, store and worker against the database with only the email provider faked. It covers concurrent workers, shared user quotas across sender accounts, rate limits, retries, pause/resume, provider uncertainty, crash recovery, cancellation, unsubscribe, contact erasure, webhooks, and tenant isolation. The URL must serve PostgREST at its root (a local PostgREST, not the hosted `/rest/v1` path). Without those variables the test is skipped.

## Phase 7: security and administration
- Authentication, OAuth, contact/sender actions, test sends, campaign confirmation, webhooks, and unsubscribe use request limits. Local development uses a bounded in-memory limiter; production requires both Upstash credentials and fails closed if they are absent or unavailable. Upstash increments and expirations run in one transaction. Abuse events store an HMAC of the client IP, not its raw value.
- `/admin` is restricted to `profiles.is_admin`; it includes account plans, account disable/enable actions, abuse summary and recent audit events.
- Account plans reserve monthly capacity atomically at campaign confirmation. Queue claims serialize on the user profile so concurrent workers across multiple sender accounts cannot exceed the rolling daily cap; sender limits remain separate.
- Campaign sending requires a verified account email and an explicit confirmation. Campaign imports and confirmation require the user to attest that recipients consented or are otherwise authorized; unsubscribe requests and provider complaints create suppression records checked before sending.
- OAuth refresh/access tokens are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`; the service-role key is server-only. OAuth state is random, HttpOnly, short-lived, and timing-safely validated. Next.js Server Actions provide origin/CSRF checks; provider webhooks require their signature.
- Settings supports password changes and confirmed account deletion through the Supabase Admin API.
- Apply `supabase/migrations/0006_phase7.sql` and `0007_security_quota_hardening.sql` after the earlier migrations.

## Step 8: production launch preparation
1. Apply all migrations in filename order to the target Supabase project.
2. Set production secrets in the hosting platform, never in source control.
3. Configure the public HTTPS `NEXT_PUBLIC_SITE_URL`, Google redirect URI and Resend webhook URL.
4. Run `npm run verify:production` before deployment. This only verifies configuration; it does not send email.
5. Run `npm run build` and `npm test`.
6. Configure an external worker or Vercel Cron with `CRON_SECRET`, and verify `/api/health` returns 200.
7. In a non-production test account, perform and document Gmail and Resend end-to-end test sends.
8. Capture real delivery/bounce webhook events through the provider dashboards before approving volume.

## Known limitations
- Gmail: no delivery or bounce reporting (send-only scope), no idempotency; jobs in an unknown state are failed, not re-sent. Quota pauses are estimated by backoff, because Gmail doesn't tell a client when its limit resets.
- A message already handed to the provider when you cancel can't be recalled.
- Rendered messages are stored per recipient (up to 100 MB per campaign) so what you approved is exactly what is sent; they are erased when the contact is deleted. Provider webhook payloads are purged after 30 days.
- No manual "retry failed" button yet: failures show their reason; re-send by creating a campaign for those contacts.
- Pre-Phase-4 contact rows without consent data are kept (constraint is `NOT VALID`) and shown as "Not recorded"; they are skipped at approval unless you tick the attestation.
- Next.js `after()` runs the approval-time worker kick; on hosts that don't support it, cron or `npm run worker` starts sending within a minute.
