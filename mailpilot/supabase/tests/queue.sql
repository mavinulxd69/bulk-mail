-- Queue and security checks: claiming, quotas, rates, pauses, crash recovery, campaign status, approval steps, unsubscribe,
-- webhook application, contact erasure and privileges. Run AFTER migrations 0001-0007. Raises on any failure; rolls back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','a@test.dev'),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','b@test.dev'),
 ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','c@test.dev');
insert into sender_accounts (id, user_id, provider, from_address, status, daily_quota) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','gmail','a1@test.dev','connected',100),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000000a','resend','a2@test.dev','connected',100),
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','gmail','b1@test.dev','connected',100),
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000c','gmail','c1@test.dev','connected',100);

create function pg_temp.camp(p_user uuid, p_sender uuid, p_status text default 'queued', p_rate int default 30) returns uuid language plpgsql as $$
declare cid uuid := gen_random_uuid();
begin
  insert into campaigns (id, user_id, name, sender_id, subject, html_body, status, send_rate_per_minute, approved_at)
  values (cid, p_user, 'c', p_sender, 's', '<p>x</p>', p_status, p_rate, case when p_status = 'draft' then null else now() end);
  return cid;
end $$;
create function pg_temp.jobs(p_camp uuid, p_n int, p_status text default 'pending', p_provider text default 'gmail', p_prefix text default 'r') returns uuid[] language plpgsql as $$
declare res uuid[] := '{}'; rid uuid; jid uuid; uid uuid; i int;
begin
  select user_id into uid from campaigns where id = p_camp;
  for i in 1..p_n loop
    rid := gen_random_uuid(); jid := gen_random_uuid();
    insert into campaign_recipients (id, user_id, campaign_id, email, rendered_subject, rendered_html, rendered_text, unsubscribe_token)
      values (rid, uid, p_camp, p_prefix || i || '@x.dev', 's', '<p>x</p>', 'x', md5(random()::text || clock_timestamp()::text || i));
    insert into sending_jobs (id, user_id, recipient_id, campaign_id, idempotency_key, status, provider) values (jid, uid, rid, p_camp, 'mp:' || jid, p_status, p_provider);
    res := res || jid;
  end loop;
  return res;
end $$;
create function pg_temp.reset() returns void language sql as $$
  delete from campaigns;  -- cascades to recipients, jobs, events
  update sender_accounts set status = 'connected', paused_until = null, pause_count = 0, pause_reason = null, daily_quota = 100;
  update profiles set monthly_send_limit = 100;
$$;
create function pg_temp.claimed(p_batch int default 100, p_rate int default 1000, p_user_day int default 100000) returns int language sql as $$
  select count(*)::int from claim_send_jobs('w-test', p_batch, p_rate, p_user_day);
$$;
create function pg_temp.assert_eq(p_what text, p_got anyelement, p_want anyelement) returns void language plpgsql as $$
begin if p_got is distinct from p_want then raise exception 'FAIL: % (got %, want %)', p_what, p_got, p_want; end if; end $$;

-- ===================== claim: eligibility =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; r uuid; x uuid; n int; row sending_jobs;
begin
  perform pg_temp.reset();
  q := pg_temp.camp(a, s1, 'queued'); perform pg_temp.jobs(q, 5);
  r := pg_temp.camp(a, s1, 'awaiting_approval'); perform pg_temp.jobs(r, 3);
  x := pg_temp.camp(a, s1, 'cancelled'); perform pg_temp.jobs(x, 3);
  perform pg_temp.assert_eq('only queued/sending campaigns are claimed', pg_temp.claimed(), 5);
  select count(*) into n from sending_jobs where campaign_id = q and status = 'processing' and locked_by = 'w-test' and last_attempt_at is not null and provider_attempted_at is null;
  perform pg_temp.assert_eq('claimed jobs are marked processing with owner + attempt time', n, 5);
  perform pg_temp.assert_eq('a second claim returns nothing (no double hand-out)', pg_temp.claimed(), 0);
  select count(*) into n from sending_jobs where campaign_id in (r, x) and status = 'pending'; perform pg_temp.assert_eq('awaiting_approval/cancelled jobs untouched', n, 6);

  -- future run_after is not due
  perform pg_temp.reset(); q := pg_temp.camp(a, s1); perform pg_temp.jobs(q, 3);
  update sending_jobs set run_after = now() + interval '1 hour' where id = (select id from sending_jobs where campaign_id = q limit 1);
  perform pg_temp.assert_eq('run_after in the future is not claimed', pg_temp.claimed(), 2);

  -- not-connected sender
  perform pg_temp.reset(); q := pg_temp.camp(a, s1); perform pg_temp.jobs(q, 2);
  update sender_accounts set status = 'needs_reauth' where id = s1;
  perform pg_temp.assert_eq('needs_reauth sender is not claimed', pg_temp.claimed(), 0);
  update sender_accounts set status = 'disconnected' where id = s1;
  perform pg_temp.assert_eq('disconnected sender is not claimed', pg_temp.claimed(), 0);
  update sender_accounts set status = 'connected' where id = s1;
  perform pg_temp.assert_eq('reconnected sender resumes', pg_temp.claimed(), 2);
  raise notice 'queue: eligibility ok';
