-- Phase 5: composer + AI drafting. Requires Postgres 15+ (ON DELETE SET NULL (column list)); Supabase ships 15/17.

-- ---- campaigns: audience, marketing flag, limits, locked-down writes ----
alter table campaigns add column if not exists audience text not null default 'all' check (audience in ('all','list'));
alter table campaigns add column if not exists audience_list_id uuid;
alter table campaigns add column if not exists updated_at timestamptz not null default now();
-- Deleting a list nulls ONLY audience_list_id. audience stays 'list', so the draft can never silently widen to "all contacts".
alter table campaigns add constraint campaigns_audience_list_fk
  foreign key (audience_list_id, user_id) references contact_lists(id, user_id) on delete set null (audience_list_id);
alter table campaigns add constraint campaigns_audience_shape check (audience = 'list' or audience_list_id is null);
alter table campaigns add constraint campaigns_name_len check (length(btrim(name)) between 1 and 120);
alter table campaigns add constraint campaigns_subject_len check (length(subject) <= 300);
alter table campaigns add constraint campaigns_body_len check (coalesce(length(html_body), 0) <= 200000 and coalesce(length(text_body), 0) <= 200000);
create trigger campaigns_updated_at before update on campaigns for each row execute function set_updated_at();

-- Browsers (anon key) may only create/edit/delete DRAFTS. Every status change after that (approval, queueing,
-- cancelling) is made server-side with the service role after checks, so a user can't mark their own campaign "queued".
drop policy owner_all on campaigns;
create policy campaigns_select on campaigns for select to authenticated using (user_id = (select auth.uid()));
create policy campaigns_insert on campaigns for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'draft' and approved_at is null);
create policy campaigns_update on campaigns for update to authenticated
  using (user_id = (select auth.uid()) and status = 'draft')
  with check (user_id = (select auth.uid()) and status = 'draft' and approved_at is null);
create policy campaigns_delete on campaigns for delete to authenticated using (user_id = (select auth.uid()) and status = 'draft');

-- Recipient rows hold the rendered message that gets sent. Only the server may create them (Phase 6).
drop policy owner_all on campaign_recipients;
create policy owner_read on campaign_recipients for select to authenticated using (user_id = (select auth.uid()));

-- ---- templates ----
alter table email_templates add constraint email_templates_name_len check (length(btrim(name)) between 1 and 120);
alter table email_templates add constraint email_templates_subject_len check (length(subject) <= 300);
alter table email_templates add constraint email_templates_body_len check (coalesce(length(html_body), 0) <= 200000 and coalesce(length(text_body), 0) <= 200000);
alter table email_templates add constraint email_templates_name_unique unique (user_id, name);
create trigger email_templates_updated_at before update on email_templates for each row execute function set_updated_at();
create index if not exists email_templates_user_idx on email_templates (user_id, updated_at desc);

-- ---- per-user daily caps for costly actions (AI drafts, real test sends) ----
alter table usage_counters add column if not exists ai_drafts int not null default 0;
alter table usage_counters add column if not exists test_sends int not null default 0;

-- Atomically counts one use and reports whether it was within the limit. Service role only.
create function claim_usage(p_user uuid, p_kind text, p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_kind not in ('ai_drafts','test_sends') then raise exception 'unknown usage kind'; end if;
  insert into usage_counters (user_id, day) values (p_user, current_date) on conflict (user_id, day) do nothing;
  if p_kind = 'ai_drafts' then
    update usage_counters set ai_drafts = ai_drafts + 1 where user_id = p_user and day = current_date and ai_drafts < p_limit returning ai_drafts into n;
  else
    update usage_counters set test_sends = test_sends + 1 where user_id = p_user and day = current_date and test_sends < p_limit returning test_sends into n;
  end if;
  return n is not null;
end $$;
revoke all on function claim_usage(uuid, text, int) from public, anon, authenticated;
grant execute on function claim_usage(uuid, text, int) to service_role;
