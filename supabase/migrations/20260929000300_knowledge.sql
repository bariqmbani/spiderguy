-- M3: sources, revisions, chunks, immutable embedding profile, leased/fenced jobs, private storage, authorized search.
create table public.embedding_profiles (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  dimensions int not null check (dimensions = 1536),
  normalization text not null,
  distance text not null check (distance = 'cosine'),
  version text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, model, dimensions, version)
);
create unique index embedding_profiles_one_active on public.embedding_profiles (active) where active;
insert into public.embedding_profiles (provider, model, dimensions, normalization, distance, version, active)
values ('openai-compatible', 'text-embedding-3-small', 1536, 'l2', 'cosine', 'te3s-1536-v1', true);

create function private.embedding_profile_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.provider, new.model, new.dimensions, new.normalization, new.distance, new.version)
     is distinct from (old.provider, old.model, old.dimensions, old.normalization, old.distance, old.version) then
    raise exception 'embedding profiles are immutable; create a new profile' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger embedding_profiles_immutable before update on public.embedding_profiles
  for each row execute function private.embedding_profile_immutable();

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  kind text not null check (kind in ('card', 'upload', 'drive_snapshot')),
  card_id uuid unique,
  title text not null check (char_length(title) between 1 and 300),
  mime_type text,
  external_file_id text,
  external_url text check (external_url is null or external_url ~ '^https://'),
  connection_id uuid,
  active_revision_id uuid,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'ready', 'retry_wait', 'failed', 'deleted', 'unavailable')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, card_id) references public.cards (workspace_id, id) on delete cascade,
  check ((kind = 'card') = (card_id is not null))
);
create index sources_workspace on public.sources (workspace_id, created_at desc) where deleted_at is null;
create unique index sources_drive_file on public.sources (workspace_id, owner_id, external_file_id)
  where kind = 'drive_snapshot' and deleted_at is null;

create table public.source_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_id uuid not null,
  revision_number int not null check (revision_number >= 1),
  content_hash text,
  extractor_version text not null default 'text-v1',
  chunker_version text not null default 'para-v1',
  embedding_profile_id uuid not null references public.embedding_profiles (id),
  extracted_text text check (extracted_text is null or char_length(extracted_text) <= 100000),
  storage_path text unique,
  byte_size int check (byte_size is null or byte_size between 1 and 5242880),
  chunk_count int,
  state text not null default 'pending'
    check (state in ('pending', 'queued', 'processing', 'ready', 'failed', 'superseded', 'canceled')),
  error_code text,
  imported_at timestamptz not null default now(),
  external_modified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_id, revision_number),
  unique (workspace_id, id),
  unique (source_id, id),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete cascade
);

alter table public.sources add constraint sources_active_revision_fk
  foreign key (id, active_revision_id) references public.source_revisions (source_id, id) deferrable initially deferred;

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_id uuid not null,
  revision_id uuid not null,
  ordinal int not null check (ordinal >= 0),
  text text not null check (char_length(text) between 1 and 8000),
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  embedding extensions.vector(1536),
  embedding_profile_id uuid not null references public.embedding_profiles (id),
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (revision_id, ordinal),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete cascade,
  foreign key (source_id, revision_id) references public.source_revisions (source_id, id) on delete cascade
);
create index chunks_tsv on public.chunks using gin (tsv);
create index chunks_embedding on public.chunks using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_source on public.chunks (workspace_id, source_id, revision_id);