end $$;

-- ===================== claim: rates and quotas =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; c uuid := '00000000-0000-0000-0000-00000000000c'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; sc uuid := '00000000-0000-0000-0000-0000000000c1'; q uuid; q2 uuid; n int;
begin
  -- campaign rate
  perform pg_temp.reset(); q := pg_temp.camp(a, s1, 'queued', 2); perform pg_temp.jobs(q, 5);
  perform pg_temp.assert_eq('campaign rate 2/min caps the claim', pg_temp.claimed(), 2);
  perform pg_temp.assert_eq('rate window is still full', pg_temp.claimed(), 0);
  update sending_jobs set last_attempt_at = now() - interval '2 minutes' where campaign_id = q and status = 'processing';
  perform pg_temp.assert_eq('after the window passes, the next 2 go', pg_temp.claimed(), 2);

  -- sender per-minute cap is shared by campaigns
  perform pg_temp.reset(); q := pg_temp.camp(a, s1, 'queued', 100); q2 := pg_temp.camp(a, s1, 'queued', 100); perform pg_temp.jobs(q, 5); perform pg_temp.jobs(q2, 5);
  perform pg_temp.assert_eq('sender per-minute cap spans campaigns', pg_temp.claimed(100, 4), 4);

  -- batch size
  perform pg_temp.reset(); q := pg_temp.camp(a, s1, 'queued', 100); perform pg_temp.jobs(q, 8);
  perform pg_temp.assert_eq('batch size caps the claim', pg_temp.claimed(3), 3);

  -- sender daily quota (rolling 24h; processing jobs count as reserved)
  perform pg_temp.reset(); update sender_accounts set daily_quota = 3 where id = s1;
  q := pg_temp.camp(a, s1, 'queued', 120); perform pg_temp.jobs(q, 5);
  perform pg_temp.assert_eq('sender quota 3 caps the claim', pg_temp.claimed(), 3);
  update sending_jobs set status = 'accepted', accepted_at = now() where campaign_id = q and status = 'processing';
  perform pg_temp.assert_eq('quota stays exhausted while accepted jobs are inside 24h', pg_temp.claimed(), 0);
  update sending_jobs set accepted_at = now() - interval '25 hours' where campaign_id = q and status = 'accepted';
  perform pg_temp.assert_eq('quota frees up after 24h', pg_temp.claimed(), 2);

  -- per-user daily cap
  perform pg_temp.reset(); q := pg_temp.camp(c, sc, 'queued', 120); perform pg_temp.jobs(q, 5);
  perform pg_temp.assert_eq('user daily cap 2 caps the claim', pg_temp.claimed(100, 1000, 2), 2);
  perform pg_temp.assert_eq('user cap exhausted', pg_temp.claimed(100, 1000, 2), 0);
  raise notice 'queue: rates and quotas ok';
end $$;

