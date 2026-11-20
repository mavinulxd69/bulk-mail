-- Phase 4: contact tables, cross-tenant isolation and data-integrity constraints. Run after migrations 0001-0003.
-- Raises an exception on any failure; rolls back so it leaves no data behind.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','a@test.dev'),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','b@test.dev');

-- Seed tenant A as the service role would (RLS bypassed here because we are the table owner).
insert into contacts (id, user_id, email, name, fields, consent_source, consented_at) values
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','alex@a.dev','Alex','{"boarding_code":"BD101"}','signup form',now());
insert into contact_lists (id, user_id, name) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','Flight 1');
insert into contact_list_members (list_id, contact_id, user_id) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a');
insert into consent_events (user_id, contact_id, event, source) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','imported','signup form');
insert into suppressions (user_id, email, reason) values ('00000000-0000-0000-0000-00000000000a','gone@a.dev','unsubscribe');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$
declare bc uuid := '00000000-0000-0000-0000-0000000000b1'; bl uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  -- B cannot see any of A's contact data
  if (select count(*) from contacts) <> 0 then raise exception 'FAIL: B reads A contacts'; end if;
  if (select count(*) from contact_lists) <> 0 then raise exception 'FAIL: B reads A lists'; end if;
  if (select count(*) from contact_list_members) <> 0 then raise exception 'FAIL: B reads A list members'; end if;
  if (select count(*) from consent_events) <> 0 then raise exception 'FAIL: B reads A consent events'; end if;
  if (select count(*) from suppressions) <> 0 then raise exception 'FAIL: B reads A suppressions'; end if;

  -- B cannot modify or delete A's rows (RLS filters them out: 0 rows affected)
  update contacts set name = 'pwned' where id = '00000000-0000-0000-0000-0000000000c1';
  if found then raise exception 'FAIL: B updated A contact'; end if;
  delete from contacts where id = '00000000-0000-0000-0000-0000000000c1';
  if found then raise exception 'FAIL: B deleted A contact'; end if;
  delete from contact_lists where id = '00000000-0000-0000-0000-0000000000d1';
  if found then raise exception 'FAIL: B deleted A list'; end if;

  -- B cannot write rows owned by A
  begin insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000a','x@x.dev','t',now()); raise exception 'FAIL: B inserted as A';
  exception when insufficient_privilege or check_violation then null; end;

  -- B's own data works, and B can't attach B's contact to A's list (composite FK + RLS)
  insert into contacts (id, user_id, email, consent_source, consented_at) values (bc,'00000000-0000-0000-0000-00000000000b','b1@b.dev','csv',now());
  insert into contact_lists (id, user_id, name) values (bl,'00000000-0000-0000-0000-00000000000b','B list');
  begin insert into contact_list_members (list_id, contact_id, user_id) values ('00000000-0000-0000-0000-0000000000d1', bc, '00000000-0000-0000-0000-00000000000b'); raise exception 'FAIL: B joined A list';
  exception when foreign_key_violation then null; end;
  begin insert into contact_list_members (list_id, contact_id, user_id) values (bl, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b'); raise exception 'FAIL: B added A contact to own list';
  exception when foreign_key_violation then null; end;
  insert into contact_list_members (list_id, contact_id, user_id) values (bl, bc, '00000000-0000-0000-0000-00000000000b');

  -- Same address under two tenants is fine; same address twice for one tenant is not
  insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000b','alex@a.dev','csv',now());
  begin insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000b','alex@a.dev','csv',now()); raise exception 'FAIL: duplicate address allowed';
  exception when unique_violation then null; end;

  -- Integrity constraints
  begin insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000b','Mixed@Case.dev','csv',now()); raise exception 'FAIL: non-normalised email';
  exception when check_violation then null; end;
  begin insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000b', E'a@b.dev\nbcc:x@y.dev','csv',now()); raise exception 'FAIL: control chars in email';
  exception when check_violation then null; end;
  begin insert into contacts (user_id, email) values ('00000000-0000-0000-0000-00000000000b','noconsent@b.dev'); raise exception 'FAIL: contact without consent';
  exception when check_violation then null; end;
  begin insert into contacts (user_id, email, fields, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000b','arr@b.dev','[1]','csv',now()); raise exception 'FAIL: fields not an object';
  exception when check_violation then null; end;
  begin insert into contact_lists (user_id, name) values ('00000000-0000-0000-0000-00000000000b','B list'); raise exception 'FAIL: duplicate list name';
  exception when unique_violation then null; end;
  begin insert into consent_events (user_id, contact_id, event) values ('00000000-0000-0000-0000-00000000000b', bc, 'bogus'); raise exception 'FAIL: bad consent event';
  exception when check_violation then null; end;

  -- updated_at is maintained by the trigger even if a client tries to set it (now() is frozen inside one transaction)
  update contacts set name = 'B1', updated_at = '2000-01-01' where id = bc;
  if (select updated_at < now() - interval '1 minute' from contacts where id = bc) then raise exception 'FAIL: updated_at not maintained'; end if;

  raise notice 'Phase 4 contacts: all checks passed';
end $$;

-- Per-user cap backstop (reset role to insert in bulk as table owner)
reset role;
do $$ begin
  begin
    insert into contacts (user_id, email, consent_source, consented_at)
      select '00000000-0000-0000-0000-00000000000a', 'bulk' || g || '@a.dev', 'test', now() from generate_series(1, 10001) g;
    raise exception 'FAIL: contact cap not enforced';
  exception when check_violation then null; end;
  insert into contacts (user_id, email, consent_source, consented_at)
    select '00000000-0000-0000-0000-00000000000a', 'ok' || g || '@a.dev', 'test', now() from generate_series(1, 9000) g;
  raise notice 'Contact cap: enforced at 10000';
end $$;
rollback;
