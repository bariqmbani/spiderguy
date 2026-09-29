-- Adversarial RLS/RPC tests. Runs in one transaction and rolls back. Any failed assertion raises.
-- Run: pnpm test:db   (psql against the local Supabase database)
begin;
create schema tests;

create function tests.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function tests.expect_error(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_state is not null and sqlstate <> p_state then
      raise exception 'FAIL %: expected %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL %: expected error %', p_label, p_state;
end $$;

create function tests.eq(got anyelement, want anyelement, p_label text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', p_label, got, want; end if;
end $$;

grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'owner@example.test', now(), '{"full_name":"Olive Owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'admin@example.test', now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'member@example.test', now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', 'outsider@example.test', now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated', 'unverified@example.test', null, '{}', now(), now());

create temp table ids (k text primary key, v text);
grant all on ids to authenticated;

-- AUTH-01: bootstrap is idempotent and creates exactly one personal workspace.
do $$
declare a uuid := '10000000-0000-0000-0000-00000000000a'; w1 uuid; w2 uuid;
begin
  perform tests.as_user(a);
  w1 := public.ensure_bootstrap();
  w2 := public.ensure_bootstrap();
  perform tests.eq(w1, w2, 'bootstrap idempotent');
  perform tests.eq((select count(*) from public.workspaces where kind = 'personal')::int, 1, 'one personal workspace visible');
  perform tests.eq((select display_name from public.profiles where id = a), 'Olive Owner', 'profile from metadata');
  perform tests.expect_error(format('select public.create_invite(%L, %L)', w1, 'x@example.test'), 'PT422', 'personal workspace cannot invite');
  perform tests.as_admin();
  insert into ids values ('personal_a', w1);
end $$;

-- TEAM-01/02: team creation, invites bound to verified email, single use, roles.
do $$
declare a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b';
  c uuid := '10000000-0000-0000-0000-00000000000c'; d uuid := '10000000-0000-0000-0000-00000000000d';
  e uuid := '10000000-0000-0000-0000-00000000000e'; ws uuid; inv jsonb; inv2 jsonb; inv3 jsonb;
begin
  perform tests.as_user(a);
  ws := public.create_workspace('Team Alpha');
  inv := public.create_invite(ws, '  Admin@Example.TEST ');
  inv2 := public.create_invite(ws, 'member@example.test');
  inv3 := public.create_invite(ws, 'unverified@example.test');
  perform tests.expect_error(format('select public.create_workspace(%L)', ''), 'PT422', 'empty team name');

  perform tests.as_user(d);
  perform tests.expect_error(format('select public.accept_invite(%L)', inv ->> 'token'), 'PT404', 'email mismatch rejected');
  perform tests.eq((select count(*) from public.workspaces where id = ws)::int, 0, 'outsider cannot see team');
  perform tests.eq((select count(*) from public.invitations)::int, 0, 'outsider cannot see invites');

  perform tests.as_user(e);
  perform tests.expect_error(format('select public.accept_invite(%L)', inv3 ->> 'token'), 'PT404', 'unverified email rejected');

  perform tests.as_user(b);
  perform tests.eq(public.accept_invite(inv ->> 'token'), ws, 'admin accepts');
  perform tests.as_user(c);
  perform tests.expect_error(format('select public.accept_invite(%L)', inv ->> 'token'), 'PT404', 'invite reuse rejected');
  perform tests.eq(public.accept_invite(inv2 ->> 'token'), ws, 'member accepts');
  perform tests.expect_error(format('select public.create_invite(%L, %L)', ws, 'z@example.test'), 'PT403', 'member cannot invite');
  perform tests.eq((select count(*) from public.invitations)::int, 0, 'member cannot list invites');
  perform tests.expect_error(format('select public.set_member_role(%L, %L, %L)', ws, c, 'admin'), 'PT403', 'member cannot self-promote');

  perform tests.as_user(a);
  perform public.set_member_role(ws, b, 'admin');
  perform tests.as_user(b);
  perform tests.expect_error(format('select public.set_member_role(%L, %L, %L)', ws, c, 'admin'), 'PT403', 'admin cannot change roles');
  perform tests.expect_error(format('select public.remove_member(%L, %L)', ws, a), 'PT409', 'admin cannot remove owner');
  perform tests.expect_error(format('select public.transfer_owner(%L, %L)', ws, b), 'PT403', 'admin cannot transfer');
  perform tests.eq((select count(*) from public.invitations where workspace_id = ws)::int, 3, 'admin lists invites');

  perform tests.as_admin();
  update public.invitations set expires_at = now() - interval '1 second' where id = (inv3 ->> 'invite_id')::uuid;
  update auth.users set email_confirmed_at = now() where id = e;
  perform tests.as_user(e);
  perform tests.expect_error(format('select public.accept_invite(%L)', inv3 ->> 'token'), 'PT404', 'expired invite rejected');
  perform tests.as_admin();
  insert into ids values ('team', ws);
end $$;

-- CARD-01/ACL-01: private by default; admins cannot read private content; revision conflicts.
do $$
declare a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b';
  c uuid := '10000000-0000-0000-0000-00000000000c'; d uuid := '10000000-0000-0000-0000-00000000000d';
  ws uuid := (select v from ids where k = 'team'); card public.cards; shared public.cards;
begin
  perform tests.as_user(c);
  card := public.create_card(ws, 'note', '{"title":"Secret","text":"member private plan"}');
  perform tests.eq(card.visibility, 'private', 'new card is private');
  perform tests.eq(card.owner_id, c, 'owner from JWT');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'note', '{"title":"","text":""}'), 'PT422', 'empty note rejected');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'bookmark', '{"url":"javascript:alert(1)"}'), 'PT422', 'javascript url rejected');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'event', '{"title":"x","start":"2026-10-01T10:00:00Z","end":"2026-10-01T09:00:00Z","timezone":"UTC"}'), 'PT422', 'event end before start');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'note', '{"title":"a","text":"b","extra":1}'), 'PT422', 'unknown field rejected');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'email', '{"to":["a@b.co"],"subject":"x\ny","body":"b"}'), 'PT422', 'subject newline rejected');
  perform tests.expect_error('insert into public.cards (workspace_id, owner_id, type, payload) values (' || quote_literal(ws) || ', ' || quote_literal(c) || ', ''note'', ''{"title":"a","text":"b"}'')', '42501', 'direct insert denied');

  perform tests.as_user(b);
  perform tests.eq((select count(*) from public.cards where id = card.id)::int, 0, 'admin cannot read private card');
  perform tests.eq((select count(*) from public.sources where card_id = card.id)::int, 0, 'admin cannot read private source');
  perform tests.expect_error(format('select public.update_card(%L, 1, %L)', card.id, '{"title":"x","text":"y"}'), 'PT404', 'admin cannot edit private');
  perform tests.as_user(a);
  perform tests.eq((select count(*) from public.cards where id = card.id)::int, 0, 'owner cannot read private card');
  perform tests.expect_error(format('select public.set_card_visibility(%L, 1, %L)', card.id, 'workspace'), 'PT404', 'others cannot share');

  perform tests.as_user(c);
  card := public.update_card(card.id, 1, '{"title":"Secret","text":"edited"}');
  perform tests.eq(card.revision, 2, 'revision increments');
  perform tests.expect_error(format('select public.update_card(%L, 1, %L)', card.id, '{"title":"stale","text":"stale"}'), 'PT409', 'stale revision conflict');
  perform tests.eq((select payload ->> 'text' from public.cards where id = card.id), 'edited', 'conflict preserves data');
  shared := public.create_card(ws, 'checklist', '{"title":"Launch","items":[{"text":"write docs","done":false}]}');
  shared := public.set_card_visibility(shared.id, 1, 'workspace');

  perform tests.as_user(b);
  perform tests.eq((select count(*) from public.cards where id = shared.id)::int, 1, 'admin reads shared');
  shared := public.update_card(shared.id, 2, '{"title":"Launch","items":[{"text":"write docs","done":true}]}');
  perform tests.eq((select visibility from public.cards where id = shared.id), 'workspace', 'admin edit keeps visibility');
  perform tests.expect_error(format('select public.set_card_visibility(%L, 3, %L)', shared.id, 'private'), 'PT403', 'admin cannot unshare others');

  perform tests.as_user(d);
  perform tests.eq((select count(*) from public.cards where id = shared.id)::int, 0, 'nonmember cannot read shared');
  perform tests.eq((select count(*) from public.chunks)::int, 0, 'nonmember sees no chunks');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'note', '{"title":"x","text":"y"}'), 'PT404', 'nonmember cannot create');
  perform tests.expect_error(format('select * from public.match_knowledge(%L, %L)', ws, 'docs'), 'PT404', 'nonmember cannot search');

  perform tests.as_admin();
  insert into ids values ('private_card', card.id), ('shared_card', shared.id);