create table private.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  revision_id uuid not null references public.source_revisions (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  type text not null default 'index_revision' check (type = 'index_revision'),
  dedupe_key text not null unique,
  state text not null default 'queued' check (state in ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled')),
  attempts int not null default 0,
  max_attempts int not null default 6,
  not_before timestamptz not null default now(),
  lease_until timestamptz,
  fence bigint not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claimable on private.jobs (not_before) where state in ('queued', 'retry_wait', 'running');
create index jobs_source on private.jobs (source_id);
revoke all on private.jobs from public, anon, authenticated;

-- RLS: sources/revisions/chunks follow can_read; chunks and revisions only for the live active revision.
alter table public.embedding_profiles enable row level security;
alter table public.sources enable row level security;
alter table public.source_revisions enable row level security;
alter table public.chunks enable row level security;
revoke all on public.embedding_profiles, public.sources, public.source_revisions, public.chunks from anon, authenticated;
grant select on public.embedding_profiles, public.sources, public.chunks to authenticated;
grant select (id, workspace_id, source_id, revision_number, content_hash, state, error_code, imported_at,
  external_modified_at, chunk_count, embedding_profile_id, created_at) on public.source_revisions to authenticated;

create policy embedding_profiles_select on public.embedding_profiles for select to authenticated using (true);
create policy sources_select on public.sources for select to authenticated
  using (deleted_at is null and private.can_read(workspace_id, owner_id, visibility));
create policy source_revisions_select on public.source_revisions for select to authenticated
  using (exists (select 1 from public.sources s where s.id = source_id));
create policy chunks_select on public.chunks for select to authenticated
  using (exists (select 1 from public.sources s
    where s.id = source_id and s.active_revision_id = revision_id and s.state in ('ready', 'processing', 'pending', 'retry_wait')));

-- Card text becomes an indexable source revision in the same transaction as the card mutation.
create function private.card_text(c public.cards) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(case c.type
    when 'note' then concat_ws(E'\n\n', nullif(c.payload ->> 'title', ''), c.payload ->> 'text')
    when 'checklist' then concat_ws(E'\n', nullif(c.payload ->> 'title', ''),
      (select string_agg(case when (i ->> 'done')::boolean then '[x] ' else '[ ] ' end || (i ->> 'text'), E'\n')
       from jsonb_array_elements(c.payload -> 'items') i))
    when 'event' then concat_ws(E'\n', c.payload ->> 'title',
      'When: ' || (c.payload ->> 'start') || ' to ' || (c.payload ->> 'end') || ' (' || (c.payload ->> 'timezone') || ')',
      'Where: ' || nullif(c.payload ->> 'location', ''), nullif(c.payload ->> 'notes', ''))
    when 'bookmark' then concat_ws(E'\n', nullif(c.payload ->> 'title', ''), c.payload ->> 'url', nullif(c.payload ->> 'note', ''))
    when 'email' then concat_ws(E'\n\n', 'Subject: ' || (c.payload ->> 'subject'), c.payload ->> 'body')
  end), 100000);
$$;

create function private.card_title(c public.cards) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce(nullif(btrim(case c.type
    when 'note' then coalesce(nullif(c.payload ->> 'title', ''), c.payload ->> 'text')
    when 'checklist' then coalesce(nullif(c.payload ->> 'title', ''), c.payload -> 'items' -> 0 ->> 'text')
    when 'event' then c.payload ->> 'title'
    when 'bookmark' then coalesce(nullif(c.payload ->> 'title', ''), c.payload ->> 'url')
    when 'email' then nullif(c.payload ->> 'subject', '')
  end), ''), initcap(c.type)), 300);
$$;

