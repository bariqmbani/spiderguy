-- M5: per-user Google connections, encrypted credentials, one-use OAuth state, immutable action ledger.
create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  provider_subject text not null,
  email text not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'reconnect_required', 'disconnected')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;
grant select on public.google_connections to authenticated;
create policy google_connections_select on public.google_connections for select to authenticated
  using (user_id = (select auth.uid()));

create table private.google_credentials (
  connection_id uuid primary key references public.google_connections (id) on delete cascade,
  refresh_token_ciphertext text,
  access_token_ciphertext text,
  access_expires_at timestamptz,
  key_version int not null default 1,
  updated_at timestamptz not null default now()
);
create table private.oauth_states (
  state_hash bytea primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  capability text not null check (capability in ('drive', 'gmail', 'calendar')),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
revoke all on private.google_credentials, private.oauth_states from public, anon, authenticated;

alter table public.sources add constraint sources_connection_fk
  foreign key (connection_id) references public.google_connections (id) on delete set null;

create table public.action_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.google_connections (id) on delete set null,
  kind text not null check (kind in ('gmail_draft', 'calendar_event')),
  payload jsonb not null check (pg_column_size(payload) <= 131072),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  state text not null default 'prepared'
    check (state in ('prepared', 'executing', 'succeeded', 'failed', 'outcome_unknown', 'expired')),
  expires_at timestamptz not null,
  provider_resource_id text,
  provider_link text check (provider_link is null or provider_link ~ '^https://'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, kind, idempotency_key)
);
create index action_requests_actor on public.action_requests (actor_id, created_at desc);
alter table public.action_requests enable row level security;
revoke all on public.action_requests from anon, authenticated;
grant select on public.action_requests to authenticated;
create policy action_requests_select on public.action_requests for select to authenticated
  using (actor_id = (select auth.uid()) and private.is_member(workspace_id));

create function private.payload_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p::text, 'sha256'), 'hex');
$$;

create function public.action_prepare(p_workspace_id uuid, p_kind text, p_payload jsonb, p_idempotency_key text)
returns public.action_requests language plpgsql security definer set search_path = '' as $$
declare a public.action_requests; uid uuid := (select auth.uid()); conn uuid; h text := private.payload_hash(p_payload);
begin
  if not private.is_member(p_workspace_id) then raise exception 'not found' using errcode = 'PT404'; end if;
  select id into conn from public.google_connections where user_id = uid and status = 'active';
  if conn is null then raise exception 'RECONNECT_REQUIRED' using errcode = 'PT409'; end if;
  select * into a from public.action_requests where actor_id = uid and kind = p_kind and idempotency_key = p_idempotency_key;
  if found then
    if a.payload_hash <> h or a.workspace_id <> p_workspace_id then
      raise exception 'idempotency key reused with different content' using errcode = 'PT409';
    end if;
    return a;
  end if;
  insert into public.action_requests (workspace_id, actor_id, connection_id, kind, payload, payload_hash, idempotency_key, expires_at)
  values (p_workspace_id, uid, conn, p_kind, p_payload, h, p_idempotency_key, now() + interval '15 minutes')
  returning * into a;
  return a;
end $$;

