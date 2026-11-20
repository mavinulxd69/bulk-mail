-- Phase 6: persistent sending queue, honest delivery tracking, unsubscribe, provider webhooks.
-- Requires Postgres 15+ (security_invoker views, ON DELETE SET NULL (column list)).
-- Every function below is SECURITY DEFINER and callable by the service role only; browsers never reach them.

-- ================= campaigns: server-controlled lifecycle =================
alter table campaigns add column if not exists send_rate_per_minute int not null default 30 check (send_rate_per_minute between 1 and 120);
alter table campaigns add column if not exists queue_started_at timestamptz;  -- set while recipients/jobs are being written; cleared on rollback
alter table campaigns add column if not exists queued_at timestamptz;
alter table campaigns add column if not exists completed_at timestamptz;
alter table campaigns add column if not exists cancelled_at timestamptz;
alter table campaigns add column if not exists skipped_count int not null default 0; -- recipients left out at approval (missing data / no consent record)
alter table campaigns add column if not exists test_sent_at timestamptz;             -- last test email of the SAVED content

-- Browsers may write only the content columns of a draft. Lifecycle columns (status after draft, approval, rate, counts)
-- can't be touched through the API even on a draft.
revoke insert, update on campaigns from authenticated;
grant insert (id, user_id, name, sender_id, subject, html_body, text_body, is_marketing, audience, audience_list_id, status) on campaigns to authenticated;
grant update (name, sender_id, subject, html_body, text_body, is_marketing, audience, audience_list_id) on campaigns to authenticated;

-- Editing the saved content invalidates "a test was sent".
create function campaigns_reset_test() returns trigger language plpgsql as $$
begin
  if new.subject is distinct from old.subject or new.html_body is distinct from old.html_body or new.text_body is distinct from old.text_body then
    new.test_sent_at := null;
  end if;
  return new;
end $$;
create trigger campaigns_reset_test before update on campaigns for each row execute function campaigns_reset_test();

-- ================= sender accounts: provider-quota pause =================
alter table sender_accounts add column if not exists paused_until timestamptz;
alter table sender_accounts add column if not exists pause_reason text;
alter table sender_accounts add column if not exists pause_count int not null default 0;
alter table sender_accounts add constraint sender_accounts_quota_range check (daily_quota between 1 and 100000);

-- ================= campaign_recipients: survive contact deletion, carry unsubscribe token =================
alter table campaign_recipients alter column contact_id drop not null;
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'campaign_recipients'::regclass and confrelid = 'contacts'::regclass and contype = 'f';
  if c is not null then execute format('alter table campaign_recipients drop constraint %I', c); end if;
end $$;
-- Deleting a contact keeps the delivery record (counts, statuses) but erases the person: see erase_contact_sends().
alter table campaign_recipients add constraint campaign_recipients_contact_fk
  foreign key (contact_id, user_id) references contacts(id, user_id) on delete set null (contact_id);
alter table campaign_recipients add column if not exists email text;
alter table campaign_recipients add column if not exists unsubscribe_token text unique;
alter table campaign_recipients add column if not exists erased_at timestamptz;
alter table campaign_recipients add constraint campaign_recipients_email_normalized check (email is null or (email = lower(btrim(email)) and email !~ '[[:space:][:cntrl:]]'));
create index if not exists campaign_recipients_contact_idx on campaign_recipients (contact_id) where contact_id is not null;
create index if not exists campaign_recipients_email_idx on campaign_recipients (user_id, email) where email is not null;

