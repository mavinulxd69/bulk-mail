-- Run in the Supabase SQL editor or psql AFTER migrations. Raises an exception if isolation breaks; rolls back.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','a@test.dev'),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','b@test.dev');
insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000a','secret@a.dev','test',now());
insert into sender_accounts (id, user_id, provider, from_address) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','gmail','a@test.dev');
insert into sender_credentials (sender_id, user_id, encrypted_refresh_token) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','x');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from contacts) <> 0 then raise exception 'FAIL: B can read A contacts'; end if;
  if (select count(*) from sender_accounts) <> 0 then raise exception 'FAIL: B can read A senders'; end if;
  begin perform 1 from sender_credentials; raise exception 'FAIL: tokens readable'; exception when insufficient_privilege then null; end;
  begin insert into contacts (user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-00000000000a','x@x.dev','t',now()); raise exception 'FAIL: B wrote into A';
  exception when insufficient_privilege or check_violation then null; end;
  begin update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000b'; raise exception 'FAIL: self-promote to admin';
  exception when insufficient_privilege then null; end;
  raise notice 'RLS isolation: all checks passed';
end $$;
rollback;