end $$;

-- JOB-01/RAG-03: fenced worker, atomic activation, stale workers rejected, deletion hides immediately.
do $$
declare ws uuid := (select v from ids where k = 'team'); j record; j2 record; vec text := '[' || array_to_string(array_fill(0.0255::float8, array[1536]), ',') || ']';
  shared uuid := (select v from ids where k = 'shared_card'); src uuid; res text;
begin
  select id into src from public.sources where card_id = shared;
  select * into j from public.worker_claim_jobs(16, 90) where source_id = src;
  perform tests.eq(j.source_kind, 'card', 'claimed card job');
  perform public.worker_put_chunks(j.job_id, j.fence, jsonb_build_array(jsonb_build_object('ordinal', 0, 'text', 'Launch checklist: write docs', 'embedding', vec)));
  -- Simulate lease expiry and reclaim: the old worker's fence becomes stale.
  update private.jobs set lease_until = now() - interval '1 second' where id = j.job_id;
  select * into j2 from public.worker_claim_jobs(16, 90) where job_id = j.job_id;
  perform tests.eq(j2.fence, j.fence + 1, 'reclaim increments fence');
  perform tests.expect_error(format('select public.worker_activate(%L, %s, 1)', j.job_id, j.fence), 'PT409', 'stale fence cannot activate');
  perform tests.expect_error(format('select public.worker_activate(%L, %s, 2)', j2.job_id, j2.fence), 'PT409', 'incomplete chunks cannot activate');
  res := public.worker_activate(j2.job_id, j2.fence, 1);
  perform tests.eq(res, 'ready', 'activation succeeds');
  perform tests.eq((select state from public.sources where id = src), 'ready', 'source ready');
  insert into ids values ('shared_source', src);
