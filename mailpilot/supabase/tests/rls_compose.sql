-- Phase 5 checks. Run AFTER migrations 0001-0004. Raises on any failure; rolls back.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','a@test.dev'),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','b@test.dev');
insert into contact_lists (id, user_id, name) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','List A');
insert into contacts (id, user_id, email, consent_source, consented_at) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','x@a.dev','test',now());
insert into campaigns (id, user_id, name, subject, status) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','Sent one','s','completed');

-- ===== User A: may manage DRAFTS only =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$ declare n int; begin
  insert into campaigns (id, user_id, name, subject, audience, audience_list_id) values ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-00000000000a','Draft','s','list','00000000-0000-0000-0000-0000000000c1');
  update campaigns set subject = 'edited' where id = '00000000-0000-0000-0000-0000000000e2';
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: owner cannot edit own draft'; end if;

  begin insert into campaigns (user_id, name, subject, status) values ('00000000-0000-0000-0000-00000000000a','x','s','queued'); raise exception 'FAIL: user created a queued campaign';
  exception when insufficient_privilege then null; end;
  begin update campaigns set status = 'queued' where id = '00000000-0000-0000-0000-0000000000e2'; raise exception 'FAIL: user queued their own draft';
  exception when insufficient_privilege then null; end;
  begin update campaigns set approved_at = now() where id = '00000000-0000-0000-0000-0000000000e2'; raise exception 'FAIL: user self-approved';
  exception when insufficient_privilege then null; end;

  update campaigns set subject = 'hack' where id = '00000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: user edited a non-draft campaign'; end if;
  delete from campaigns where id = '00000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: user deleted a non-draft campaign'; end if;

  begin insert into campaigns (user_id, name, subject, audience, audience_list_id) values ('00000000-0000-0000-0000-00000000000a','x','s','all','00000000-0000-0000-0000-0000000000c1'); raise exception 'FAIL: audience shape not enforced';
  exception when check_violation then null; end;
  begin insert into campaigns (user_id, name, subject, audience, audience_list_id) values ('00000000-0000-0000-0000-00000000000a','x','s','list','00000000-0000-0000-0000-0000000000ff'); raise exception 'FAIL: list FK not enforced';
  exception when foreign_key_violation then null; end;

  begin insert into campaign_recipients (user_id, campaign_id, contact_id) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d1'); raise exception 'FAIL: user wrote campaign_recipients';
  exception when insufficient_privilege then null; end;
  begin perform claim_usage('00000000-0000-0000-0000-00000000000a','ai_drafts',1); raise exception 'FAIL: user can call claim_usage';
  exception when insufficient_privilege then null; end;

  insert into email_templates (user_id, name, subject) values ('00000000-0000-0000-0000-00000000000a','T','s');
  begin insert into email_templates (user_id, name, subject) values ('00000000-0000-0000-0000-00000000000a','T','s2'); raise exception 'FAIL: duplicate template name allowed';
  exception when unique_violation then null; end;
  raise notice 'RLS compose (user A): ok';
end $$;

-- ===== User B: sees and touches nothing of A's =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$ declare n int; begin
  if (select count(*) from campaigns) <> 0 then raise exception 'FAIL: B can read A campaigns'; end if;
  if (select count(*) from email_templates) <> 0 then raise exception 'FAIL: B can read A templates'; end if;
  update campaigns set subject = 'x' where id = '00000000-0000-0000-0000-0000000000e2';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: B edited A draft'; end if;
  begin insert into campaigns (user_id, name, subject, audience, audience_list_id) values ('00000000-0000-0000-0000-00000000000b','x','s','list','00000000-0000-0000-0000-0000000000c1'); raise exception 'FAIL: B pointed a campaign at A list';
  exception when foreign_key_violation then null; end;
  raise notice 'RLS compose (user B): ok';
end $$;

-- ===== Server side =====
reset role;
do $$ begin
  if has_function_privilege('authenticated', 'claim_usage(uuid,text,int)', 'execute') then raise exception 'FAIL: authenticated may execute claim_usage'; end if;
  if has_function_privilege('anon', 'claim_usage(uuid,text,int)', 'execute') then raise exception 'FAIL: anon may execute claim_usage'; end if;
  if not has_function_privilege('service_role', 'claim_usage(uuid,text,int)', 'execute') then raise exception 'FAIL: service_role cannot execute claim_usage'; end if;
  if not (claim_usage('00000000-0000-0000-0000-00000000000a','test_sends',2) and claim_usage('00000000-0000-0000-0000-00000000000a','test_sends',2)) then raise exception 'FAIL: claim_usage refused within limit'; end if;
  if claim_usage('00000000-0000-0000-0000-00000000000a','test_sends',2) then raise exception 'FAIL: claim_usage allowed past limit'; end if;
  if not claim_usage('00000000-0000-0000-0000-00000000000a','ai_drafts',2) then raise exception 'FAIL: counters are not independent'; end if;

  -- Deleting a list must NOT widen the draft to "all contacts": audience stays 'list', only the list id is cleared.
  delete from contact_lists where id = '00000000-0000-0000-0000-0000000000c1';
  if not exists (select 1 from campaigns where id = '00000000-0000-0000-0000-0000000000e2' and audience = 'list' and audience_list_id is null and user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: deleting a list changed the draft audience'; end if;
  raise notice 'RLS compose: all checks passed';
end $$;
rollback;