-- ===================== provider-quota pause =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; t1 timestamptz; t2 timestamptz; t3 timestamptz; n int;
begin
  perform pg_temp.reset(); q := pg_temp.camp(a, s1); perform pg_temp.jobs(q, 3);
  t1 := pause_sender(s1, 'quota');
  if t1 < now() + interval '29 minutes' or t1 > now() + interval '31 minutes' then raise exception 'FAIL: first pause should be ~30 min, got %', t1; end if;
  t2 := pause_sender(s1, 'quota'); perform pg_temp.assert_eq('a second pause while paused does not escalate', t2, t1);
  select pause_count into n from sender_accounts where id = s1; perform pg_temp.assert_eq('pause_count stays 1', n, 1);
  perform pg_temp.assert_eq('paused sender is not claimed', pg_temp.claimed(), 0);
  update sender_accounts set paused_until = now() - interval '1 second' where id = s1;
  t3 := pause_sender(s1, 'quota');
  if t3 < now() + interval '59 minutes' or t3 > now() + interval '61 minutes' then raise exception 'FAIL: second pause should double to ~60 min, got %', t3; end if;
  update sender_accounts set paused_until = now() - interval '1 second', pause_count = 20 where id = s1;
  t3 := pause_sender(s1, 'quota');
  if t3 > now() + interval '1441 minutes' then raise exception 'FAIL: pause must cap at 24h, got %', t3; end if;
  update sender_accounts set paused_until = now() - interval '1 second' where id = s1;
  perform pg_temp.assert_eq('after the pause the sender is tried again', pg_temp.claimed(), 3);
  raise notice 'queue: pause ok';
end $$;

-- ===================== crash recovery =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; s2 uuid := '00000000-0000-0000-0000-0000000000a2'; g uuid; rs uuid; ids uuid[]; j sending_jobs; n int;
begin
  perform pg_temp.reset(); g := pg_temp.camp(a, s1, 'sending'); rs := pg_temp.camp(a, s2, 'sending');
  -- (a) gmail, crashed before reaching the provider
  ids := pg_temp.jobs(g, 1, 'processing', 'gmail', 'ga'); update sending_jobs set locked_at = now() - interval '10 minutes', locked_by = 'dead' where id = ids[1];
  select * into j from sending_jobs where id = ids[1];
  -- (b) gmail, crashed AFTER the provider call started
  ids := pg_temp.jobs(g, 1, 'processing', 'gmail', 'gb'); update sending_jobs set locked_at = now() - interval '10 minutes', provider_attempted_at = now() - interval '9 minutes' where id = ids[1];
  -- (c) resend, crashed after the call started
  ids := pg_temp.jobs(rs, 1, 'processing', 'resend', 'rc'); update sending_jobs set locked_at = now() - interval '10 minutes', provider_attempted_at = now() - interval '9 minutes' where id = ids[1];
  -- (d) resend, crashed after the call started, on its last attempt
  ids := pg_temp.jobs(rs, 1, 'processing', 'resend', 'rd'); update sending_jobs set locked_at = now() - interval '10 minutes', provider_attempted_at = now() - interval '9 minutes', attempts = 2 where id = ids[1];
  -- (e) healthy in-flight job
  perform pg_temp.jobs(rs, 1, 'processing', 'resend', 're'); update sending_jobs set locked_at = now() where recipient_id in (select id from campaign_recipients where email = 're1@x.dev');

  perform pg_temp.assert_eq('four expired leases handled', requeue_expired_jobs(120), 4);
  select status, attempts into j.status, j.attempts from sending_jobs where recipient_id = (select id from campaign_recipients where email = 'ga1@x.dev');
  perform pg_temp.assert_eq('(a) not attempted -> pending', j.status, 'pending'); perform pg_temp.assert_eq('(a) attempt not consumed', j.attempts, 0);
  select status, last_error_kind into j.status, j.last_error_kind from sending_jobs where recipient_id = (select id from campaign_recipients where email = 'gb1@x.dev');
  perform pg_temp.assert_eq('(b) gmail attempted -> failed, never retried (could duplicate)', j.status, 'failed'); perform pg_temp.assert_eq('(b) kind', j.last_error_kind, 'unknown_outcome');
  select status, attempts into j.status, j.attempts from sending_jobs where recipient_id = (select id from campaign_recipients where email = 'rc1@x.dev');
  perform pg_temp.assert_eq('(c) resend attempted -> pending (idempotency key makes retry safe)', j.status, 'pending'); perform pg_temp.assert_eq('(c) attempt consumed', j.attempts, 1);
  select status, last_error_kind into j.status, j.last_error_kind from sending_jobs where recipient_id = (select id from campaign_recipients where email = 'rd1@x.dev');
  perform pg_temp.assert_eq('(d) resend out of attempts -> failed', j.status, 'failed');
  select status into j.status from sending_jobs where recipient_id = (select id from campaign_recipients where email = 're1@x.dev');
  perform pg_temp.assert_eq('(e) live lease untouched', j.status, 'processing');
  select count(*) into n from sending_events where type = 'lease_expired'; perform pg_temp.assert_eq('lease_expired events recorded', n, 4);
  raise notice 'queue: crash recovery ok';
