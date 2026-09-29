-- M4: generated-content provenance, private-only derived visibility, invalidation, and server-side rate limits.
create table public.source_dependencies (
  workspace_id uuid not null,
  card_id uuid not null,
  source_id uuid not null,
  source_revision_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (card_id, source_id),
  foreign key (workspace_id, card_id) references public.cards (workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete cascade,
  foreign key (source_id, source_revision_id) references public.source_revisions (source_id, id) on delete cascade
);
create index source_dependencies_source on public.source_dependencies (source_id);
alter table public.source_dependencies enable row level security;
revoke all on public.source_dependencies from anon, authenticated;
grant select on public.source_dependencies to authenticated;
create policy source_dependencies_select on public.source_dependencies for select to authenticated
  using (exists (select 1 from public.cards c where c.id = card_id));

create function public.create_generated_card(p_workspace_id uuid, p_type text, p_payload jsonb, p_dependencies jsonb)
returns public.cards language plpgsql security definer set search_path = '' as $$
declare c public.cards; d jsonb; n int := 0;
begin
  if jsonb_typeof(p_dependencies) <> 'array' or jsonb_array_length(p_dependencies) > 20 then
    raise exception 'invalid dependencies' using errcode = 'PT422';
  end if;
  c := public.create_card(p_workspace_id, p_type, p_payload);
  for d in select * from jsonb_array_elements(p_dependencies) loop
    -- A dependency must be a source the caller can currently read in this workspace.
    if not exists (select 1 from public.sources s join public.source_revisions r on r.source_id = s.id
        where s.id = (d ->> 'source_id')::uuid and r.id = (d ->> 'revision_id')::uuid
          and s.workspace_id = p_workspace_id and s.deleted_at is null
          and private.can_read(s.workspace_id, s.owner_id, s.visibility)) then
      raise exception 'not found' using errcode = 'PT404';
    end if;
    insert into public.source_dependencies (workspace_id, card_id, source_id, source_revision_id)
    values (p_workspace_id, c.id, (d ->> 'source_id')::uuid, (d ->> 'revision_id')::uuid)
    on conflict do nothing;
    n := n + 1;
  end loop;
  update public.cards set generated = true where id = c.id returning * into c;
  return c;
end $$;
revoke all on function public.create_generated_card(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_generated_card(uuid, text, jsonb, jsonb) to authenticated;

create or replace function private.assert_shareable_card(p_card_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.source_dependencies d join public.sources s on s.id = d.source_id
             where d.card_id = p_card_id and (s.visibility <> 'workspace' or s.deleted_at is not null)) then
    raise exception 'PRIVATE_DEPENDENCIES: remove or share private sources and regenerate' using errcode = 'PT409';
  end if;
end $$;

-- Unsharing or deleting a source makes shared derived cards private until their owner resolves it.
create function private.invalidate_dependents() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.visibility = 'private' and old.visibility = 'workspace') or (new.deleted_at is not null and old.deleted_at is null) then
    update public.cards c set visibility = 'private', hidden_reason = 'dependency_unavailable',
      revision = c.revision + 1, updated_at = now()
    where c.visibility = 'workspace' and c.id in (select d.card_id from public.source_dependencies d where d.source_id = new.id);
  end if;
  return new;
end $$;
create trigger sources_invalidate_dependents after update of visibility, deleted_at on public.sources
  for each row execute function private.invalidate_dependents();

-- Removing a member cancels their queued indexing work.
create function private.on_membership_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'removed' and old.state = 'active' then
    update private.jobs set state = 'canceled', fence = fence + 1, updated_at = now()
    where workspace_id = new.workspace_id and actor_id = new.user_id and state in ('queued', 'running', 'retry_wait');
  end if;
  return new;
end $$;
create trigger memberships_removed after update of state on public.memberships
  for each row execute function private.on_membership_removed();

create table private.usage_counters (
  bucket_key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket_key, window_start)
);
revoke all on private.usage_counters from public, anon, authenticated;

create function public.consume_rate_limit(p_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare lim int; w timestamptz := date_trunc('minute', now()); n int; uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  lim := case p_kind when 'intent' then 120 when 'search' then 60 when 'generate' then 10
    when 'google' then 30 when 'action' then 20 else null end;
  if lim is null then raise exception 'unknown limit' using errcode = 'PT422'; end if;
  insert into private.usage_counters (bucket_key, window_start, count) values (p_kind || ':' || uid, w, 1)
  on conflict (bucket_key, window_start) do update set count = private.usage_counters.count + 1
  returning count into n;
  delete from private.usage_counters where window_start < now() - interval '1 hour' and random() < 0.01;
  return n <= lim;
end $$;
revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;
