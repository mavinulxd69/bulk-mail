-- Phase 7: account plans, abuse telemetry, and account administration.
alter table profiles add column if not exists plan text not null default 'starter'
  check (plan in ('starter','growth','scale'));
alter table profiles add column if not exists monthly_send_limit int not null default 100;

create table if not exists abuse_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}',
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists abuse_events_created_idx on abuse_events(created_at desc);
create index if not exists abuse_events_kind_idx on abuse_events(kind, created_at desc);
alter table abuse_events enable row level security;
revoke all on abuse_events from anon, authenticated;

create or replace function abuse_summary(p_since timestamptz default now() - interval '24 hours')
returns table(kind text, events bigint) language sql security definer set search_path = public as $$
  select a.kind, count(*) from abuse_events a where a.created_at >= p_since group by a.kind order by events desc;
$$;
revoke all on function abuse_summary(timestamptz) from public, anon, authenticated;

-- Account deletion is performed by a server-only Supabase Admin API call.
-- Deleting auth.users cascades to profiles and every tenant-owned row.

create or replace function begin_queueing(p_campaign uuid, p_user uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare n int; used bigint; allowed int;
begin
  select monthly_send_limit into allowed from profiles where id = p_user;
  select coalesce(sum(sent), 0) into used from usage_counters
   where user_id = p_user and day >= date_trunc('month', current_date)::date;
  if allowed is not null and used >= allowed then return false; end if;
  update campaigns set queue_started_at = now(), approved_at = now()
   where id = p_campaign and user_id = p_user and status = 'awaiting_approval' and queue_started_at is null;
  get diagnostics n = row_count; return n = 1;
end $$;
