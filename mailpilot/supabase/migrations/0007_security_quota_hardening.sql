-- Security hardening: reserve monthly plan capacity atomically and serialize per-user queue claims.
alter table campaigns add column if not exists monthly_send_reserved int not null default 0
  check (monthly_send_reserved between 0 and 5000);

drop function if exists public.begin_queueing(uuid, uuid);
create function begin_queueing(p_campaign uuid, p_user uuid, p_requested int)
returns boolean language plpgsql security definer set search_path = public as $$
declare allowed int; accepted_count bigint; reserved_count bigint; changed int;
begin
  if p_requested is null or p_requested < 1 or p_requested > 5000 then return false; end if;
  select monthly_send_limit into allowed from profiles where id = p_user for update;
  if allowed is null then return false; end if;

  select count(*) into accepted_count from sending_jobs
   where user_id = p_user and accepted_at >= date_trunc('month', current_date)::date and not simulated;
  select coalesce(sum(greatest(c.monthly_send_reserved, coalesce(open_jobs.amount, 0))), 0)
    into reserved_count
    from campaigns c
    left join lateral (
      select count(*) as amount from sending_jobs j
       where j.campaign_id = c.id and j.user_id = c.user_id and j.status in ('pending','processing')
    ) open_jobs on true
   where c.user_id = p_user
     and (c.status in ('queued','sending') or (c.status = 'awaiting_approval' and c.queue_started_at is not null));
  if accepted_count + reserved_count + p_requested > allowed then return false; end if;

  update campaigns set queue_started_at = now(), approved_at = now(), monthly_send_reserved = p_requested
   where id = p_campaign and user_id = p_user and status = 'awaiting_approval' and queue_started_at is null;
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function begin_queueing(uuid, uuid, int) from public, anon, authenticated;
grant execute on function begin_queueing(uuid, uuid, int) to service_role;