end $$;

-- ===================== campaign status is derived from jobs =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; ids uuid[]; st text;
begin
  perform pg_temp.reset();
  q := pg_temp.camp(a, s1, 'queued'); ids := pg_temp.jobs(q, 3);
  perform pg_temp.assert_eq('untouched jobs stay queued', refresh_campaign_status(q), 'queued');
  update sending_jobs set status = 'processing', last_attempt_at = now() where id = ids[1];
  perform pg_temp.assert_eq('work started -> sending', refresh_campaign_status(q), 'sending');
  update sending_jobs set status = 'accepted', accepted_at = now() where id = ids[1];
  update sending_jobs set status = 'accepted', accepted_at = now() where id in (ids[2], ids[3]);
  perform pg_temp.assert_eq('all accepted -> completed', refresh_campaign_status(q), 'completed');
  if (select completed_at from campaigns where id = q) is null then raise exception 'FAIL: completed_at not set'; end if;
  update sending_jobs set status = 'bounced' where id = ids[3];
  perform pg_temp.assert_eq('a bounce after completion -> partially_failed', refresh_campaign_status(q), 'partially_failed');
  update sending_jobs set status = 'failed' where id in (ids[1], ids[2]);
  perform pg_temp.assert_eq('nothing accepted -> failed', refresh_campaign_status(q), 'failed');
  update sending_jobs set status = 'suppressed' where campaign_id = q;
  perform pg_temp.assert_eq('only suppressed -> completed', refresh_campaign_status(q), 'completed');
  update sending_jobs set status = 'pending' where id = ids[1];
  perform pg_temp.assert_eq('new work after completion -> sending', refresh_campaign_status(q), 'sending');
  if (select completed_at from campaigns where id = q) is not null then raise exception 'FAIL: completed_at not cleared'; end if;

  q := pg_temp.camp(a, s1, 'cancelled'); perform pg_temp.jobs(q, 1);
  if refresh_campaign_status(q) is not null then raise exception 'FAIL: cancelled campaign was touched'; end if;
  q := pg_temp.camp(a, s1, 'draft');
  if refresh_campaign_status(q) is not null then raise exception 'FAIL: draft campaign was touched'; end if;
  raise notice 'queue: campaign status ok';
end $$;

-- ===================== cancel =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; n int;
begin
  perform pg_temp.reset(); q := pg_temp.camp(a, s1, 'sending');
  perform pg_temp.jobs(q, 3, 'pending', 'gmail', 'p'); perform pg_temp.jobs(q, 1, 'processing', 'gmail', 'q'); perform pg_temp.jobs(q, 1, 'accepted', 'gmail', 'r');
  if cancel_campaign(q, b) is not null then raise exception 'FAIL: another user cancelled my campaign'; end if;
  perform pg_temp.assert_eq('cancel returns the number of cancelled messages', cancel_campaign(q, a), 3);
  select count(*) into n from sending_jobs where campaign_id = q and status = 'cancelled'; perform pg_temp.assert_eq('pending -> cancelled', n, 3);
  select count(*) into n from sending_jobs where campaign_id = q and status in ('processing','accepted'); perform pg_temp.assert_eq('in-flight and accepted jobs untouched', n, 2);
  perform pg_temp.assert_eq('campaign is cancelled', (select status from campaigns where id = q), 'cancelled');
  if cancel_campaign(q, a) is not null then raise exception 'FAIL: cancelled twice'; end if;
  perform pg_temp.assert_eq('cancelled jobs are never claimed', pg_temp.claimed(), 0);
  raise notice 'queue: cancel ok';
