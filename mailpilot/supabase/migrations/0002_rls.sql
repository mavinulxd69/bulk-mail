-- Row Level Security: enabled on EVERY table.
do $$ declare t text; begin
  foreach t in array array['profiles','sender_accounts','sender_credentials','sender_domains','contacts','contact_lists','contact_list_members',
    'email_templates','campaigns','campaign_recipients','sending_jobs','sending_events','suppressions','consent_events','usage_counters','audit_logs']
  loop execute format('alter table %I enable row level security', t); end loop; end $$;

-- Owner full access (user_id = auth.uid())
do $$ declare t text; begin
  foreach t in array array['sender_domains','contacts','contact_lists','contact_list_members','email_templates','campaigns','campaign_recipients','suppressions','consent_events']
  loop execute format('create policy owner_all on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t); end loop; end $$;

-- Read-only for users; only the server (service role) writes these
do $$ declare t text; begin
  foreach t in array array['sender_accounts','sending_jobs','sending_events','usage_counters','audit_logs']
  loop execute format('create policy owner_read on %I for select to authenticated using (user_id = (select auth.uid()))', t); end loop; end $$;

create policy own_profile_read on profiles for select to authenticated using (id = (select auth.uid()));
create policy own_profile_update on profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Users may change only their display name (not is_admin)
revoke update on profiles from authenticated;
grant update (display_name, onboarded_at) on profiles to authenticated;
-- sender_credentials: no policy on purpose. Deny-all for anon/authenticated.
revoke all on sender_credentials from anon, authenticated;
