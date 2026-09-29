# Security, deployment, and operations

## Trust and data boundaries

The browser, imported documents, classifier, and LLM output are untrusted. Authenticated membership plus DB policies determines access. Retrieved instructions cannot override system instructions or initiate tools. API functions use allowlisted operations and validate schemas. Stored text is escaped; rendered Markdown is sanitized; no model-generated HTML is executed.

Credentials: browser receives public Supabase URL/key and Google client ID only. Privileged Supabase keys, Google client secret, Jev key, LLM/embedding keys, token-encryption key, and scheduler secret remain in server runtime secrets. Picker receives only a short-lived access token in memory. Never place secrets in VITE_ variables. Encrypt token blobs with authenticated encryption and key version; test rotation and restore. Logs exclude prompts, chunks, email bodies, tokens, and raw provider error payloads.

## Threats and mitigations

| Threat | Required mitigation |
|---|---|
| Cross-tenant ID guessing/vector results | RLS, composite FKs, user-scoped RPC, adversarial SQL and API tests |
| Privileged worker confused deputy | Immutable source/workspace job references; current actor checks; fences; no client-selected credentials |
| Prompt injection in Drive document | Evidence treated as data, no arbitrary tools, cite validation, attack fixtures |
| OAuth login/account confusion | Nonce/audience/origin/state validation, one-use state, exact account subject match |
| SSRF via URLs or provider config | No bookmark fetch; fixed Google API hosts; provider origins operator-only and network-restricted |
| Credential/content leakage | Private schema, restricted grants, encryption, sanitized logs, no analytics containing text |
| Duplicate external action | DB action ledger; uncertain-result handling; Calendar ID reconciliation |
| Stale caches after removal | Membership lookup each request; client invalidation; no shared sensitive response cache |
| File abuse | Byte and decoded limits, MIME validation, UTF-8 allowlist, private buckets, no archive extraction |
| Cost abuse | Per-user/workspace atomic budgets, provider deadlines, batch and context caps |

Initial rate limits: intent 30/min/user; search 20/min/user; generation 5/min/user and 50/hour/workspace; imports 20/hour/user; Google actions 10/min/user. Use DB atomic buckets and reservations before provider calls, not process memory. Workspace daily token ceiling defaults 100,000 generated/input billed tokens combined; reserve maximum budget and reconcile actual usage. Model/provider token reporting may differ; document accounting behavior. Operator can tune limits.

## Runtime configuration contract

| Public build settings | Server/runtime settings |
|---|---|
| VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_PICKER_APP_ID, browser-restricted Picker API key where required | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or supported equivalent, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI |
| APP_PUBLIC_ORIGIN displayed/configured consistently | TYPESAFE_API_KEY, JEV_MODEL, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS |
| No credentials or shared Google tokens | TOKEN_ENCRYPTION_KEY and version, WORKER_TRIGGER_SECRET, allowed provider origins, quotas |

At boot, fail capabilities clearly on missing required config; a missing optional AI/Google setting must not crash basic card access. Reject vector profile mismatches. `.env.example` contains placeholders only. Exact Supabase key formats differ by deployment/version and must be proven in M0.

## Installation deliverables

M6 must supply pinned production Compose/proxy config, complete .env.example, migrations, functions, health checks, and scripts. Document these steps: provision TLS/DNS; configure official Supabase services; set signing/DB/storage secrets; apply migrations; deploy functions; install authenticated scheduler; configure Google origins/callbacks/consent/APIs; configure AI providers; build static app; run first-user and two-user smoke tests.

Support hosted Supabase using the same migrations/functions. Local development uses Supabase CLI; production self-hosting uses the production stack. Do not expose Studio, Postgres, or internal worker ports publicly by default. No cloud-only job scheduler is assumed. Operators must explicitly enable outbound provider access.

## Observability

Structured logs: request_id, operation, anonymized actor/workspace identifier, duration, outcome, provider status category, retries. Metrics: latency percentiles, error rate, job backlog/age, indexing failures, token usage, authorization denials, Google reconnect rate, unknown action outcomes. Alerts: oldest job >10 min, repeated refresh failures, provider error surge, quota exhaustion, backup failure. Avoid high-cardinality content/IDs in metric labels.

## Retention and recovery

Default proposed policy: tombstoned content inaccessible immediately; purge content/chunks/blobs within 24 h; staged orphan uploads within 24 h; OAuth states after 24 h; operational logs 14 days; audit metadata 90 days. Keep successful action IDs/payload hashes 30 days; erase stored action bodies after 24 h while preserving deduplication metadata. No prompt/answer history beyond explicitly saved cards. Removed-member private team content is purged after 30 days; rejoining before purge restores only policy-authorized access.

Nightly encrypted database and object-storage backup, retained 30 days, encryption keys backed up separately. Proposed RPO 24 h and RTO 4 h, validated by drill. Database-only backup is insufficient for Storage objects. Restore in isolation, reapply deletion ledger/tombstones before exposing traffic, invalidate sessions as needed, and verify token decryption without logging tokens. Document backup retention limits on immediate erasure.

Migration release: back up, apply additive schema changes, deploy compatible code, backfill bounded batches, verify RLS, then remove obsolete fields in a later migration. Never roll back by dropping user data. Restore drill and both deployment smoke tests are release gates.