end $$;

-- ===================== approval steps =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; n int;
begin
  perform pg_temp.reset(); q := pg_temp.camp(a, s1, 'awaiting_approval');
  if begin_queueing(q, b, 2) then raise exception 'FAIL: other user began queueing'; end if;
  if not begin_queueing(q, a, 2) then raise exception 'FAIL: begin_queueing'; end if;
  if begin_queueing(q, a, 2) then raise exception 'FAIL: double approval (double click) was accepted'; end if;
  perform pg_temp.jobs(q, 2);
  if activate_campaign(q, a, 3) then raise exception 'FAIL: activated with the wrong job count'; end if;
  perform pg_temp.assert_eq('half-written campaign is not claimable', pg_temp.claimed(), 0);
  perform rollback_queueing(q, a);
  select count(*) into n from campaign_recipients where campaign_id = q; perform pg_temp.assert_eq('rollback removes recipients and jobs', n, 0);
  select count(*) into n from sending_jobs where campaign_id = q; perform pg_temp.assert_eq('rollback removes jobs', n, 0);
  if (select approved_at from campaigns where id = q) is not null or (select queue_started_at from campaigns where id = q) is not null then raise exception 'FAIL: rollback left approval stamps'; end if;
  perform pg_temp.assert_eq('campaign is reviewable again', (select status from campaigns where id = q), 'awaiting_approval');
  perform begin_queueing(q, a, 2); perform pg_temp.jobs(q, 2);
  if not activate_campaign(q, a, 2) then raise exception 'FAIL: activate with the right count'; end if;
  perform pg_temp.assert_eq('queued after activation', (select status from campaigns where id = q), 'queued');
  if begin_queueing(q, a, 2) then raise exception 'FAIL: re-approval of a queued campaign'; end if;
  perform rollback_queueing(q, a);
  select count(*) into n from sending_jobs where campaign_id = q; perform pg_temp.assert_eq('rollback never touches a queued campaign', n, 2);
  perform pg_temp.assert_eq('queued campaign is claimable', pg_temp.claimed(), 2);

  -- stale approval recovery
  q := pg_temp.camp(a, s1, 'awaiting_approval'); perform begin_queueing(q, a, 2); perform pg_temp.jobs(q, 2);
  perform pg_temp.assert_eq('a fresh approval is not stale', revert_stale_queueing(15), 0);
  update campaigns set queue_started_at = now() - interval '1 hour' where id = q;
  perform pg_temp.assert_eq('a crashed approval is reverted', revert_stale_queueing(15), 1);
  select count(*) into n from sending_jobs where campaign_id = q; perform pg_temp.assert_eq('stale approval left no jobs', n, 0);
  raise notice 'queue: approval steps ok';
end $$;

-- ===================== monthly capacity reservations =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q1 uuid; q2 uuid;
begin
  perform pg_temp.reset();
  update profiles set monthly_send_limit = 3 where id = a;
  q1 := pg_temp.camp(a, s1, 'awaiting_approval');
  q2 := pg_temp.camp(a, s1, 'awaiting_approval');
  if begin_queueing(q1, a, 4) then raise exception 'FAIL: approval exceeded monthly plan limit'; end if;
  if not begin_queueing(q1, a, 3) then raise exception 'FAIL: could not reserve remaining monthly plan capacity'; end if;
  perform pg_temp.jobs(q1, 2);
  if begin_queueing(q2, a, 1) then raise exception 'FAIL: duplicate reservation counted less than reserved amount'; end if;
  if not activate_campaign(q1, a, 2) then raise exception 'FAIL: activation'; end if;
  if not begin_queueing(q2, a, 1) then raise exception 'FAIL: open jobs were not counted after activation'; end if;
  raise notice 'queue: monthly capacity reservation ok';
end $$;