create function private.cancel_source_jobs(p_source_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.jobs set state = 'canceled', fence = fence + 1, lease_until = null, updated_at = now()
  where source_id = p_source_id and state in ('queued', 'running', 'retry_wait');
  update public.source_revisions set state = 'canceled'
  where source_id = p_source_id and state in ('pending', 'queued', 'processing');
$$;

create function private.enqueue_revision(p_revision_id uuid, p_actor_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.source_revisions;
begin
  select * into r from public.source_revisions where id = p_revision_id;
  update public.source_revisions set state = 'queued' where id = r.id;
  insert into private.jobs (workspace_id, source_id, revision_id, actor_id, dedupe_key)
  values (r.workspace_id, r.source_id, r.id, p_actor_id, 'index:' || r.id)
  on conflict (dedupe_key) do nothing;
  update public.sources set state = case when active_revision_id is null then 'pending' else state end,
    error_code = null, updated_at = now() where id = r.source_id;
end $$;

create function private.sync_card_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.sources; rev uuid; n int; body text;
begin
  select * into s from public.sources where card_id = new.id for update;
  if new.deleted_at is not null then
    if found then
      update public.sources set deleted_at = now(), state = 'deleted', updated_at = now() where id = s.id;
      perform private.cancel_source_jobs(s.id);
      delete from public.chunks where source_id = s.id;
    end if;
    return new;
  end if;
  if not found then
    insert into public.sources (workspace_id, owner_id, visibility, kind, card_id, title)
    values (new.workspace_id, new.owner_id, new.visibility, 'card', new.id, private.card_title(new)) returning * into s;
  else
    update public.sources set visibility = new.visibility, title = private.card_title(new), updated_at = now()
    where id = s.id;
  end if;
  if tg_op = 'INSERT' or new.payload is distinct from old.payload then
    body := private.card_text(new);
    perform private.cancel_source_jobs(s.id);
    select coalesce(max(revision_number), 0) + 1 into n from public.source_revisions where source_id = s.id;
    insert into public.source_revisions (workspace_id, source_id, revision_number, embedding_profile_id, extracted_text, content_hash)
    select new.workspace_id, s.id, n, p.id, body, encode(extensions.digest(body, 'sha256'), 'hex')
    from public.embedding_profiles p where p.active returning id into rev;
    perform private.enqueue_revision(rev, (select coalesce(auth.uid(), new.owner_id)));
  end if;
  return new;
end $$;
create trigger cards_sync_source after insert or update on public.cards
  for each row execute function private.sync_card_source();

-- Upload sources: server-created storage path; the browser uploads under its JWT, then finalizes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 5242880, array['text/plain', 'text/markdown', 'text/x-markdown'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.create_upload_source(p_workspace_id uuid, p_filename text, p_size int, p_mime text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uuid; r uuid; path text; fname text := btrim(coalesce(p_filename, ''));
begin
  if not private.is_member(p_workspace_id) then raise exception 'not found' using errcode = 'PT404'; end if;
  if fname !~* '\.(txt|md|markdown)$' or char_length(fname) not between 3 and 255 then
    raise exception 'UNSUPPORTED_TYPE: only .txt and .md files are supported' using errcode = 'PT422';
  end if;
  if p_mime not in ('text/plain', 'text/markdown', 'text/x-markdown') then
    raise exception 'UNSUPPORTED_TYPE: only text/plain and text/markdown are supported' using errcode = 'PT422';
  end if;
  if p_size is null or p_size < 1 then raise exception 'EMPTY_FILE: file is empty' using errcode = 'PT422'; end if;
  if p_size > 5242880 then raise exception 'TOO_LARGE: maximum upload is 5 MiB' using errcode = 'PT422'; end if;
  insert into public.sources (workspace_id, owner_id, kind, title, mime_type)
  values (p_workspace_id, (select auth.uid()), 'upload', fname, p_mime) returning id into s;
  r := gen_random_uuid();
  path := p_workspace_id || '/' || (select auth.uid()) || '/' || s || '/' || r;
  insert into public.source_revisions (id, workspace_id, source_id, revision_number, embedding_profile_id, storage_path, byte_size)
  select r, p_workspace_id, s, 1, p.id, path, p_size from public.embedding_profiles p where p.active;
  return jsonb_build_object('source_id', s, 'revision_id', r, 'bucket', 'uploads', 'path', path);
end $$;

create function public.finalize_upload(p_source_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sources; r public.source_revisions; obj record;
begin
  select * into s from public.sources where id = p_source_id and deleted_at is null for update;
  if not found or s.owner_id <> (select auth.uid()) or not private.is_member(s.workspace_id) or s.kind <> 'upload' then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  select * into r from public.source_revisions where source_id = s.id and state = 'pending'
  order by revision_number desc limit 1 for update;
  if not found then raise exception 'nothing to finalize' using errcode = 'PT409'; end if;
  select o.metadata into obj from storage.objects o where o.bucket_id = 'uploads' and o.name = r.storage_path;
  if not found then raise exception 'UPLOAD_MISSING: upload the file first' using errcode = 'PT422'; end if;
  if coalesce((obj.metadata ->> 'size')::bigint, 0) not between 1 and 5242880 then
    update public.source_revisions set state = 'failed', error_code = 'TOO_LARGE' where id = r.id;
    update public.sources set state = 'failed', error_code = 'TOO_LARGE' where id = s.id;
    return jsonb_build_object('revision_id', r.id, 'state', 'failed', 'error_code', 'TOO_LARGE');
  end if;
  perform private.enqueue_revision(r.id, (select auth.uid()));
  return jsonb_build_object('revision_id', r.id, 'state', 'queued');
end $$;

create function public.delete_source(p_source_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sources;
begin
  select * into s from public.sources where id = p_source_id and deleted_at is null for update;
  if not found or s.owner_id <> (select auth.uid()) or not private.is_member(s.workspace_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if s.kind = 'card' then raise exception 'delete the card instead' using errcode = 'PT409'; end if;
  update public.sources set deleted_at = now(), state = 'deleted', updated_at = now() where id = s.id;
  perform private.cancel_source_jobs(s.id);
  delete from public.chunks where source_id = s.id;
  perform private.audit(s.workspace_id, 'source.delete', 'source', s.id);
end $$;

create function public.set_source_visibility(p_source_id uuid, p_visibility text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sources;
begin
  if p_visibility not in ('private', 'workspace') then raise exception 'invalid visibility' using errcode = 'PT422'; end if;
  select * into s from public.sources where id = p_source_id and deleted_at is null for update;
  if not found or s.owner_id <> (select auth.uid()) or not private.is_member(s.workspace_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if s.kind = 'card' then raise exception 'change the card visibility instead' using errcode = 'PT409'; end if;
  update public.sources set visibility = p_visibility, updated_at = now() where id = s.id;
  perform private.audit(s.workspace_id, 'source.visibility', 'source', s.id, jsonb_build_object('visibility', p_visibility));
end $$;

create function public.retry_source(p_source_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sources; r public.source_revisions;
begin
  select * into s from public.sources where id = p_source_id and deleted_at is null for update;
  if not found or s.owner_id <> (select auth.uid()) or not private.is_member(s.workspace_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  select * into r from public.source_revisions where source_id = s.id order by revision_number desc limit 1;
  if r.state <> 'failed' then raise exception 'source is not in a failed state' using errcode = 'PT409'; end if;
  update private.jobs set state = 'queued', attempts = 0, not_before = now(), fence = fence + 1, updated_at = now()
  where revision_id = r.id;
  update public.source_revisions set state = 'queued', error_code = null where id = r.id;
  update public.sources set state = case when active_revision_id is null then 'pending' else 'ready' end, error_code = null where id = s.id;
end $$;

revoke all on function public.create_upload_source(uuid, text, int, text), public.finalize_upload(uuid),
  public.delete_source(uuid), public.set_source_visibility(uuid, text), public.retry_source(uuid) from public, anon;
grant execute on function public.create_upload_source(uuid, text, int, text), public.finalize_upload(uuid),
  public.delete_source(uuid), public.set_source_visibility(uuid, text), public.retry_source(uuid) to authenticated;

create function private.upload_path_access(p_name text, p_pending_only boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.source_revisions r join public.sources s on s.id = r.source_id
    where r.storage_path = p_name and (not p_pending_only or r.state = 'pending')
      and s.owner_id = (select auth.uid()) and s.deleted_at is null and private.is_member(s.workspace_id));
$$;
revoke all on function private.upload_path_access(text, boolean) from public;
grant execute on function private.upload_path_access(text, boolean) to authenticated;

create policy uploads_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and private.upload_path_access(name, true));
create policy uploads_select on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and private.upload_path_access(name, false));

-- Worker RPCs (service_role only). Every mutation checks the job fence so a reclaimed worker cannot publish.
create function public.worker_claim_jobs(p_limit int default 4, p_lease_seconds int default 90)
returns table (job_id uuid, fence bigint, attempts int, workspace_id uuid, source_id uuid, revision_id uuid,
  source_kind text, storage_path text, extracted_text text, external_file_id text, connection_id uuid, actor_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  -- Jobs whose actor lost access or whose source was deleted are canceled rather than run.
  update private.jobs j set state = 'canceled', fence = j.fence + 1, updated_at = now()
  from public.sources s
  where s.id = j.source_id and j.state in ('queued', 'retry_wait', 'running')
    and (s.deleted_at is not null or not exists (select 1 from public.memberships m join public.workspaces w on w.id = m.workspace_id
      where m.workspace_id = j.workspace_id and m.user_id = j.actor_id and m.state = 'active' and w.deletion_state = 'active'));
  return query
  with c as (
    select j.id from private.jobs j
    where (j.state in ('queued', 'retry_wait') and j.not_before <= now())
       or (j.state = 'running' and j.lease_until < now())
    order by j.not_before limit least(greatest(p_limit, 1), 16) for update skip locked
  ), u as (
    update private.jobs j set state = 'running', attempts = j.attempts + 1, fence = j.fence + 1,
      lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 300)), updated_at = now()
    from c where j.id = c.id returning j.*
  )
  select u.id, u.fence, u.attempts, u.workspace_id, u.source_id, u.revision_id, s.kind, r.storage_path, r.extracted_text,
    s.external_file_id, s.connection_id, u.actor_id
  from u join public.sources s on s.id = u.source_id join public.source_revisions r on r.id = u.revision_id;
  update public.source_revisions r set state = 'processing' from private.jobs j
  where j.revision_id = r.id and j.state = 'running' and r.state = 'queued';
  update public.sources s set state = 'processing' from private.jobs j
  where j.source_id = s.id and j.state = 'running' and s.state in ('pending', 'retry_wait') and s.deleted_at is null;
end $$;

create function private.check_fence(p_job_id uuid, p_fence bigint) returns private.jobs
language plpgsql security definer set search_path = '' as $$
declare j private.jobs;
begin
  select * into j from private.jobs where id = p_job_id for update;
  if not found or j.fence <> p_fence or j.state <> 'running' then
    raise exception 'STALE_FENCE' using errcode = 'PT409';
  end if;
  return j;
end $$;
revoke all on function private.check_fence(uuid, bigint) from public;

create function public.worker_store_text(p_job_id uuid, p_fence bigint, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare j private.jobs := private.check_fence(p_job_id, p_fence);
begin
  update public.source_revisions set extracted_text = p_text,
    content_hash = encode(extensions.digest(p_text, 'sha256'), 'hex') where id = j.revision_id;
end $$;

create function public.worker_put_chunks(p_job_id uuid, p_fence bigint, p_chunks jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare j private.jobs := private.check_fence(p_job_id, p_fence); n int; prof uuid;
begin
  select embedding_profile_id into prof from public.source_revisions where id = j.revision_id;
  insert into public.chunks (workspace_id, source_id, revision_id, ordinal, text, embedding, embedding_profile_id, content_hash)
  select j.workspace_id, j.source_id, j.revision_id, (c ->> 'ordinal')::int, c ->> 'text',
    (c ->> 'embedding')::extensions.vector(1536), prof, encode(extensions.digest(c ->> 'text', 'sha256'), 'hex')
  from jsonb_array_elements(p_chunks) c
  on conflict (revision_id, ordinal) do update set text = excluded.text, embedding = excluded.embedding,
    content_hash = excluded.content_hash;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.worker_activate(p_job_id uuid, p_fence bigint, p_chunk_count int) returns text
language plpgsql security definer set search_path = '' as $$
declare j private.jobs := private.check_fence(p_job_id, p_fence); s public.sources; r public.source_revisions; have int;
begin
  select * into s from public.sources where id = j.source_id for update;
  select * into r from public.source_revisions where id = j.revision_id for update;
  if s.deleted_at is not null or r.state <> 'processing' then
    update private.jobs set state = 'canceled', updated_at = now() where id = j.id;
    return 'canceled';
  end if;
  if exists (select 1 from public.source_revisions x where x.source_id = s.id and x.state = 'ready'
             and x.revision_number > r.revision_number) then
    update public.source_revisions set state = 'superseded' where id = r.id;
    update private.jobs set state = 'canceled', updated_at = now() where id = j.id;
    return 'superseded';
  end if;
  select count(*) into have from public.chunks where revision_id = r.id and embedding is not null;
  if p_chunk_count < 1 or have <> p_chunk_count then
    raise exception 'INCOMPLETE_CHUNKS: % of %', have, p_chunk_count using errcode = 'PT409';
  end if;
  delete from public.chunks where source_id = s.id and revision_id <> r.id;
  update public.source_revisions set state = 'superseded' where source_id = s.id and state = 'ready';
  update public.source_revisions set state = 'ready', chunk_count = have where id = r.id;
  update public.sources set active_revision_id = r.id, state = 'ready', error_code = null, updated_at = now() where id = s.id;
  update private.jobs set state = 'succeeded', lease_until = null, updated_at = now() where id = j.id;
  return 'ready';
end $$;

create function public.worker_fail(p_job_id uuid, p_fence bigint, p_error_code text, p_retryable boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare j private.jobs := private.check_fence(p_job_id, p_fence); delays int[] := array[5, 30, 120, 600, 1800]; code text := left(p_error_code, 64);
begin
  if p_retryable and j.attempts < j.max_attempts then
    update private.jobs set state = 'retry_wait', last_error_code = code, lease_until = null,
      not_before = now() + make_interval(secs => delays[least(j.attempts, 5)] * (0.8 + random() * 0.4)), updated_at = now()
    where id = j.id;
    update public.source_revisions set state = 'queued', error_code = code where id = j.revision_id;
    update public.sources set state = case when active_revision_id is null then 'retry_wait' else state end,
      error_code = code, updated_at = now() where id = j.source_id and deleted_at is null;
    return 'retry_wait';
  end if;
  update private.jobs set state = 'failed', last_error_code = code, lease_until = null, updated_at = now() where id = j.id;
  update public.source_revisions set state = 'failed', error_code = code where id = j.revision_id;
  update public.sources set state = case when active_revision_id is null then 'failed' else state end,
    error_code = code, updated_at = now() where id = j.source_id and deleted_at is null;
  delete from public.chunks where revision_id = j.revision_id;
  return 'failed';
end $$;

revoke all on function public.worker_claim_jobs(int, int), public.worker_store_text(uuid, bigint, text),
  public.worker_put_chunks(uuid, bigint, jsonb), public.worker_activate(uuid, bigint, int),
  public.worker_fail(uuid, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.worker_claim_jobs(int, int), public.worker_store_text(uuid, bigint, text),
  public.worker_put_chunks(uuid, bigint, jsonb), public.worker_activate(uuid, bigint, int),
  public.worker_fail(uuid, bigint, text, boolean) to service_role;

-- Authorized hybrid search. SECURITY INVOKER: RLS filters candidates before ranking.
create function public.match_knowledge(p_workspace_id uuid, p_query text, p_embedding extensions.vector(1536) default null,
  p_limit int default 10)
returns table (chunk_id uuid, source_id uuid, revision_id uuid, title text, source_kind text, visibility text,
  external_url text, imported_at timestamptz, content text, score double precision, vector_rank int, keyword_rank int)
language plpgsql stable security invoker set search_path = ''
set hnsw.iterative_scan = 'relaxed_order' set hnsw.ef_search = '100' as $$
declare q tsquery;
begin
  if char_length(coalesce(p_query, '')) not between 1 and 2000 then
    raise exception 'query must be 1-2000 characters' using errcode = 'PT422';
  end if;
  if not private.is_member(p_workspace_id) then raise exception 'not found' using errcode = 'PT404'; end if;
  q := nullif(replace(plainto_tsquery('english', p_query)::text, ' & ', ' | '), '')::tsquery;
  return query
  with vec as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_embedding)::int as r
    from (select c0.id, c0.embedding from public.chunks c0
          join public.embedding_profiles p on p.id = c0.embedding_profile_id and p.active
          where p_embedding is not null and c0.workspace_id = p_workspace_id and c0.embedding is not null
          order by c0.embedding operator(extensions.<=>) p_embedding limit 50) c
  ), kw as (
    select c.id, row_number() over (order by ts_rank_cd(c.tsv, q) desc, c.id)::int as r
    from public.chunks c
    where q is not null and c.workspace_id = p_workspace_id and c.tsv @@ q
    order by ts_rank_cd(c.tsv, q) desc, c.id limit 50
  ), fused as (
    select coalesce(v.id, k.id) as id, coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + k.r), 0) as score,
      v.r as vr, k.r as kr
    from vec v full outer join kw k on k.id = v.id
  ), ranked as (
    select f.*, c.source_id, row_number() over (partition by c.source_id order by f.score desc) as per_source
    from fused f join public.chunks c on c.id = f.id
  )
  select c.id, s.id, c.revision_id, s.title, s.kind, s.visibility, s.external_url, r.imported_at, c.text,
    rk.score::double precision, rk.vr, rk.kr
  from ranked rk
  join public.chunks c on c.id = rk.id
  join public.sources s on s.id = c.source_id and s.active_revision_id = c.revision_id and s.deleted_at is null
  join public.source_revisions r on r.id = c.revision_id
  where rk.per_source <= 2
  order by rk.score desc, c.id
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
end $$;
revoke all on function public.match_knowledge(uuid, text, extensions.vector, int) from public, anon;
grant execute on function public.match_knowledge(uuid, text, extensions.vector, int) to authenticated;
