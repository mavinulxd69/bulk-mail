-- MailPilot core schema. Every tenant row carries user_id; cross-table links are composite (id, user_id)
-- so a row can never point at another tenant's data, even through a bug.
create extension if not exists pgcrypto;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, is_admin boolean not null default false,
  onboarded_at timestamptz, created_at timestamptz not null default now());

create table sender_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('gmail','resend')),
  display_name text, from_address text not null, reply_to text,
  status text not null default 'pending' check (status in ('pending','connected','needs_reauth','disconnected')),
  daily_quota int not null default 100, created_at timestamptz not null default now(),
  unique (id, user_id));
-- OAuth tokens live apart from sender_accounts; RLS on, NO policies => unreadable from the browser. Service role only.
create table sender_credentials (
  sender_id uuid primary key, user_id uuid not null,
  encrypted_refresh_token text, encrypted_access_token text, expires_at timestamptz,
  foreign key (sender_id, user_id) references sender_accounts(id, user_id) on delete cascade);

create table sender_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  domain text not null, resend_domain_id text,
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  dns_records jsonb, created_at timestamptz not null default now(), unique (user_id, domain));

create table contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  email text not null, name text, fields jsonb not null default '{}',
  consent_source text, consented_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id), unique (user_id, email));
create table contact_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null, created_at timestamptz not null default now(), unique (id, user_id));
create table contact_list_members (
  list_id uuid not null, contact_id uuid not null, user_id uuid not null,
  primary key (list_id, contact_id),
  foreign key (list_id, user_id) references contact_lists(id, user_id) on delete cascade,
  foreign key (contact_id, user_id) references contacts(id, user_id) on delete cascade);

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null, subject text not null, html_body text, text_body text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null, sender_id uuid, subject text not null, html_body text, text_body text,
  is_marketing boolean not null default false,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','queued','sending','completed','partially_failed','failed','cancelled')),
  approved_at timestamptz, created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (sender_id, user_id) references sender_accounts(id, user_id));
create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, campaign_id uuid not null, contact_id uuid not null,
  rendered_subject text, rendered_html text, rendered_text text,
  unique (id, user_id), unique (campaign_id, contact_id),
  foreign key (campaign_id, user_id) references campaigns(id, user_id) on delete cascade,
  foreign key (contact_id, user_id) references contacts(id, user_id) on delete cascade);

create table sending_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, recipient_id uuid not null, campaign_id uuid not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','accepted','delivered','bounced','failed','suppressed')),
  attempts int not null default 0, max_attempts int not null default 3,
  run_after timestamptz not null default now(), locked_at timestamptz,
  provider_message_id text, last_error text, created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (recipient_id, user_id) references campaign_recipients(id, user_id) on delete cascade);
create table sending_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, job_id uuid not null, type text not null, provider_payload jsonb,
  created_at timestamptz not null default now(),
  foreign key (job_id, user_id) references sending_jobs(id, user_id) on delete cascade);

create table suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  email text not null, reason text not null check (reason in ('unsubscribe','bounce','complaint','manual')),
  created_at timestamptz not null default now(), unique (user_id, email));
create table consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, contact_id uuid not null, event text not null, source text,
  created_at timestamptz not null default now(),
  foreign key (contact_id, user_id) references contacts(id, user_id) on delete cascade);
create table usage_counters (
  user_id uuid not null references profiles(id) on delete cascade,
  day date not null default current_date, sent int not null default 0,
  primary key (user_id, day));
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  action text not null, detail jsonb, created_at timestamptz not null default now());

create index on sender_accounts (user_id);
create index on contacts (user_id, email);
create index on contact_list_members (user_id, contact_id);
create index on campaigns (user_id, status, created_at desc);
create index on campaign_recipients (campaign_id);
create index on sending_jobs (status, run_after) where status in ('pending','processing');
create index on sending_jobs (user_id, campaign_id, status);
create index on sending_events (job_id, created_at);
create index on audit_logs (user_id, created_at desc);

-- New auth user => profile
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