-- ===================== unsubscribe =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; sb uuid := '00000000-0000-0000-0000-0000000000b1';
  q1 uuid; q2 uuid; qb uuid; contact uuid := gen_random_uuid(); rec uuid; n int; ret text; tok text;
begin
  perform pg_temp.reset();
  insert into contacts (id, user_id, email, consent_source, consented_at) values (contact, a, 'r1@x.dev', 't', now());
  q1 := pg_temp.camp(a, s1, 'sending'); q2 := pg_temp.camp(a, s1, 'queued'); qb := pg_temp.camp(b, sb, 'queued');
  perform pg_temp.jobs(q1, 2, 'pending', 'gmail', 'r');   -- r1@x.dev, r2@x.dev
  perform pg_temp.jobs(q1, 1, 'accepted', 'gmail', 'old'); -- an old accepted one, same campaign
  perform pg_temp.jobs(q2, 1, 'pending', 'gmail', 'r');   -- r1@x.dev again in another campaign
  perform pg_temp.jobs(qb, 1, 'pending', 'gmail', 'r');   -- other tenant, SAME address
  select unsubscribe_token into tok from campaign_recipients where campaign_id = q1 and email = 'r1@x.dev';
  if apply_unsubscribe('not-a-token') is not null then raise exception 'FAIL: bad token accepted'; end if;
  ret := apply_unsubscribe(tok); perform pg_temp.assert_eq('returns the address', ret, 'r1@x.dev');
  perform pg_temp.assert_eq('idempotent', apply_unsubscribe(tok), 'r1@x.dev');
  select count(*) into n from suppressions where user_id = a and email = 'r1@x.dev' and reason = 'unsubscribe'; perform pg_temp.assert_eq('suppression recorded once', n, 1);
  select count(*) into n from suppressions where user_id = b; perform pg_temp.assert_eq('other tenant is not suppressed', n, 0);
  select count(*) into n from sending_jobs j join campaign_recipients r on r.id = j.recipient_id where j.user_id = a and r.email = 'r1@x.dev' and j.status = 'suppressed';
  perform pg_temp.assert_eq('pending mail to that address is stopped in EVERY campaign of that sender', n, 2);
  select count(*) into n from sending_jobs j join campaign_recipients r on r.id = j.recipient_id where j.user_id = a and r.email = 'r2@x.dev' and j.status = 'pending'; perform pg_temp.assert_eq('other recipients untouched', n, 1);
  select count(*) into n from sending_jobs where user_id = b and status = 'pending'; perform pg_temp.assert_eq('other tenant jobs untouched', n, 1);
  select count(*) into n from consent_events where contact_id = contact and event = 'revoked'; if n < 1 then raise exception 'FAIL: consent revocation not recorded'; end if;
  select count(*) into n from audit_logs where action = 'recipient.unsubscribed' and detail::text like '%@%'; perform pg_temp.assert_eq('audit log carries no address', n, 0);
  raise notice 'queue: unsubscribe ok';
end $$;