create or replace function activate_campaign(p_campaign uuid, p_user uuid, p_expected int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update campaigns c set status = 'queued', queued_at = now(), monthly_send_reserved = 0
   where c.id = p_campaign and c.user_id = p_user and c.status = 'awaiting_approval' and c.queue_started_at is not null
     and (select count(*) from sending_jobs j where j.campaign_id = c.id) = p_expected;
  get diagnostics n = row_count; return n = 1;
end $$;

create or replace function rollback_queueing(p_campaign uuid, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from campaigns where id = p_campaign and user_id = p_user and status = 'awaiting_approval' and queue_started_at is not null) then
    delete from campaign_recipients where campaign_id = p_campaign and user_id = p_user;
    update campaigns set queue_started_at = null, approved_at = null, monthly_send_reserved = 0
     where id = p_campaign and user_id = p_user;
  end if;
end $$;

create or replace function cancel_campaign(p_campaign uuid, p_user uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int; st text;
begin
  select status into st from campaigns where id = p_campaign and user_id = p_user for update;
  if st is null or st not in ('queued','sending','awaiting_approval') then return null; end if;
  update campaigns set status = 'cancelled', cancelled_at = now(), monthly_send_reserved = 0 where id = p_campaign;
  with c as (
    update sending_jobs set status = 'cancelled', last_error = 'Cancelled by you before it was sent.',
      last_error_kind = 'cancelled', locked_at = null, locked_by = null
     where campaign_id = p_campaign and status = 'pending' returning id, user_id
  )
  insert into sending_events (user_id, job_id, type, provider_payload)
    select user_id, id, 'cancelled', null from c;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function claim_send_jobs(p_worker text, p_batch int, p_sender_per_minute int, p_user_per_day int)
returns setof sending_jobs language plpgsql security definer set search_path = public as $$
declare
  s record; c record; r sending_jobs;
  batch_left int := p_batch; quota_left int; user_left int; monthly_left int; sender_daily int;
  sender_rate_left int; camp_rate_left int; n int; got int;
begin
  for s in
    select sa.id, sa.user_id, sa.daily_quota from sender_accounts sa
     where sa.status = 'connected' and (sa.paused_until is null or sa.paused_until <= now())
       and exists (
         select 1 from campaigns c2 join sending_jobs j on j.campaign_id = c2.id
          where c2.sender_id = sa.id and c2.status in ('queued','sending') and j.status = 'pending' and j.run_after <= now()
       )
     order by sa.user_id, sa.id
  loop
    exit when batch_left <= 0;
    perform 1 from profiles p where p.id = s.user_id for update;
    if not found then continue; end if;
    select sa.daily_quota into sender_daily from sender_accounts sa
     where sa.id = s.id and sa.status = 'connected' and (sa.paused_until is null or sa.paused_until <= now()) for update;
    if not found then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended('sender:' || s.id::text, 0));

    select sender_daily - count(*) into quota_left from sending_jobs j join campaigns c3 on c3.id = j.campaign_id
     where c3.sender_id = s.id and (j.status = 'processing' or (j.accepted_at > now() - interval '24 hours' and not j.simulated));
    select p_user_per_day - count(*) into user_left from sending_jobs j
     where j.user_id = s.user_id and (j.status = 'processing' or (j.accepted_at > now() - interval '24 hours' and not j.simulated));
    select p.monthly_send_limit
      - (select count(*) from sending_jobs j where j.user_id = s.user_id and j.accepted_at >= date_trunc('month', current_date)::date and not j.simulated)
      - (select count(*) from sending_jobs j where j.user_id = s.user_id and j.status = 'processing')
      into monthly_left from profiles p where p.id = s.user_id;
    select p_sender_per_minute - count(*) into sender_rate_left from sending_jobs j join campaigns c4 on c4.id = j.campaign_id
     where c4.sender_id = s.id and j.last_attempt_at > now() - interval '1 minute';

    for c in
      select c5.id, c5.send_rate_per_minute from campaigns c5
       where c5.sender_id = s.id and c5.status in ('queued','sending')
         and exists (select 1 from sending_jobs j where j.campaign_id = c5.id and j.status = 'pending' and j.run_after <= now())
       order by c5.approved_at, c5.id
    loop
      select c.send_rate_per_minute - count(*) into camp_rate_left from sending_jobs j
       where j.campaign_id = c.id and j.last_attempt_at > now() - interval '1 minute';
      n := least(batch_left, quota_left, user_left, monthly_left, sender_rate_left, camp_rate_left);
      continue when n <= 0;
      got := 0;
      for r in
        update sending_jobs j
           set status = 'processing', locked_at = now(), locked_by = p_worker, last_attempt_at = now(), provider_attempted_at = null
         where j.id in (
           select j2.id from sending_jobs j2 where j2.campaign_id = c.id and j2.status = 'pending' and j2.run_after <= now()
            order by j2.run_after, j2.created_at, j2.id limit n for update skip locked
         )
        returning j.*
      loop
        got := got + 1; return next r;
      end loop;
      batch_left := batch_left - got; quota_left := quota_left - got; user_left := user_left - got;
      monthly_left := monthly_left - got; sender_rate_left := sender_rate_left - got;
    end loop;
  end loop;
  return;
end $$;

revoke all on function activate_campaign(uuid, uuid, int) from public, anon, authenticated;
revoke all on function rollback_queueing(uuid, uuid) from public, anon, authenticated;
revoke all on function cancel_campaign(uuid, uuid) from public, anon, authenticated;
revoke all on function claim_send_jobs(text, int, int, int) from public, anon, authenticated;
grant execute on function activate_campaign(uuid, uuid, int) to service_role;
grant execute on function rollback_queueing(uuid, uuid) to service_role;
grant execute on function cancel_campaign(uuid, uuid) to service_role;
grant execute on function claim_send_jobs(text, int, int, int) to service_role;