-- ================= sending_jobs =================
alter table sending_jobs add column if not exists provider text check (provider in ('gmail','resend'));
alter table sending_jobs add column if not exists last_attempt_at timestamptz;      -- set when a worker claims the job
alter table sending_jobs add column if not exists provider_attempted_at timestamptz; -- set just BEFORE the provider call; null again on re-claim
alter table sending_jobs add column if not exists accepted_at timestamptz;
alter table sending_jobs add column if not exists delivered_at timestamptz;
alter table sending_jobs add column if not exists locked_by text;
alter table sending_jobs add column if not exists last_error_kind text;
alter table sending_jobs add column if not exists simulated boolean not null default false; -- dev mock provider: nothing was really sent
alter table sending_jobs drop constraint if exists sending_jobs_status_check;
alter table sending_jobs add constraint sending_jobs_status_check
  check (status in ('pending','processing','accepted','delivered','bounced','failed','suppressed','cancelled'));
alter table sending_jobs add constraint sending_jobs_attempts_range check (attempts >= 0 and max_attempts between 1 and 10);
alter table sending_jobs add constraint sending_jobs_campaign_fk foreign key (campaign_id, user_id) references campaigns(id, user_id) on delete cascade;
create index if not exists sending_jobs_campaign_pending_idx on sending_jobs (campaign_id, run_after) where status = 'pending';
create index if not exists sending_jobs_campaign_attempt_idx on sending_jobs (campaign_id, last_attempt_at) where last_attempt_at is not null;
create index if not exists sending_jobs_campaign_accepted_idx on sending_jobs (campaign_id, accepted_at) where accepted_at is not null;
create index if not exists sending_jobs_user_accepted_idx on sending_jobs (user_id, accepted_at) where accepted_at is not null;
create index if not exists sending_jobs_message_idx on sending_jobs (provider, provider_message_id) where provider_message_id is not null;
create index if not exists sending_jobs_recipient_idx on sending_jobs (recipient_id);
create index if not exists sending_events_user_idx on sending_events (user_id, created_at desc);

-- ================= provider webhook inbox (service role only) =================
-- Events are stored first, then applied, so a "delivered" webhook that beats our own "accepted" write is never lost.
create table provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend')),
  provider_event_id text not null,
  provider_message_id text,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (provider, provider_event_id));
create index provider_events_pending_idx on provider_events (provider, provider_message_id) where applied_at is null;
create index provider_events_received_idx on provider_events (received_at);
alter table provider_events enable row level security; -- no policies: deny-all for browsers
revoke all on provider_events from anon, authenticated;

create table worker_heartbeats (worker text primary key, beat_at timestamptz not null default now());
alter table worker_heartbeats enable row level security;
revoke all on worker_heartbeats from anon, authenticated;

-- ================= read models (RLS of the underlying tables applies: security_invoker) =================
create view campaign_stats with (security_invoker = true) as
select c.id as campaign_id, c.user_id,
  count(j.id)::int as total,
  (count(j.id) filter (where j.status = 'pending'))::int as pending,
  (count(j.id) filter (where j.status = 'processing'))::int as processing,
  (count(j.id) filter (where j.status = 'accepted'))::int as accepted,
  (count(j.id) filter (where j.status = 'delivered'))::int as delivered,
  (count(j.id) filter (where j.status = 'bounced'))::int as bounced,
  (count(j.id) filter (where j.status = 'failed'))::int as failed,
  (count(j.id) filter (where j.status = 'suppressed'))::int as suppressed,
  (count(j.id) filter (where j.status = 'cancelled'))::int as cancelled,
  (count(j.id) filter (where j.simulated))::int as simulated
from campaigns c left join sending_jobs j on j.campaign_id = c.id and j.user_id = c.user_id
group by c.id, c.user_id;
grant select on campaign_stats to authenticated;

create view daily_send_stats with (security_invoker = true) as
select user_id, (accepted_at at time zone 'utc')::date as day, count(*)::int as accepted
from sending_jobs where accepted_at is not null and not simulated group by 1, 2;
grant select on daily_send_stats to authenticated;