-- ===================== provider webhook events =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s2 uuid := '00000000-0000-0000-0000-0000000000a2'; q uuid; ids uuid[]; ev uuid; r text; n int; st text;
begin
  perform pg_temp.reset(); q := pg_temp.camp(a, s2, 'completed');
  ids := pg_temp.jobs(q, 4, 'accepted', 'resend', 'w');
  update sending_jobs set accepted_at = now(), provider_message_id = 'm' || (select count(*) from sending_jobs s2 where s2.campaign_id = q and s2.created_at <= sending_jobs.created_at and s2.id <= sending_jobs.id) where campaign_id = q;
  update sending_jobs set provider_message_id = 'm1' where id = ids[1]; update sending_jobs set provider_message_id = 'm2' where id = ids[2];
  update sending_jobs set provider_message_id = 'm3' where id = ids[3]; update sending_jobs set provider_message_id = 'm4' where id = ids[4];

  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','e1','m1','email.delivered','{}') returning id into ev;
  perform pg_temp.assert_eq('delivered applies to an accepted job', apply_provider_event(ev), 'delivered');
  perform pg_temp.assert_eq('job is delivered', (select status from sending_jobs where id = ids[1]), 'delivered');
  if (select delivered_at from sending_jobs where id = ids[1]) is null then raise exception 'FAIL: delivered_at'; end if;
  perform pg_temp.assert_eq('an applied event is not applied twice', apply_provider_event(ev), 'already_applied');

  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','e2','m2','email.bounced','{"data":{"bounce":{"type":"Permanent","message":"mailbox does not exist"}}}') returning id into ev;
  perform pg_temp.assert_eq('permanent bounce', apply_provider_event(ev), 'bounced');
  select count(*) into n from suppressions where user_id = a and email = 'w2@x.dev' and reason = 'bounce'; perform pg_temp.assert_eq('hard bounce suppresses the address', n, 1);
  perform pg_temp.assert_eq('campaign status follows the bounce', (select status from campaigns where id = q), 'partially_failed');

  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','e3','m3','email.bounced','{"data":{"bounce":{"type":"Transient"}}}') returning id into ev;
  perform apply_provider_event(ev);
  select count(*) into n from suppressions where user_id = a and email = 'w3@x.dev'; perform pg_temp.assert_eq('soft bounce does not suppress', n, 0);
  perform pg_temp.assert_eq('soft bounce is still shown as bounced', (select status from sending_jobs where id = ids[3]), 'bounced');

  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','e4','m4','email.complained','{}') returning id into ev;
  perform apply_provider_event(ev);
  select count(*) into n from suppressions where user_id = a and email = 'w4@x.dev' and reason = 'complaint'; perform pg_temp.assert_eq('complaint suppresses', n, 1);
  perform pg_temp.assert_eq('complaint leaves the delivery status alone', (select status from sending_jobs where id = ids[4]), 'accepted');

  -- out-of-order: a late "delivered" must not overwrite a bounce
  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','e5','m2','email.delivered','{}') returning id into ev;
  perform apply_provider_event(ev);
  perform pg_temp.assert_eq('late delivered cannot undo a bounce', (select status from sending_jobs where id = ids[2]), 'bounced');

  -- the webhook beat our own write: event waits, then applies once the message id is recorded
  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','e6','m-future','email.delivered','{}') returning id into ev;
  perform pg_temp.assert_eq('unknown message waits', apply_provider_event(ev), 'no_job');
  if (select applied_at from provider_events where id = ev) is not null then raise exception 'FAIL: unmatched event was consumed'; end if;
  update sending_jobs set status = 'processing' where id = ids[4];
  update sending_jobs set status = 'accepted', provider_message_id = 'm-future' where id = ids[4];
  perform pg_temp.assert_eq('pending events apply once the job has its message id', apply_pending_events('resend', 'm-future'), 1);
  perform pg_temp.assert_eq('and the job becomes delivered', (select status from sending_jobs where id = ids[4]), 'delivered');
  raise notice 'queue: webhook events ok';
end $$;

-- ===================== contact erasure =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; c1 uuid := gen_random_uuid(); rid uuid; jid uuid; n int; rr record;
begin
  perform pg_temp.reset();
  insert into contacts (id, user_id, email, consent_source, consented_at) values (c1, a, 'gone@x.dev', 't', now());
  q := pg_temp.camp(a, s1, 'sending');
  rid := gen_random_uuid(); jid := gen_random_uuid();
  insert into campaign_recipients (id, user_id, campaign_id, contact_id, email, rendered_subject, rendered_html, rendered_text, unsubscribe_token) values (rid, a, q, c1, 'gone@x.dev', 'Hi', '<p>secret</p>', 'secret', 'tok-gone');
  insert into sending_jobs (id, user_id, recipient_id, campaign_id, idempotency_key, status, provider) values (jid, a, rid, q, 'mp:' || jid, 'pending', 'gmail');
  perform pg_temp.jobs(q, 1, 'accepted', 'gmail', 'kept');
  delete from contacts where id = c1;
  perform pg_temp.assert_eq('pending message to a deleted contact is cancelled', (select status from sending_jobs where id = jid), 'cancelled');
  select email, rendered_html, rendered_subject, rendered_text, unsubscribe_token, erased_at, contact_id into rr from campaign_recipients where id = rid;
  if rr.email is not null or rr.rendered_html is not null or rr.rendered_subject is not null or rr.rendered_text is not null or rr.unsubscribe_token is not null or rr.erased_at is null or rr.contact_id is not null
    then raise exception 'FAIL: personal data survived contact deletion: %', rr; end if;
  select count(*) into n from sending_jobs where campaign_id = q; perform pg_temp.assert_eq('delivery records survive (counts stay true)', n, 2);
  raise notice 'queue: erasure ok';