end $$;

do $$
declare b uuid := '10000000-0000-0000-0000-00000000000b'; c uuid := '10000000-0000-0000-0000-00000000000c';
  d uuid := '10000000-0000-0000-0000-00000000000d'; ws uuid := (select v from ids where k = 'team');
  vec text := '[' || array_to_string(array_fill(0.0255::float8, array[1536]), ',') || ']'; n int;
begin
  perform tests.as_user(b);
  select count(*) into n from public.match_knowledge(ws, 'write docs', vec::extensions.vector);
  perform tests.eq(n, 1, 'member finds shared chunk (hybrid)');
  select count(*) into n from public.match_knowledge(ws, 'write docs', null);
  perform tests.eq(n, 1, 'keyword-only mode works');
  perform tests.as_user(d);
  perform tests.eq((select count(*) from public.chunks)::int, 0, 'outsider sees no chunks');
end $$;

-- AI-02: generated cards inherit privacy; sharing blocked by private dependencies; unsharing invalidates.
do $$
declare b uuid := '10000000-0000-0000-0000-00000000000b'; c uuid := '10000000-0000-0000-0000-00000000000c';
  ws uuid := (select v from ids where k = 'team'); src uuid := (select v from ids where k = 'shared_source');
  priv_card uuid := (select v from ids where k = 'private_card'); priv_src uuid; rev uuid; g public.cards; g2 public.cards;
  shared uuid := (select v from ids where k = 'shared_card');