-- Atomic prepared -> executing; only one dispatcher wins. Replays return the recorded state.
create function public.action_begin_execute(p_action_id uuid, p_payload_hash text) returns public.action_requests
language plpgsql security definer set search_path = '' as $$
declare a public.action_requests; uid uuid := (select auth.uid());
begin
  select * into a from public.action_requests where id = p_action_id for update;
  if not found or a.actor_id <> uid or not private.is_member(a.workspace_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if a.payload_hash <> p_payload_hash then raise exception 'confirmation does not match the prepared content' using errcode = 'PT409'; end if;
  if a.state <> 'prepared' then return a; end if;
  if a.expires_at <= now() then
    update public.action_requests set state = 'expired', updated_at = now() where id = a.id returning * into a;
    return a;
  end if;
  if not exists (select 1 from public.google_connections where id = a.connection_id and user_id = uid and status = 'active') then
    raise exception 'RECONNECT_REQUIRED' using errcode = 'PT409';
  end if;
  update public.action_requests set state = 'executing', updated_at = now() where id = a.id returning * into a;
  perform private.audit(a.workspace_id, 'action.execute', a.kind, a.id);
  return a;
end $$;

revoke all on function public.action_prepare(uuid, text, jsonb, text), public.action_begin_execute(uuid, text) from public, anon;
grant execute on function public.action_prepare(uuid, text, jsonb, text), public.action_begin_execute(uuid, text) to authenticated;

-- Service-role-only helpers used by the Edge Function after verifying the user's JWT.
create function public.svc_action_record(p_action_id uuid, p_state text, p_resource_id text, p_link text, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.action_requests set state = p_state, provider_resource_id = coalesce(p_resource_id, provider_resource_id),
    provider_link = coalesce(p_link, provider_link), error_code = left(p_error, 64), updated_at = now()
  where id = p_action_id and state in ('executing', 'outcome_unknown');
$$;

create function public.svc_oauth_state_create(p_user_id uuid, p_capability text, p_state_hash bytea) returns void
language sql security definer set search_path = '' as $$
  delete from private.oauth_states where expires_at < now() - interval '1 day';
  insert into private.oauth_states (state_hash, user_id, capability, expires_at)
  values (p_state_hash, p_user_id, p_capability, now() + interval '10 minutes');
$$;

create function public.svc_oauth_state_consume(p_user_id uuid, p_state_hash bytea) returns text
language sql security definer set search_path = '' as $$
  update private.oauth_states set consumed_at = now()
  where state_hash = p_state_hash and user_id = p_user_id and consumed_at is null and expires_at > now()
  returning capability;
$$;

create function public.svc_google_store(p_user_id uuid, p_subject text, p_email text, p_scopes text[],
  p_refresh_ct text, p_access_ct text, p_access_expires_at timestamptz, p_key_version int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.google_connections;
begin
  select * into c from public.google_connections where user_id = p_user_id for update;
  if found and c.status <> 'disconnected' and c.provider_subject <> p_subject then
    raise exception 'ACCOUNT_MISMATCH' using errcode = 'PT409';
  end if;
  insert into public.google_connections (user_id, provider_subject, email, scopes, status)
  values (p_user_id, p_subject, p_email, p_scopes, 'active')
  on conflict (user_id) do update set provider_subject = excluded.provider_subject, email = excluded.email,
    scopes = case when public.google_connections.status = 'disconnected' then excluded.scopes
      else array(select distinct unnest(public.google_connections.scopes || excluded.scopes) order by 1) end,
    status = 'active', version = public.google_connections.version + 1, updated_at = now()
  returning * into c;
  insert into private.google_credentials (connection_id, refresh_token_ciphertext, access_token_ciphertext, access_expires_at, key_version)
  values (c.id, p_refresh_ct, p_access_ct, p_access_expires_at, p_key_version)
  on conflict (connection_id) do update set
    refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, private.google_credentials.refresh_token_ciphertext),
    access_token_ciphertext = excluded.access_token_ciphertext, access_expires_at = excluded.access_expires_at,
    key_version = excluded.key_version, updated_at = now();
  return c.id;
end $$;

create function public.svc_google_credentials(p_user_id uuid)
returns table (connection_id uuid, email text, scopes text[], status text, version int, refresh_ct text, access_ct text,
  access_expires_at timestamptz, key_version int)
language sql security definer set search_path = '' as $$
  select c.id, c.email, c.scopes, c.status, c.version, g.refresh_token_ciphertext, g.access_token_ciphertext,
    g.access_expires_at, g.key_version
  from public.google_connections c left join private.google_credentials g on g.connection_id = c.id
  where c.user_id = p_user_id;
$$;

-- Refresh serialization: only the caller holding the current version may write the new access token.
create function public.svc_google_update_access(p_connection_id uuid, p_expected_version int, p_access_ct text,
  p_expires_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.google_connections set version = version + 1, updated_at = now()
  where id = p_connection_id and version = p_expected_version and status = 'active';
  if not found then return false; end if;
  update private.google_credentials set access_token_ciphertext = p_access_ct, access_expires_at = p_expires_at, updated_at = now()
  where connection_id = p_connection_id;
  return true;
end $$;

create function public.svc_google_set_status(p_user_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  update public.google_connections set status = p_status, version = version + 1, updated_at = now()
  where user_id = p_user_id returning id into c;
  if p_status = 'disconnected' and c is not null then
    delete from private.google_credentials where connection_id = c;
    update public.sources set state = 'unavailable', error_code = 'DISCONNECTED', updated_at = now()
    where connection_id = c and deleted_at is null;
    update private.jobs j set state = 'canceled', fence = j.fence + 1, updated_at = now()
    from public.sources s where s.id = j.source_id and s.connection_id = c and j.state in ('queued', 'running', 'retry_wait');
  end if;
end $$;

-- Drive snapshot creation after the Edge Function validated the file with the owner's connection.
create function public.svc_drive_snapshot(p_user_id uuid, p_workspace_id uuid, p_connection_id uuid, p_file_id text,
  p_title text, p_mime text, p_url text, p_text text, p_modified_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sources; rev uuid; n int;
begin
  if not exists (select 1 from public.memberships m join public.workspaces w on w.id = m.workspace_id
      where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.state = 'active' and w.deletion_state = 'active') then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  select * into s from public.sources where workspace_id = p_workspace_id and owner_id = p_user_id
    and external_file_id = p_file_id and kind = 'drive_snapshot' and deleted_at is null for update;
  if not found then
    insert into public.sources (workspace_id, owner_id, kind, title, mime_type, external_file_id, external_url, connection_id)
    values (p_workspace_id, p_user_id, 'drive_snapshot', left(p_title, 300), p_mime, p_file_id, p_url, p_connection_id)
    returning * into s;
  else
    update public.sources set title = left(p_title, 300), connection_id = p_connection_id,
      state = case when state = 'unavailable' then 'pending' else state end, updated_at = now() where id = s.id;
    perform private.cancel_source_jobs(s.id);
  end if;
  select coalesce(max(revision_number), 0) + 1 into n from public.source_revisions where source_id = s.id;
  insert into public.source_revisions (workspace_id, source_id, revision_number, embedding_profile_id, extracted_text,
    content_hash, external_modified_at)
  select p_workspace_id, s.id, n, p.id, p_text, encode(extensions.digest(p_text, 'sha256'), 'hex'), p_modified_at
  from public.embedding_profiles p where p.active returning id into rev;
  perform private.enqueue_revision(rev, p_user_id);
  return jsonb_build_object('source_id', s.id, 'revision_id', rev, 'state', 'queued');
end $$;

create function public.svc_source_unavailable(p_source_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.sources set state = 'unavailable', error_code = left(p_error, 64), updated_at = now() where id = p_source_id;
  perform private.cancel_source_jobs(p_source_id);
end $$;

revoke all on function public.svc_action_record(uuid, text, text, text, text), public.svc_oauth_state_create(uuid, text, bytea),
  public.svc_oauth_state_consume(uuid, bytea), public.svc_google_store(uuid, text, text, text[], text, text, timestamptz, int),
  public.svc_google_credentials(uuid), public.svc_google_update_access(uuid, int, text, timestamptz),
  public.svc_google_set_status(uuid, text), public.svc_drive_snapshot(uuid, uuid, uuid, text, text, text, text, text, timestamptz),
  public.svc_source_unavailable(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_action_record(uuid, text, text, text, text), public.svc_oauth_state_create(uuid, text, bytea),
  public.svc_oauth_state_consume(uuid, bytea), public.svc_google_store(uuid, text, text, text[], text, text, timestamptz, int),
  public.svc_google_credentials(uuid), public.svc_google_update_access(uuid, int, text, timestamptz),
  public.svc_google_set_status(uuid, text), public.svc_drive_snapshot(uuid, uuid, uuid, text, text, text, text, text, timestamptz),
  public.svc_source_unavailable(uuid, text) to service_role;