end $$;

-- ===================== privileges and tenant isolation =====================
do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b'; s1 uuid := '00000000-0000-0000-0000-0000000000a1'; q uuid; ev uuid;
begin
  perform pg_temp.reset(); q := pg_temp.camp(a, s1, 'sending'); perform pg_temp.jobs(q, 2, 'accepted', 'gmail');
  insert into sending_events (user_id, job_id, type) select user_id, id, 'accepted' from sending_jobs where campaign_id = q;
  insert into provider_events (provider, provider_event_id, provider_message_id, type, payload) values ('resend','x1','m','email.delivered','{}');
  perform set_config('t.campaign', q::text, false);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$ declare n int; q uuid := current_setting('t.campaign')::uuid;
begin
  begin perform * from claim_send_jobs('x', 1, 1, 1); raise exception 'FAIL: user can claim jobs'; exception when insufficient_privilege then null; end;
  begin perform apply_unsubscribe('x'); raise exception 'FAIL: user can call apply_unsubscribe directly'; exception when insufficient_privilege then null; end;
  begin perform cancel_campaign(q, '00000000-0000-0000-0000-00000000000a'); raise exception 'FAIL: user can call cancel_campaign directly'; exception when insufficient_privilege then null; end;
  begin perform begin_queueing(q, '00000000-0000-0000-0000-00000000000a', 1); raise exception 'FAIL: user can self-approve'; exception when insufficient_privilege then null; end;
  begin perform pause_sender('00000000-0000-0000-0000-0000000000a1', 'x'); raise exception 'FAIL: user can pause senders'; exception when insufficient_privilege then null; end;
  begin perform count(*) from provider_events; raise exception 'FAIL: user can read provider_events'; exception when insufficient_privilege then null; end;
  begin perform count(*) from worker_heartbeats; raise exception 'FAIL: user can read worker_heartbeats'; exception when insufficient_privilege then null; end;
  begin update campaigns set send_rate_per_minute = 120 where id = q; raise exception 'FAIL: user changed lifecycle column'; exception when insufficient_privilege then null; end;
  begin update campaigns set status = 'draft' where id = q; raise exception 'FAIL: user reset status'; exception when insufficient_privilege then null; end;

  select count(*) into n from sending_jobs; if n <> 2 then raise exception 'FAIL: owner sees % jobs (want 2)', n; end if;
  select count(*) into n from sending_events; if n <> 2 then raise exception 'FAIL: owner sees % events (want 2)', n; end if;
  select total into n from campaign_stats where campaign_id = q; if n is distinct from 2 then raise exception 'FAIL: campaign_stats total % (want 2)', n; end if;
  delete from sending_jobs; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: user deleted send history'; end if;
  update sending_jobs set status = 'delivered'; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: user rewrote delivery status'; end if;
  select count(*) into n from campaign_recipients; if n <> 2 then raise exception 'FAIL: owner cannot read own recipients'; end if;
  raise notice 'queue privileges (user A): ok';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$ declare n int;
begin
  select count(*) into n from sending_jobs; if n <> 0 then raise exception 'FAIL: B sees A jobs'; end if;
  select count(*) into n from sending_events; if n <> 0 then raise exception 'FAIL: B sees A events'; end if;
  select count(*) into n from campaign_stats; if n <> 0 then raise exception 'FAIL: B sees A campaign stats'; end if;
  select count(*) into n from daily_send_stats; if n <> 0 then raise exception 'FAIL: B sees A daily stats'; end if;
  select count(*) into n from campaign_recipients; if n <> 0 then raise exception 'FAIL: B sees A recipients'; end if;
  raise notice 'queue privileges (user B): ok';
end $$;
reset role;

do $$ begin raise notice 'Phase 6 queue: all checks passed'; end $$;
rollback;