begin
  perform tests.as_admin();
  select id into priv_src from public.sources where card_id = priv_card;
  select active_revision_id into rev from public.sources where id = src;
  perform tests.as_user(b);
  perform tests.expect_error(format('select public.create_generated_card(%L, %L, %L, %L)', ws, 'note', '{"title":"x","text":"y"}',
    jsonb_build_array(jsonb_build_object('source_id', priv_src, 'revision_id', (select id from public.embedding_profiles limit 1)))), 'PT404', 'cannot depend on unreadable source');
  g := public.create_generated_card(ws, 'note', '{"title":"Answer","text":"docs"}', jsonb_build_array(jsonb_build_object('source_id', src, 'revision_id', rev)));
  perform tests.eq(g.visibility, 'private', 'generated card private');
  g := public.set_card_visibility(g.id, g.revision, 'workspace');
  perform tests.as_user(c);
  perform public.set_card_visibility(shared, (select revision from public.cards where id = shared), 'private');
  perform tests.as_admin();
  perform tests.eq((select visibility from public.cards where id = g.id), 'private', 'unshare invalidates derived card');
  perform tests.eq((select hidden_reason from public.cards where id = g.id), 'dependency_unavailable', 'reason recorded');
  perform tests.as_user(b);
  perform tests.expect_error(format('select public.set_card_visibility(%L, %s, %L)', g.id, (select revision from public.cards where id = g.id), 'workspace'), 'PT409', 'sharing blocked by private dependency');
end $$;

-- TEAM-03: removal takes effect on the next check even with an unexpired JWT; ownership invariants.
do $$
declare a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b';
  c uuid := '10000000-0000-0000-0000-00000000000c'; ws uuid := (select v from ids where k = 'team');
begin
  perform tests.as_user(a);
  perform public.remove_member(ws, c);
  perform tests.as_user(c);
  perform tests.eq((select count(*) from public.workspaces where id = ws)::int, 0, 'removed member loses workspace');
  perform tests.eq((select count(*) from public.cards where workspace_id = ws)::int, 0, 'removed member loses own private cards');
  perform tests.expect_error(format('select public.create_card(%L, %L, %L)', ws, 'note', '{"title":"x","text":"y"}'), 'PT404', 'removed member cannot write');
  perform tests.as_admin();
  perform tests.eq((select count(*) from private.jobs where workspace_id = ws and actor_id = c and state in ('queued','running','retry_wait'))::int, 0, 'removed actor jobs canceled');

  perform tests.as_user(a);
  perform tests.expect_error(format('select public.remove_member(%L, %L)', ws, a), 'PT403', 'owner cannot leave via remove');
  perform public.transfer_owner(ws, b);
  perform tests.as_admin();
  perform tests.eq((select owner_id from public.workspaces where id = ws), b, 'owner transferred');
  perform tests.eq((select count(*) from public.memberships where workspace_id = ws and role = 'owner' and state = 'active')::int, 1, 'exactly one owner');
  perform tests.as_user(a);
  perform tests.expect_error(format('select public.delete_workspace(%L)', ws), 'PT403', 'former owner cannot delete');
  perform tests.as_admin();
  set constraints memberships_owner_consistency immediate;
  perform tests.expect_error(format('update public.memberships set role = %L where workspace_id = %L and user_id = %L', 'admin', ws, b), 'PT409', 'ownerless workspace rejected');
  set constraints memberships_owner_consistency deferred;
end $$;

-- Uploads: storage path is server-created and owner-scoped; finalize validates the staged object.
do $$
declare a uuid := '10000000-0000-0000-0000-00000000000a'; b uuid := '10000000-0000-0000-0000-00000000000b';
  ws uuid := (select v from ids where k = 'team'); up jsonb;
begin
  perform tests.as_user(b);
  perform tests.expect_error(format('select public.create_upload_source(%L, %L, 10, %L)', ws, 'x.pdf', 'application/pdf'), 'PT422', 'pdf rejected');
  perform tests.expect_error(format('select public.create_upload_source(%L, %L, 6000000, %L)', ws, 'x.txt', 'text/plain'), 'PT422', 'oversize rejected');
  perform tests.expect_error(format('select public.create_upload_source(%L, %L, 0, %L)', ws, 'x.txt', 'text/plain'), 'PT422', 'empty rejected');
  up := public.create_upload_source(ws, 'notes.md', 120, 'text/markdown');
  perform tests.expect_error(format('select public.finalize_upload(%L)', up ->> 'source_id'), 'PT422', 'finalize requires object');
  perform tests.eq(private.upload_path_access(up ->> 'path', true), true, 'uploader may write own path');
  perform tests.as_user(a);
  perform tests.eq(private.upload_path_access(up ->> 'path', true), false, 'others may not write path');
  perform tests.expect_error(format('select public.delete_source(%L)', up ->> 'source_id'), 'PT404', 'others cannot delete source');
