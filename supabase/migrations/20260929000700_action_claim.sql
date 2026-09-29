-- Fix: a duplicate confirmation while an action is executing must not dispatch again.
-- The claim result says whether this caller won the prepared -> executing transition.
drop function public.action_begin_execute(uuid, text);

create function public.action_claim(p_action_id uuid, p_payload_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.action_requests; uid uuid := (select auth.uid());
begin
  select * into a from public.action_requests where id = p_action_id for update;
  if not found or a.actor_id <> uid or not private.is_member(a.workspace_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if a.payload_hash <> p_payload_hash then raise exception 'confirmation does not match the prepared content' using errcode = 'PT409'; end if;
  -- A dispatcher that stopped mid-flight leaves an uncertain external outcome; never re-dispatch blindly.
  if a.state = 'executing' and a.updated_at < now() - interval '2 minutes' then
    update public.action_requests set state = 'outcome_unknown', error_code = 'DISPATCH_INTERRUPTED', updated_at = now()
    where id = a.id returning * into a;
  end if;
  if a.state <> 'prepared' then return jsonb_build_object('claimed', false, 'action', to_jsonb(a)); end if;
  if a.expires_at <= now() then
    update public.action_requests set state = 'expired', updated_at = now() where id = a.id returning * into a;
    return jsonb_build_object('claimed', false, 'action', to_jsonb(a));
  end if;
  if not exists (select 1 from public.google_connections where id = a.connection_id and user_id = uid and status = 'active') then
    raise exception 'RECONNECT_REQUIRED' using errcode = 'PT409';
  end if;
  update public.action_requests set state = 'executing', updated_at = now() where id = a.id returning * into a;
  perform private.audit(a.workspace_id, 'action.execute', a.kind, a.id);
  return jsonb_build_object('claimed', true, 'action', to_jsonb(a));
end $$;
revoke all on function public.action_claim(uuid, text) from public, anon;
grant execute on function public.action_claim(uuid, text) to authenticated;
