-- Phase 4: contacts hardening. Safe on a fresh Phase-3 database; existing rows are not rewritten.

alter table contacts add column if not exists updated_at timestamptz not null default now();

-- Addresses are stored normalised so the (user_id, email) unique index really de-duplicates, and can never carry header-injection characters.
alter table contacts add constraint contacts_email_normalized
  check (email = lower(btrim(email)) and length(email) between 3 and 254 and email !~ '[[:space:][:cntrl:]]');
alter table contacts add constraint contacts_name_len check (name is null or length(name) <= 200);
alter table contacts add constraint contacts_fields_shape check (jsonb_typeof(fields) = 'object' and pg_column_size(fields) <= 16384);
-- New contacts must record where and when consent was given. NOT VALID: rows created before this migration are not re-checked.
alter table contacts add constraint contacts_consent_required check (consent_source is not null and consented_at is not null) not valid;

alter table contact_lists add constraint contact_lists_name_len check (length(btrim(name)) between 1 and 100);
alter table contact_lists add constraint contact_lists_name_unique unique (user_id, name);
alter table suppressions add constraint suppressions_email_normalized check (email = lower(btrim(email)));
alter table consent_events add constraint consent_events_event check (event in ('imported','created','updated','revoked'));

create index if not exists contact_list_members_list_idx on contact_list_members (list_id);
create index if not exists contacts_user_created_idx on contacts (user_id, created_at desc);
create index if not exists consent_events_contact_idx on consent_events (contact_id, created_at desc);

create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger contacts_updated_at before update on contacts for each row execute function set_updated_at();

-- Backstop for the per-user contact cap (the app checks first). Statement-level, so a 5,000-row import costs one count.
-- Keep 10000 in sync with MAX_CONTACTS_PER_USER in src/lib/limits.ts.
create function enforce_contact_cap() returns trigger language plpgsql as $$
begin
  if exists (select 1 from contacts c where c.user_id in (select distinct user_id from inserted) group by c.user_id having count(*) > 10000) then
    raise exception 'contact limit reached' using errcode = '23514';
  end if;
  return null;
end $$;
create trigger contacts_cap after insert on contacts referencing new table as inserted for each statement execute function enforce_contact_cap();