-- ================= contact erasure: keep counts, drop the person =================
create function erase_contact_sends() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update sending_jobs j set status = 'cancelled', last_error = 'The contact was deleted before this message was sent.', last_error_kind = 'contact_deleted', locked_at = null, locked_by = null
   where j.user_id = old.user_id and j.status = 'pending'
     and j.recipient_id in (select r.id from campaign_recipients r where r.contact_id = old.id and r.user_id = old.user_id);
  update campaign_recipients set email = null, rendered_subject = null, rendered_html = null, rendered_text = null, unsubscribe_token = null, erased_at = now()
   where contact_id = old.id and user_id = old.user_id;
  return old;
end $$;
create trigger contacts_erase_sends before delete on contacts for each row execute function erase_contact_sends();

-- ================= lifecycle functions =================
-- Campaign status is derived from its jobs. Only ever moves between queued/sending/completed/partially_failed/failed.
create function refresh_campaign_status(p_campaign uuid) returns text language plpgsql security definer set search_path = public as $$
declare c campaigns; open_n int; ok_n int; bad_n int; started boolean; s text;
begin
  select * into c from campaigns where id = p_campaign for update;
  if not found or c.status not in ('queued','sending','completed','partially_failed','failed') then return null; end if;
  select count(*) filter (where status in ('pending','processing')),
         count(*) filter (where status in ('accepted','delivered')),
         count(*) filter (where status in ('failed','bounced')),
         coalesce(bool_or(status <> 'pending' or last_attempt_at is not null), false)
    into open_n, ok_n, bad_n, started from sending_jobs where campaign_id = p_campaign;
  if open_n > 0 then s := case when c.status = 'queued' and not started then 'queued' else 'sending' end;
  elsif bad_n > 0 and ok_n = 0 then s := 'failed';
  elsif bad_n > 0 then s := 'partially_failed';
  else s := 'completed'; end if;
  if s <> c.status then
    update campaigns set status = s, completed_at = case when s in ('completed','partially_failed','failed') then coalesce(completed_at, now()) else null end where id = p_campaign;
  end if;
  return s;
end $$;

create function refresh_active_campaigns() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from campaigns where status in ('queued','sending') loop perform refresh_campaign_status(r.id); n := n + 1; end loop;
  return n;
end $$;