end $$;

-- M5: action ledger requires a connection; idempotency key cannot be reused with different content.
do $$
declare b uuid := '10000000-0000-0000-0000-00000000000b'; d uuid := '10000000-0000-0000-0000-00000000000d';
  ws uuid := (select v from ids where k = 'team'); a1 public.action_requests; a2 public.action_requests; a3 public.action_requests;
begin
  perform tests.as_user(b);
  perform tests.expect_error(format('select public.action_prepare(%L, %L, %L, %L)', ws, 'gmail_draft', '{"to":["x@example.test"]}', 'idem-key-1'), 'PT409', 'no connection -> reconnect');
  perform tests.as_admin();
  perform public.svc_google_store(b, 'google-sub-b', 'admin@example.test', array['https://www.googleapis.com/auth/gmail.compose'], null, 'ct', now() + interval '1 hour', 1);
  perform tests.expect_error(format('select public.svc_google_store(%L, %L, %L, %L, null, null, now(), 1)', b, 'other-sub', 'x@example.test', '{}'), 'PT409', 'account mismatch rejected');
  perform tests.as_user(b);
  perform tests.eq((select count(*) from public.google_connections)::int, 1, 'owner sees own connection');
  a1 := public.action_prepare(ws, 'gmail_draft', '{"to":["x@example.test"],"subject":"Hi","body":"Hello"}', 'idem-key-1');
  a2 := public.action_prepare(ws, 'gmail_draft', '{"to":["x@example.test"],"subject":"Hi","body":"Hello"}', 'idem-key-1');
  perform tests.eq(a1.id, a2.id, 'idempotent prepare');
  perform tests.expect_error(format('select public.action_prepare(%L, %L, %L, %L)', ws, 'gmail_draft', '{"to":["y@example.test"],"subject":"Hi","body":"Hello"}', 'idem-key-1'), 'PT409', 'key reuse with new content');
  perform tests.expect_error(format('select public.action_begin_execute(%L, %L)', a1.id, repeat('0', 64)), 'PT409', 'hash mismatch rejected');
  a3 := public.action_begin_execute(a1.id, a1.payload_hash);
  perform tests.eq(a3.state, 'executing', 'first confirm executes');
  a3 := public.action_begin_execute(a1.id, a1.payload_hash);
  perform tests.eq(a3.state, 'executing', 'duplicate confirm does not re-dispatch');
  perform tests.as_user(d);
  perform tests.eq((select count(*) from public.google_connections)::int, 0, 'others cannot see connection');
  perform tests.eq((select count(*) from public.action_requests)::int, 0, 'others cannot see actions');
  perform tests.expect_error(format('select public.action_begin_execute(%L, %L)', a1.id, a1.payload_hash), 'PT404', 'others cannot execute');
  perform tests.expect_error('select public.svc_google_credentials(' || quote_literal(b) || ')', '42501', 'svc functions denied to users');
  perform tests.expect_error('select * from public.worker_claim_jobs(1, 30)', '42501', 'worker functions denied to users');
end $$;

-- Anonymous access is denied everywhere.
do $$
begin
  perform tests.as_admin();
  execute 'set local role anon';
  perform tests.expect_error('select count(*) from public.cards', '42501', 'anon cannot read cards');
  perform tests.expect_error('select public.ensure_bootstrap()', '42501', 'anon cannot call rpc');
  execute 'reset role';
end $$;

-- Fire pending deferred constraint triggers now; the final rollback would otherwise skip them.
set constraints all immediate;
select 'ALL DB TESTS PASSED' as result;
rollback;
