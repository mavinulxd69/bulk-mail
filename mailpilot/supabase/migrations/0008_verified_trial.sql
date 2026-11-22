-- Passwordless verified-email trials have a lifetime send allowance separate
-- from the existing monthly plan limit. Existing profiles are not retroactively capped.
alter table profiles add column if not exists trial_send_limit int
  check (trial_send_limit is null or trial_send_limit between 1 and 20);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, trial_send_limit) values (new.id, 20);
  return new;
end $$;

create or replace function begin_queueing(p_campaign uuid, p_user uuid, p_requested int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  allowed int;
  trial_limit int;
  accepted_count bigint;
  reserved_count bigint;
  changed int;
begin
  if p_requested is null or p_requested < 1 or p_requested > 5000 then return false; end if;
  select monthly_send_limit, trial_send_limit into allowed, trial_limit
    from profiles where id = p_user for update;
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

  if trial_limit is not null then
    select count(*) into accepted_count from sending_jobs
     where user_id = p_user and accepted_at is not null and not simulated;
    if accepted_count + reserved_count + p_requested > trial_limit then return false; end if;
  end if;

  update campaigns set queue_started_at = now(), approved_at = now(), monthly_send_reserved = p_requested
   where id = p_campaign and user_id = p_user and status = 'awaiting_approval' and queue_started_at is null;
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

revoke all on function begin_queueing(uuid, uuid, int) from public, anon, authenticated;
grant execute on function begin_queueing(uuid, uuid, int) to service_role;
