-- Operations: operator secrets from Vault for Edge Functions and a scheduled, authenticated worker trigger.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Edge Functions prefer environment secrets; Vault is the fallback when the host has no secret store access.
create function public.svc_secret(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_name and p_name = any (array['TYPESAFE_API_KEY', 'JEV_MODEL', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
    'EMBEDDING_BASE_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_MODEL', 'WORKER_TOKEN', 'TOKEN_ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_API_KEY', 'GOOGLE_APP_ID'])
  order by created_at desc limit 1;
$$;
revoke all on function public.svc_secret(text) from public, anon, authenticated;
grant execute on function public.svc_secret(text) to service_role;

create function private.kick_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; token text;
begin
  if not exists (select 1 from private.jobs where (state in ('queued', 'retry_wait') and not_before <= now())
                 or (state = 'running' and lease_until < now())) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'WORKER_URL' order by created_at desc limit 1;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'WORKER_TOKEN' order by created_at desc limit 1;
  if url is null or token is null then return; end if;
  perform net.http_post(url := url, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
    timeout_milliseconds := 60000);
end $$;
revoke all on function private.kick_worker() from public;

select cron.schedule('ingest-worker', '20 seconds', 'select private.kick_worker()');
