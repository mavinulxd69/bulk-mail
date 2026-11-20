-- Comprehensive RLS/ownership check. Run after all migrations in a throwaway Supabase/Postgres database.
-- Uses two tenants, verifies every exposed tenant table is protected, and confirms server-only tables are inaccessible.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','a@rls.test'),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','b@rls.test');

insert into sender_accounts (id, user_id, provider, from_address)
 values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','gmail','a@rls.test');
insert into sender_credentials (sender_id, user_id, encrypted_refresh_token)
 values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','encrypted-test-token');
insert into sender_domains (id, user_id, domain)
 values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000000a','rls-a.test');
insert into contacts (id, user_id, email, consent_source, consented_at)
 values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-00000000000a','contact@rls-a.test','RLS test',now());
insert into contact_lists (id, user_id, name)
 values ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-00000000000a','A list');
insert into contact_list_members (list_id, contact_id, user_id)
 values ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-00000000000a');
insert into email_templates (id, user_id, name, subject)
 values ('00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-00000000000a','A template','Hello');
insert into campaigns (id, user_id, name, sender_id, subject)
 values ('00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-00000000000a','A campaign','00000000-0000-0000-0000-0000000000a1','Hello');
insert into campaign_recipients (id, user_id, campaign_id, contact_id, email)
 values ('00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a3','contact@rls-a.test');
insert into sending_jobs (id, user_id, recipient_id, campaign_id, idempotency_key, provider)
 values ('00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a6','rls-test-a','gmail');
insert into sending_events (user_id, job_id, type)
 values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a8','queued');
insert into suppressions (user_id, email, reason)
 values ('00000000-0000-0000-0000-00000000000a','suppressed@rls-a.test','manual');
insert into consent_events (user_id, contact_id, event, source)
 values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','created','RLS test');
insert into usage_counters (user_id, day, sent)
 values ('00000000-0000-0000-0000-00000000000a',current_date,1);
insert into audit_logs (user_id, action, detail)
 values ('00000000-0000-0000-0000-00000000000a','rls.test',jsonb_build_object('tenant','a'));

insert into provider_events (provider, provider_event_id, type, payload)
 values ('resend','rls-test-event','email.delivered','{}');
insert into worker_heartbeats (worker) values ('rls-test-worker');
insert into abuse_events (user_id, kind) values ('00000000-0000-0000-0000-00000000000a','rls.test');

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','sender_accounts','sender_credentials','sender_domains','contacts','contact_lists','contact_list_members',
    'email_templates','campaigns','campaign_recipients','sending_jobs','sending_events','suppressions','consent_events',
    'usage_counters','audit_logs','provider_events','worker_heartbeats','abuse_events'
  ] loop
    if not coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)), false) then
      raise exception 'FAIL: RLS is not enabled on public.%', t;
    end if;
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

do $$
begin
  if exists (select 1 from profiles where id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A profile'; end if;
  if exists (select 1 from sender_accounts where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A sender'; end if;
  if exists (select 1 from sender_domains where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A sender domain'; end if;
  if exists (select 1 from contacts where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A contacts'; end if;
  if exists (select 1 from contact_lists where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A lists'; end if;
  if exists (select 1 from contact_list_members where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A list membership'; end if;
  if exists (select 1 from email_templates where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A templates'; end if;
  if exists (select 1 from campaigns where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A campaigns'; end if;
  if exists (select 1 from campaign_recipients where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A campaign recipients'; end if;
  if exists (select 1 from sending_jobs where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A sending jobs'; end if;
  if exists (select 1 from sending_events where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A sending events'; end if;
  if exists (select 1 from suppressions where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A suppressions'; end if;
  if exists (select 1 from consent_events where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A consent events'; end if;
  if exists (select 1 from usage_counters where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A usage counters'; end if;
  if exists (select 1 from audit_logs where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: B reads A audit logs'; end if;

  begin perform 1 from sender_credentials; raise exception 'FAIL: browser role reads sender credentials'; exception when insufficient_privilege then null; end;
  begin perform 1 from provider_events; raise exception 'FAIL: browser role reads provider webhook payloads'; exception when insufficient_privilege then null; end;
  begin perform 1 from worker_heartbeats; raise exception 'FAIL: browser role reads worker heartbeats'; exception when insufficient_privilege then null; end;
  begin perform 1 from abuse_events; raise exception 'FAIL: browser role reads abuse telemetry'; exception when insufficient_privilege then null; end;

  if not exists (select 1 from profiles where id = '00000000-0000-0000-0000-00000000000b') then raise exception 'FAIL: B cannot read own profile'; end if;
  insert into contacts (user_id, email, consent_source, consented_at)
    values ('00000000-0000-0000-0000-00000000000b','own@rls-b.test','RLS test',now());
  if not exists (select 1 from contacts where user_id = '00000000-0000-0000-0000-00000000000b') then raise exception 'FAIL: B cannot use own contact data'; end if;
end $$;

reset role;
do $$
begin
  if has_table_privilege('authenticated','public.sender_credentials','select') then raise exception 'FAIL: authenticated has sender credential SELECT privilege'; end if;
  if has_table_privilege('anon','public.sender_credentials','select') then raise exception 'FAIL: anon has sender credential SELECT privilege'; end if;
  if has_table_privilege('authenticated','public.provider_events','select') then raise exception 'FAIL: authenticated has provider event SELECT privilege'; end if;
  if has_table_privilege('authenticated','public.abuse_events','select') then raise exception 'FAIL: authenticated has abuse event SELECT privilege'; end if;
  if has_function_privilege('authenticated','abuse_summary(timestamptz)','execute') then raise exception 'FAIL: authenticated can query abuse summary'; end if;
  raise notice 'RLS across all tables: all checks passed';
end $$;

rollback;
