#!/usr/bin/env bash
# Configure Vault secrets that the pg_cron worker trigger reads (local stack).
set -a; . supabase/functions/.env; set +a
docker exec -i supabase_db_hackathon-spiderguy psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  -v url="http://supabase_kong_hackathon-spiderguy:8000/functions/v1/api/ingest-worker" -v token="$WORKER_TOKEN" <<'SQL'
delete from vault.secrets where name in ('WORKER_URL', 'WORKER_TOKEN');
select vault.create_secret(:'url', 'WORKER_URL');
select vault.create_secret(:'token', 'WORKER_TOKEN');
select count(*) as secrets from vault.decrypted_secrets where name in ('WORKER_URL', 'WORKER_TOKEN');
SQL