-- Atomic compare-and-set steps of approval. Approval itself is a confirmation made by the signed-in user in the app.
create function begin_queueing(p_campaign uuid, p_user uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update campaigns set queue_started_at = now(), approved_at = now()
   where id = p_campaign and user_id = p_user and status = 'awaiting_approval' and queue_started_at is null;
  get diagnostics n = row_count; return n = 1;
end $$;

create function activate_campaign(p_campaign uuid, p_user uuid, p_expected int) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update campaigns c set status = 'queued', queued_at = now()
   where c.id = p_campaign and c.user_id = p_user and c.status = 'awaiting_approval' and c.queue_started_at is not null
     and (select count(*) from sending_jobs j where j.campaign_id = c.id) = p_expected;
  get diagnostics n = row_count; return n = 1;
end $$;

-- Puts a half-written approval back to a reviewable state: removes recipients (jobs cascade) and the approval stamp.
create function rollback_queueing(p_campaign uuid, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from campaigns where id = p_campaign and user_id = p_user and status = 'awaiting_approval' and queue_started_at is not null) then
    delete from campaign_recipients where campaign_id = p_campaign and user_id = p_user;
    update campaigns set queue_started_at = null, approved_at = null where id = p_campaign and user_id = p_user;
  end if;
end $$;

create function cancel_campaign(p_campaign uuid, p_user uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int; st text;
begin
  select status into st from campaigns where id = p_campaign and user_id = p_user for update;
  if st is null or st not in ('queued','sending','awaiting_approval') then return null; end if;
  update campaigns set status = 'cancelled', cancelled_at = now() where id = p_campaign;
  with c as (update sending_jobs set status = 'cancelled', last_error = 'Cancelled by you before it was sent.', last_error_kind = 'cancelled', locked_at = null, locked_by = null
              where campaign_id = p_campaign and status = 'pending' returning id, user_id)
  insert into sending_events (user_id, job_id, type, provider_payload) select user_id, id, 'cancelled', null from c;
  get diagnostics n = row_count;
  return n; -- messages already being handed to the provider can't be recalled
end $$;

-- Crash recovery for approvals that never finished writing.
create function revert_stale_queueing(p_minutes int default 15) returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, user_id from campaigns where status = 'awaiting_approval' and queue_started_at < now() - make_interval(mins => p_minutes) for update skip locked
  loop perform rollback_queueing(r.id, r.user_id); n := n + 1; end loop;
  return n;
end $$;

-- ================= the queue =================
-- Hands out due jobs to ONE worker. Enforces, per sender: connected + not paused, rolling 24h quota, per-minute rate;
-- per campaign: its own per-minute rate; per user: rolling 24h cap. FOR UPDATE SKIP LOCKED means two workers never get the same job.
create function claim_send_jobs(p_worker text, p_batch int, p_sender_per_minute int, p_user_per_day int)
returns setof sending_jobs language plpgsql security definer set search_path = public as $$
declare
  s record; c record; r sending_jobs;
  batch_left int := p_batch; quota_left int; user_left int; sender_rate_left int; camp_rate_left int; n int; got int;
begin
  for s in
    select sa.id, sa.user_id, sa.daily_quota from sender_accounts sa
     where sa.status = 'connected' and (sa.paused_until is null or sa.paused_until <= now())
       and exists (select 1 from campaigns c2 join sending_jobs j on j.campaign_id = c2.id
                    where c2.sender_id = sa.id and c2.status in ('queued','sending') and j.status = 'pending' and j.run_after <= now())
     order by sa.id
  loop
    exit when batch_left <= 0;
    perform pg_advisory_xact_lock(hashtextextended('sender:' || s.id::text, 0));
    select s.daily_quota - count(*) into quota_left from sending_jobs j join campaigns c3 on c3.id = j.campaign_id
     where c3.sender_id = s.id and (j.status = 'processing' or j.accepted_at > now() - interval '24 hours');
    select p_user_per_day - count(*) into user_left from sending_jobs j
     where j.user_id = s.user_id and (j.status = 'processing' or j.accepted_at > now() - interval '24 hours');
    select p_sender_per_minute - count(*) into sender_rate_left from sending_jobs j join campaigns c4 on c4.id = j.campaign_id
     where c4.sender_id = s.id and j.last_attempt_at > now() - interval '1 minute';

    for c in
      select c5.id, c5.send_rate_per_minute from campaigns c5
       where c5.sender_id = s.id and c5.status in ('queued','sending')
         and exists (select 1 from sending_jobs j where j.campaign_id = c5.id and j.status = 'pending' and j.run_after <= now())
       order by c5.approved_at, c5.id
    loop
      select c.send_rate_per_minute - count(*) into camp_rate_left from sending_jobs j where j.campaign_id = c.id and j.last_attempt_at > now() - interval '1 minute';
      n := least(batch_left, quota_left, user_left, sender_rate_left, camp_rate_left);
      continue when n <= 0;
      got := 0;
      for r in
        update sending_jobs j set status = 'processing', locked_at = now(), locked_by = p_worker, last_attempt_at = now(), provider_attempted_at = null
         where j.id in (select j2.id from sending_jobs j2 where j2.campaign_id = c.id and j2.status = 'pending' and j2.run_after <= now()
                         order by j2.run_after, j2.created_at, j2.id limit n for update skip locked)
        returning j.*
      loop
        got := got + 1; return next r;
      end loop;
      batch_left := batch_left - got; quota_left := quota_left - got; user_left := user_left - got; sender_rate_left := sender_rate_left - got;
    end loop;
  end loop;
  return;
end $$;

-- A worker that died mid-job leaves it 'processing'. If it had not reached the provider yet, the job just goes back to pending.
-- If it HAD: Resend de-duplicates on the idempotency key, so a retry is safe; Gmail has no idempotency and no way to look the message up
-- with send-only access, so the job is failed as "unknown outcome" instead of risking a duplicate email.
create function requeue_expired_jobs(p_lease_seconds int) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with expired as (
    update sending_jobs j set
      attempts = case when j.provider_attempted_at is not null then j.attempts + 1 else j.attempts end,
      status = case when j.provider_attempted_at is null then 'pending'
                    when j.provider = 'resend' and j.attempts + 1 < j.max_attempts then 'pending'
                    else 'failed' end,
      last_error_kind = case when j.provider_attempted_at is null then j.last_error_kind
                             when j.provider = 'resend' and j.attempts + 1 < j.max_attempts then 'temporary'
                             else 'unknown_outcome' end,
      last_error = case when j.provider_attempted_at is null then j.last_error
                        when j.provider = 'resend' and j.attempts + 1 < j.max_attempts then 'The worker stopped while sending; retrying safely (Resend de-duplicates).'
                        else 'The worker stopped while sending, so MailPilot cannot confirm whether the provider accepted this message. It was not retried, to avoid sending a duplicate. Check the sender''s Sent folder.' end,
      run_after = now(), locked_at = null, locked_by = null
    where j.status = 'processing' and j.locked_at < now() - make_interval(secs => p_lease_seconds)
    returning j.id, j.user_id, j.status, j.last_error_kind)
  insert into sending_events (user_id, job_id, type, provider_payload)
    select user_id, id, 'lease_expired', jsonb_build_object('result', status, 'kind', last_error_kind) from expired;
  get diagnostics n = row_count;
  return n;
end $$;

-- Provider said "slow down / quota": stop that sender for a while, doubling each time (30 min up to 24 h). Not escalated if already paused.
-- After the pause, ONE round of jobs is tried again; the provider decides whether sending may resume.
create function pause_sender(p_sender uuid, p_reason text, p_base_minutes int default 30) returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  update sender_accounts set pause_count = pause_count + 1, pause_reason = p_reason,
         paused_until = now() + least(p_base_minutes * power(2, least(pause_count, 6)), 1440) * interval '1 minute'
   where id = p_sender and (paused_until is null or paused_until <= now()) returning paused_until into t;
  if t is null then select paused_until into t from sender_accounts where id = p_sender; end if;
  return t;
end $$;

create function record_sent(p_user uuid) returns void language sql security definer set search_path = public as $$
  insert into usage_counters (user_id, day, sent) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set sent = usage_counters.sent + 1;
$$;

-- ================= unsubscribe =================
-- Public link, so the token is the only credential (256-bit random, generated by the server).
create function apply_unsubscribe(p_token text) returns text language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select cr.user_id, cr.email, cr.campaign_id into r from campaign_recipients cr where cr.unsubscribe_token = p_token and cr.email is not null;
  if not found then return null; end if;
  insert into suppressions (user_id, email, reason) values (r.user_id, r.email, 'unsubscribe') on conflict (user_id, email) do nothing;
  insert into consent_events (user_id, contact_id, event, source)
    select user_id, id, 'revoked', 'unsubscribe link' from contacts where user_id = r.user_id and email = r.email;
  with s as (update sending_jobs j set status = 'suppressed', last_error = 'The recipient unsubscribed.', last_error_kind = 'unsubscribed'
              where j.user_id = r.user_id and j.status = 'pending'
                and j.recipient_id in (select id from campaign_recipients where user_id = r.user_id and email = r.email)
              returning j.id, j.user_id)
  insert into sending_events (user_id, job_id, type, provider_payload) select user_id, id, 'suppressed', jsonb_build_object('reason', 'unsubscribe') from s;
  insert into audit_logs (user_id, action, detail) values (r.user_id, 'recipient.unsubscribed', jsonb_build_object('campaign_id', r.campaign_id)); -- no address in the log
  return r.email;
end $$;

-- ================= webhooks: apply provider events to jobs =================
create function apply_provider_event(p_event uuid) returns text language plpgsql security definer set search_path = public as $$
declare e provider_events; j sending_jobs; new_status text; addr text; bounce_type text; msg text;
begin
  select * into e from provider_events where id = p_event and applied_at is null for update;
  if not found then return 'already_applied'; end if;
  select * into j from sending_jobs where provider = e.provider and provider_message_id = e.provider_message_id for update;
  if not found then return 'no_job'; end if; -- stays unapplied: either not ours (e.g. a test email) or our accepted write is still in flight

  new_status := case e.type
    when 'email.delivered'  then case when j.status = 'accepted' then 'delivered' end
    when 'email.bounced'    then case when j.status in ('accepted','delivered') then 'bounced' end
    when 'email.failed'     then case when j.status = 'accepted' then 'failed' end
    when 'email.suppressed' then case when j.status = 'accepted' then 'suppressed' end
  end;
  bounce_type := e.payload #>> '{data,bounce,type}';
  msg := left(coalesce(e.payload #>> '{data,bounce,message}', e.payload #>> '{data,failed,reason}', ''), 300);
  select email into addr from campaign_recipients where id = j.recipient_id;

  if new_status is not null then
    update sending_jobs set status = new_status,
           delivered_at = case when new_status = 'delivered' then now() else delivered_at end,
           last_error = case when new_status in ('bounced','failed','suppressed') then nullif(msg, '') else last_error end,
           last_error_kind = case when new_status = 'bounced' then 'bounce' when new_status = 'failed' then 'provider_failed' when new_status = 'suppressed' then 'provider_suppressed' else last_error_kind end
     where id = j.id;
  end if;
  -- Hard bounces and complaints stop all future mail to that address.
  if addr is not null and ((e.type = 'email.bounced' and bounce_type = 'Permanent') or e.type = 'email.complained') then
    insert into suppressions (user_id, email, reason) values (j.user_id, addr, case when e.type = 'email.complained' then 'complaint' else 'bounce' end) on conflict (user_id, email) do nothing;
  end if;
  insert into sending_events (user_id, job_id, type, provider_payload)
    values (j.user_id, j.id, substr(e.type, 7), jsonb_build_object('event_id', e.provider_event_id, 'applied_status', new_status, 'bounce_type', bounce_type));
  update provider_events set applied_at = now() where id = e.id;
  perform refresh_campaign_status(j.campaign_id);
  return coalesce(new_status, 'recorded');
end $$;

create function apply_pending_events(p_provider text, p_message_id text) returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from provider_events where provider = p_provider and provider_message_id = p_message_id and applied_at is null order by received_at, id
  loop perform apply_provider_event(r.id); n := n + 1; end loop;
  return n;
end $$;

create function housekeeping(p_lease_seconds int) returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  a := requeue_expired_jobs(p_lease_seconds);
  b := revert_stale_queueing(15);
  delete from provider_events where received_at < now() - interval '30 days'; get diagnostics c = row_count;
  delete from worker_heartbeats where beat_at < now() - interval '7 days';
  return jsonb_build_object('requeued', a, 'reverted_queueing', b, 'purged_events', c);
end $$;

-- ================= privileges: service role only =================
do $$ declare f text; begin
  foreach f in array array[
    'refresh_campaign_status(uuid)', 'refresh_active_campaigns()', 'begin_queueing(uuid,uuid)', 'activate_campaign(uuid,uuid,int)',
    'rollback_queueing(uuid,uuid)', 'cancel_campaign(uuid,uuid)', 'revert_stale_queueing(int)', 'claim_send_jobs(text,int,int,int)',
    'requeue_expired_jobs(int)', 'pause_sender(uuid,text,int)', 'record_sent(uuid)', 'apply_unsubscribe(text)',
    'apply_provider_event(uuid)', 'apply_pending_events(text,text)', 'housekeeping(int)', 'erase_contact_sends()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
