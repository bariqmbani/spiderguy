-- M1.4/M2.2: typed cards, private by default, revision-checked mutations.
create function private.is_text(p jsonb, k text, lo int, hi int) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p -> k) = 'string' and char_length(p ->> k) between lo and hi;
$$;

create function private.is_opt_text(p jsonb, k text, hi int) returns boolean
language sql immutable set search_path = '' as $$
  select not (p ? k) or private.is_text(p, k, 0, hi);
$$;

create function private.is_email_list(p jsonb, k text, lo int, hi int) returns boolean
language sql immutable set search_path = '' as $$
  select case when not (p ? k) then lo = 0
    when jsonb_typeof(p -> k) <> 'array' then false
    else jsonb_array_length(p -> k) between lo and hi
      and not exists (select 1 from jsonb_array_elements(p -> k) e
        where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 320
          or (e #>> '{}') !~ '^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$')
  end;
$$;

create function private.is_iso_ts(p jsonb, k text) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p -> k) = 'string'
    and (p ->> k) ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$';
$$;

create function private.valid_card_payload(p_type text, p_version int, p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare allowed text[];
begin
  if p_version <> 1 or jsonb_typeof(p) <> 'object' then return false; end if;
  allowed := case p_type
    when 'note' then array['title', 'text']
    when 'checklist' then array['title', 'items']
    when 'event' then array['title', 'start', 'end', 'timezone', 'location', 'notes']
    when 'bookmark' then array['url', 'title', 'note']
    when 'email' then array['to', 'cc', 'subject', 'body', 'tone', 'citations']
    else null end;
  if allowed is null or exists (select 1 from jsonb_object_keys(p) k where k <> all (allowed)) then
    return false;
  end if;
  case p_type
  when 'note' then
    return private.is_text(p, 'title', 0, 200) and private.is_text(p, 'text', 0, 20000)
      and char_length(btrim((p ->> 'title') || (p ->> 'text'))) > 0;
  when 'checklist' then
    return private.is_text(p, 'title', 0, 200) and jsonb_typeof(p -> 'items') = 'array'
      and jsonb_array_length(p -> 'items') between 1 and 200
      and not exists (select 1 from jsonb_array_elements(p -> 'items') i
        where jsonb_typeof(i) <> 'object' or not private.is_text(i, 'text', 1, 500)
          or jsonb_typeof(i -> 'done') <> 'boolean'
          or exists (select 1 from jsonb_object_keys(i) k where k not in ('text', 'done')));
  when 'event' then
    if not (private.is_iso_ts(p, 'start') and private.is_iso_ts(p, 'end')) then return false; end if;
    return private.is_text(p, 'title', 1, 200)
      and (p ->> 'end')::timestamptz > (p ->> 'start')::timestamptz
      and private.is_text(p, 'timezone', 1, 64) and private.is_opt_text(p, 'location', 300)
      and private.is_opt_text(p, 'notes', 5000);
  when 'bookmark' then
    return private.is_text(p, 'url', 1, 2000) and (p ->> 'url') ~* '^https?://[^\s]+$'
      and private.is_opt_text(p, 'title', 200) and private.is_opt_text(p, 'note', 5000);
  when 'email' then
    return private.is_email_list(p, 'to', 0, 20) and private.is_email_list(p, 'cc', 0, 20)
      and private.is_text(p, 'subject', 0, 300) and private.is_text(p, 'body', 0, 50000)
      and (p ->> 'subject') !~ '[\r\n]'
      and private.is_opt_text(p, 'tone', 40)
      and (not (p ? 'citations') or (jsonb_typeof(p -> 'citations') = 'array' and jsonb_array_length(p -> 'citations') <= 20));
  end case;
  return false;
end $$;

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  type text not null check (type in ('note', 'checklist', 'event', 'bookmark', 'email')),
  payload_version int not null default 1,
  payload jsonb not null,
  revision int not null default 1 check (revision >= 1),
  generated boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  constraint cards_payload_valid check (private.valid_card_payload(type, payload_version, payload)),
  constraint cards_payload_size check (pg_column_size(payload) <= 262144)
);
create index cards_workspace_list on public.cards (workspace_id, created_at desc, id desc) where deleted_at is null;
create index cards_owner on public.cards (owner_id);

alter table public.cards enable row level security;
revoke all on public.cards from anon, authenticated;
grant select on public.cards to authenticated;
create policy cards_select on public.cards for select to authenticated
  using (deleted_at is null and private.can_read(workspace_id, owner_id, visibility));

create function public.create_card(p_workspace_id uuid, p_type text, p_payload jsonb) returns public.cards
language plpgsql security definer set search_path = '' as $$
declare c public.cards;
begin
  if not private.is_member(p_workspace_id) then raise exception 'not found' using errcode = 'PT404'; end if;
  if not private.valid_card_payload(p_type, 1, p_payload) then
    raise exception 'invalid % payload', p_type using errcode = 'PT422';
  end if;
  insert into public.cards (workspace_id, owner_id, type, payload)
  values (p_workspace_id, (select auth.uid()), p_type, p_payload) returning * into c;
  return c;
end $$;

create function private.lock_card_for_edit(p_card_id uuid, p_expected_revision int, p_owner_only boolean)
returns public.cards language plpgsql security definer set search_path = '' as $$
declare c public.cards; uid uuid := (select auth.uid()); r text;
begin
  select * into c from public.cards where id = p_card_id and deleted_at is null for update;
  if not found or not private.can_read(c.workspace_id, c.owner_id, c.visibility) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  r := private.member_role(c.workspace_id);
  if c.owner_id <> uid and (p_owner_only or c.visibility <> 'workspace' or r not in ('owner', 'admin')) then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  if c.revision <> p_expected_revision then
    raise exception 'revision conflict: current %', c.revision using errcode = 'PT409';
  end if;
  return c;
end $$;
revoke all on function private.lock_card_for_edit(uuid, int, boolean) from public;

create function public.update_card(p_card_id uuid, p_expected_revision int, p_payload jsonb) returns public.cards
language plpgsql security definer set search_path = '' as $$
declare c public.cards;
begin
  c := private.lock_card_for_edit(p_card_id, p_expected_revision, false);
  if not private.valid_card_payload(c.type, 1, p_payload) then
    raise exception 'invalid % payload', c.type using errcode = 'PT422';
  end if;
  update public.cards set payload = p_payload, revision = revision + 1, updated_at = now()
  where id = p_card_id returning * into c;
  return c;
end $$;

create function public.set_card_visibility(p_card_id uuid, p_expected_revision int, p_visibility text) returns public.cards
language plpgsql security definer set search_path = '' as $$
declare c public.cards;
begin
  if p_visibility not in ('private', 'workspace') then raise exception 'invalid visibility' using errcode = 'PT422'; end if;
  c := private.lock_card_for_edit(p_card_id, p_expected_revision, true);
  if p_visibility = 'workspace' then
    perform private.assert_shareable_card(c.id);
  end if;
  update public.cards set visibility = p_visibility, hidden_reason = null, revision = revision + 1, updated_at = now()
  where id = p_card_id returning * into c;
  perform private.audit(c.workspace_id, 'card.visibility', 'card', c.id, jsonb_build_object('visibility', p_visibility));
  return c;
end $$;

create function public.delete_card(p_card_id uuid, p_expected_revision int) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cards;
begin
  c := private.lock_card_for_edit(p_card_id, p_expected_revision, false);
  update public.cards set deleted_at = now(), revision = revision + 1, updated_at = now() where id = p_card_id;
  perform private.audit(c.workspace_id, 'card.delete', 'card', c.id);
end $$;

-- Replaced by the provenance migration; cards without dependencies are always shareable.
create function private.assert_shareable_card(p_card_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin return; end $$;
revoke all on function private.assert_shareable_card(uuid) from public;

revoke all on function public.create_card(uuid, text, jsonb), public.update_card(uuid, int, jsonb),
  public.set_card_visibility(uuid, int, text), public.delete_card(uuid, int) from public, anon;
grant execute on function public.create_card(uuid, text, jsonb), public.update_card(uuid, int, jsonb),
  public.set_card_visibility(uuid, int, text), public.delete_card(uuid, int) to authenticated;
