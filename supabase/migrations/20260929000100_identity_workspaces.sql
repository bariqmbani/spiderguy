-- M1: profiles, personal/team workspaces, memberships, invitations, and RLS helpers.
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  email text not null default '',
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  locale text not null default 'en' check (char_length(locale) between 1 and 35),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal', 'team')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  owner_id uuid not null references auth.users (id),
  deletion_state text not null default 'active' check (deletion_state in ('active', 'deleting')),
  created_at timestamptz not null default now()
);
create unique index workspaces_one_personal on public.workspaces (owner_id) where kind = 'personal';

create table public.memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  state text not null default 'active' check (state in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create unique index memberships_one_owner on public.memberships (workspace_id) where role = 'owner' and state = 'active';
create index memberships_user_active on public.memberships (user_id) where state = 'active';

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email_normalized text not null check (
    email_normalized = lower(btrim(email_normalized))
    and email_normalized ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and char_length(email_normalized) <= 320
  ),
  role text not null default 'member' check (role = 'member'),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index invitations_workspace on public.invitations (workspace_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id uuid,
  outcome text not null default 'ok',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_workspace on public.audit_events (workspace_id, created_at desc);

-- Owner consistency: the workspace owner_id always has the single active owner membership.
create function private.check_owner_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  ws uuid := case when tg_table_name = 'workspaces' then (r ->> 'id')::uuid else (r ->> 'workspace_id')::uuid end;
begin
  if exists (select 1 from public.workspaces w where w.id = ws)
     and not exists (
       select 1 from public.workspaces w join public.memberships m
         on m.workspace_id = w.id and m.user_id = w.owner_id and m.role = 'owner' and m.state = 'active'
       where w.id = ws) then
    raise exception 'workspace % must have exactly one active owner', ws using errcode = 'PT409';
  end if;
  return null;
end $$;
create constraint trigger memberships_owner_consistency after insert or update or delete on public.memberships
  deferrable initially deferred for each row execute function private.check_owner_consistency();
create constraint trigger workspaces_owner_consistency after insert or update on public.workspaces
  deferrable initially deferred for each row execute function private.check_owner_consistency();

-- Authorization helpers: security definer to avoid recursive RLS; fixed empty search_path.
create function private.is_member(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
      and m.state = 'active' and w.deletion_state = 'active');
$$;

create function private.member_role(p_workspace_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m join public.workspaces w on w.id = m.workspace_id
  where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
    and m.state = 'active' and w.deletion_state = 'active';
$$;

create function private.can_read(p_workspace_id uuid, p_owner_id uuid, p_visibility text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(p_workspace_id)
    and (p_visibility = 'workspace' or p_owner_id = (select auth.uid()));
$$;

create function private.shares_workspace(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.workspace_id = b.workspace_id
    where a.user_id = (select auth.uid()) and a.state = 'active' and b.user_id = p_user_id and b.state = 'active');
$$;

revoke all on function private.is_member(uuid), private.member_role(uuid), private.can_read(uuid, uuid, text),
  private.shares_workspace(uuid), private.check_owner_consistency() from public;
grant execute on function private.is_member(uuid), private.member_role(uuid), private.can_read(uuid, uuid, text),
  private.shares_workspace(uuid) to authenticated, service_role;

create function private.audit(p_workspace_id uuid, p_action text, p_target_type text, p_target_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (workspace_id, actor_id, action, target_type, target_id, metadata)
  values (p_workspace_id, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function private.audit(uuid, text, text, uuid, jsonb) from public;

-- Idempotent bootstrap used by the auth trigger and by the client after sign-in.
create function private.bootstrap_user(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
  u record;
begin
  select id, email, raw_user_meta_data into u from auth.users where id = p_user_id;
  if not found then raise exception 'unknown user' using errcode = 'PT404'; end if;
  insert into public.profiles (id, display_name, email)
  values (u.id, left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1), ''), 120), lower(coalesce(u.email, '')))
  on conflict (id) do update set email = excluded.email;
  insert into public.workspaces (kind, name, owner_id) values ('personal', 'Personal', u.id)
  on conflict (owner_id) where kind = 'personal' do nothing
  returning id into ws;
  if ws is null then
    select id into ws from public.workspaces where owner_id = u.id and kind = 'personal';
  else
    insert into public.memberships (workspace_id, user_id, role) values (ws, u.id, 'owner');
  end if;
  return ws;
end $$;
revoke all on function private.bootstrap_user(uuid) from public;

create function private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bootstrap_user(new.id);
  return new;
end $$;
revoke all on function private.on_auth_user_created() from public;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.on_auth_user_created();

create function public.ensure_bootstrap() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  return private.bootstrap_user((select auth.uid()));
end $$;

create function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'name must be 1-80 characters' using errcode = 'PT422';
  end if;
  insert into public.workspaces (kind, name, owner_id) values ('team', btrim(p_name), uid) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, uid, 'owner');
  perform private.audit(ws, 'workspace.create', 'workspace', ws);
  return ws;
end $$;

create function private.require_team_role(p_workspace_id uuid, p_roles text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare r text; k text;
begin
  select w.kind into k from public.workspaces w where w.id = p_workspace_id and w.deletion_state = 'active' for update;
  r := private.member_role(p_workspace_id);
  if k is null or r is null then raise exception 'not found' using errcode = 'PT404'; end if;
  if k <> 'team' then raise exception 'personal workspaces cannot be shared' using errcode = 'PT422'; end if;
  if not r = any (p_roles) then raise exception 'forbidden' using errcode = 'PT403'; end if;
  return r;
end $$;
revoke all on function private.require_team_role(uuid, text[]) from public;

create function public.create_invite(p_workspace_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare token text; inv uuid; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.require_team_role(p_workspace_id, array['owner', 'admin']);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'invalid email' using errcode = 'PT422';
  end if;
  if exists (select 1 from public.memberships m join public.profiles p on p.id = m.user_id
             where m.workspace_id = p_workspace_id and m.state = 'active' and p.email = v_email) then
    raise exception 'already a member' using errcode = 'PT409';
  end if;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (workspace_id, email_normalized, token_hash, expires_at, invited_by)
  values (p_workspace_id, v_email, extensions.digest(token, 'sha256'), now() + interval '7 days', (select auth.uid()))
  returning id into inv;
  perform private.audit(p_workspace_id, 'invite.create', 'invitation', inv);
  return jsonb_build_object('invite_id', inv, 'token', token, 'expires_at', now() + interval '7 days');
end $$;

create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  select workspace_id into ws from public.invitations where id = p_invite_id;
  if ws is null then raise exception 'not found' using errcode = 'PT404'; end if;
  perform private.require_team_role(ws, array['owner', 'admin']);
  update public.invitations set revoked_at = now() where id = p_invite_id and accepted_at is null and revoked_at is null;
  perform private.audit(ws, 'invite.revoke', 'invitation', p_invite_id);
end $$;

create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations; uid uuid := (select auth.uid()); u record;
begin
  if uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  select * into inv from public.invitations
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256') for update;
  if not found or inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at <= now() then
    raise exception 'invitation is invalid or expired' using errcode = 'PT404';
  end if;
  select email, email_confirmed_at into u from auth.users where id = uid;
  if u.email_confirmed_at is null or lower(btrim(u.email)) <> inv.email_normalized then
    raise exception 'invitation is invalid or expired' using errcode = 'PT404';
  end if;
  if not exists (select 1 from public.workspaces where id = inv.workspace_id and deletion_state = 'active' and kind = 'team') then
    raise exception 'invitation is invalid or expired' using errcode = 'PT404';
  end if;
  insert into public.memberships (workspace_id, user_id, role, state)
  values (inv.workspace_id, uid, 'member', 'active')
  on conflict (workspace_id, user_id) do update
    set state = 'active', role = case when public.memberships.state = 'removed' then 'member' else public.memberships.role end,
        joined_at = case when public.memberships.state = 'removed' then now() else public.memberships.joined_at end,
        updated_at = now();
  update public.invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  perform private.bootstrap_user(uid);
  perform private.audit(inv.workspace_id, 'invite.accept', 'invitation', inv.id);
  return inv.workspace_id;
end $$;

create function public.set_member_role(p_workspace_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
  perform private.require_team_role(p_workspace_id, array['owner']);
  if p_role not in ('admin', 'member') then raise exception 'invalid role' using errcode = 'PT422'; end if;
  select role into cur from public.memberships
  where workspace_id = p_workspace_id and user_id = p_user_id and state = 'active' for update;
  if cur is null then raise exception 'not found' using errcode = 'PT404'; end if;
  if cur = 'owner' then raise exception 'use transfer_owner to change the owner' using errcode = 'PT409'; end if;
  update public.memberships set role = p_role, updated_at = now() where workspace_id = p_workspace_id and user_id = p_user_id;
  perform private.audit(p_workspace_id, 'member.role', 'user', p_user_id, jsonb_build_object('role', p_role));
end $$;

create function public.remove_member(p_workspace_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text; uid uuid := (select auth.uid());
begin
  if p_user_id = uid then
    actor_role := private.require_team_role(p_workspace_id, array['admin', 'member']);
  else
    actor_role := private.require_team_role(p_workspace_id, array['owner', 'admin']);
  end if;
  select role into target_role from public.memberships
  where workspace_id = p_workspace_id and user_id = p_user_id and state = 'active' for update;
  if target_role is null then raise exception 'not found' using errcode = 'PT404'; end if;
  if target_role = 'owner' then raise exception 'the owner cannot be removed' using errcode = 'PT409'; end if;
  if p_user_id <> uid and actor_role = 'admin' and target_role <> 'member' then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  update public.memberships set state = 'removed', updated_at = now()
  where workspace_id = p_workspace_id and user_id = p_user_id;
  perform private.audit(p_workspace_id, 'member.remove', 'user', p_user_id);
end $$;

create function public.transfer_owner(p_workspace_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  perform private.require_team_role(p_workspace_id, array['owner']);
  perform 1 from public.memberships where workspace_id = p_workspace_id and state = 'active'
    and user_id in (uid, p_user_id) order by user_id for update;
  if p_user_id = uid or not exists (select 1 from public.memberships
      where workspace_id = p_workspace_id and user_id = p_user_id and state = 'active') then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  update public.memberships set role = 'admin', updated_at = now() where workspace_id = p_workspace_id and user_id = uid;
  update public.memberships set role = 'owner', updated_at = now() where workspace_id = p_workspace_id and user_id = p_user_id;
  update public.workspaces set owner_id = p_user_id where id = p_workspace_id;
  perform private.audit(p_workspace_id, 'owner.transfer', 'user', p_user_id);
end $$;

create function public.delete_workspace(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_team_role(p_workspace_id, array['owner']);
  update public.workspaces set deletion_state = 'deleting' where id = p_workspace_id;
  perform private.audit(p_workspace_id, 'workspace.delete', 'workspace', p_workspace_id);
end $$;

revoke all on function public.ensure_bootstrap(), public.create_workspace(text), public.create_invite(uuid, text),
  public.revoke_invite(uuid), public.accept_invite(text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.transfer_owner(uuid, uuid), public.delete_workspace(uuid) from public, anon;
grant execute on function public.ensure_bootstrap(), public.create_workspace(text), public.create_invite(uuid, text),
  public.revoke_invite(uuid), public.accept_invite(text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.transfer_owner(uuid, uuid), public.delete_workspace(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.profiles, public.workspaces, public.memberships, public.invitations, public.audit_events from anon, authenticated;
grant select on public.profiles, public.workspaces, public.memberships to authenticated;
grant update (display_name, timezone, locale) on public.profiles to authenticated;
grant select (id, workspace_id, email_normalized, role, expires_at, accepted_at, revoked_at, invited_by, created_at)
  on public.invitations to authenticated;
grant select on public.audit_events to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy workspaces_select on public.workspaces for select to authenticated
  using (private.is_member(id));
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_member(workspace_id));
create policy invitations_select on public.invitations for select to authenticated
  using (private.member_role(workspace_id) in ('owner', 'admin'));
create policy audit_events_select on public.audit_events for select to authenticated
  using (private.member_role(workspace_id) in ('owner', 'admin'));
