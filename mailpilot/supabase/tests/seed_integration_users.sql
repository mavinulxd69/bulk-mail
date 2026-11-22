-- Two fixed test tenants for src/lib/contacts/import.integration.test.ts (run once against a LOCAL or throwaway database; never production).
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','a@test.dev'),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','b@test.dev')
on conflict (id) do nothing;

-- Integration suites exercise plan quotas independently of the onboarding trial.
update profiles set trial_send_limit = null
 where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

-- Test-only helper (used by src/lib/queue/queue.integration.test.ts): creates a contact WITHOUT consent data, like rows that predate
-- Phase 4. The constraint forbids new ones, so it is dropped and re-added NOT VALID around the insert. Service role only.
create or replace function it_legacy_contact(p_user uuid, p_email text, p_name text, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  alter table contacts drop constraint contacts_consent_required;
  insert into contacts (user_id, email, name, fields) values (p_user, p_email, p_name, p_fields);
  alter table contacts add constraint contacts_consent_required check (consent_source is not null and consented_at is not null) not valid;
end $$;
revoke all on function it_legacy_contact(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function it_legacy_contact(uuid, text, text, jsonb) to service_role;
