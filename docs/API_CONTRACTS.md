# API and RPC contracts

These contracts describe the implementation in `supabase/migrations/*.sql` and `supabase/functions/api/**` as of 2026-09-29. They are deployed on the hosted dev project. Browser requests use the Supabase app access token, never a Google ID token, as application authorization. Every UUID and path is validated with the zod schemas in `supabase/functions/api/shared/schemas.ts`, which the web app also imports via `@shared`. JSON is UTF-8. Timestamps are ISO-8601 with offset, plus IANA timezone fields where meaningful.

## Common envelope (Edge Function routes)

Success: `{data, request_id}`. Error: `{error:{code,message,retryable,details?},request_id}`. `details` carries `[{path,message}]` field errors for schema failures, and `{results}` (search fallback) for `GENERATION_INVALID`. Unauthorized errors do not include source titles or content. Error bodies omit stack traces and provider credentials. Responses send `Cache-Control: no-store`.

### Error codes in use

| Code | HTTP | Where |
|---|---|---|
| UNAUTHENTICATED | 401 | missing/invalid/expired Supabase JWT (`auth.getUser`); bad worker token; PT401 |
| NOT_FOUND | 404 | unknown route; nonmember or inaccessible object; PT403/PT404 (existence is not revealed) |
| INVALID_INPUT | 422 (also 405 wrong method, 413 body > 64 KiB) | schema failure, non-JSON body, PT422/22023/23514 |
| CONFLICT | 409 | stale revision, idempotency key reused with different content, hash mismatch, `PRIVATE_DEPENDENCIES`, other PT409 |
| RATE_LIMITED | 429 | `consume_rate_limit` per user per minute: intent 120, search 60 (also index-now), generate 10, google 30, action 20 |
| PROVIDER_UNAVAILABLE | 503 | Jev/LLM/embedding/Google unreachable, timeout, non-2xx, or feature not configured |
| PROVIDER_INVALID | 502 | provider output malformed (wrong dimensions, non-finite, truncated/invalid JSON) |
| CONTENT_FILTERED | 422 | LLM provider safety filter blocked the request after the one exclusion retry |
| GENERATION_INVALID | 502 | model output failed citation/schema validation twice; `details.results` has search hits |
| SEARCH_FAILED | 503 | database failure during retrieval (never replaced by empty results) |
| ACCESS_CHANGED | 409 | evidence became unreadable/inactive during generation (recheck before return) |
| RECONNECT_REQUIRED | 409 | no active Google connection, missing refresh token, `invalid_grant` |
| SCOPE_REQUIRED | 403 | the connection lacks the capability's scope |
| SCOPE_DENIED | 403 | consent returned without the requested scope; Gmail 403 on draft creation (recorded as action error) |
| INVALID_STATE | 400 | OAuth state expired, already used, or bound to another user |
| GOOGLE_DENIED | 400 | code exchange failed or ID token audience/subject/email verification failed |
| ACCOUNT_MISMATCH | 409 | connecting a different Google subject while a connection is active |
| SOURCE_ACCESS_LOST | 404 | Drive file 403/404/trashed on import or refresh (source marked `unavailable`) |
| UNSUPPORTED_TYPE, TOO_LARGE, EMPTY_CONTENT, TOO_MANY_CHARACTERS, INVALID_UTF8 | 422 | Drive import validation (upload RPCs raise the same prefixes via PT422; the worker records them as `error_code`) |
| DATABASE_ERROR | 500 | unmapped PostgREST/SQL error (retryable) |
| INTERNAL | 500 | unexpected exception; blocked non-Google host in the Google fetch wrapper |

Indexing progress and uncertain action outcomes are **states, not error codes**. `search` returns `pending_sources` for sources that are still indexing. `action-execute` returns `state: "outcome_unknown"` in a success envelope.

### PostgREST SQLSTATE mapping

RPCs raise custom SQLSTATEs `PTxxx`. PostgREST returns HTTP `xxx` directly to supabase-js callers, and `dbError()` in `lib/core.ts` maps them for Edge routes:

| SQLSTATE | Edge code | Meaning |
|---|---|---|
| PT401 | UNAUTHENTICATED | no `auth.uid()` |
| PT403, PT404 | NOT_FOUND | forbidden or missing. Both appear as 404 through Edge routes. Direct RPC callers see 403 only after membership has been established (e.g. admin trying an owner-only action). |
| PT409 | CONFLICT, or RECONNECT_REQUIRED when the message starts with `RECONNECT_REQUIRED` | revision/idempotency/state conflicts, `STALE_FENCE`, `PRIVATE_DEPENDENCIES`, `ACCOUNT_MISMATCH` |
| PT422, 22023, 23514 | INVALID_INPUT | validation or check-constraint failure. Message prefixes such as `UNSUPPORTED_TYPE:` and `TOO_LARGE:` identify the reason. |
| 42501 | (PostgREST 401/403) | privilege denied: direct table writes, anon access, `svc_*`/`worker_*` functions for users |
| other | DATABASE_ERROR | generic, retryable |

Limits: 64 KiB request body; intent text 4,000 characters; search query 2,000, limit 1–20 (default 10); generation instruction 8,000, `source_ids` ≤20; email body 50,000, subject ≤300 on one line, ≤20 `to`/`cc`. Card lists use keyset order `(created_at desc, id desc)` from the client. No endpoint returns an unbounded list.

## Direct data and RPC operations

All RPCs are called at `/rest/v1/rpc/<name>` under the user's JWT. Browsers have SELECT-only grants on public tables, and all writes go through these RPCs.

| Operation | Input | Result and enforcement |
|---|---|---|
| Read cards/sources/revisions/chunks/memberships | table filters | RLS via `private.can_read`/`is_member`. Chunks are readable only for the active revision. `source_revisions` exposes a column subset (no text or storage path). |
| ensure_bootstrap | — | idempotent profile + one personal workspace (also run by the `auth.users` insert trigger) |
| create_workspace | p_name | team workspace + owner membership atomically |
| create_invite / revoke_invite | p_workspace_id,p_email / p_invite_id | owner/admin, team only. Returns a one-time token (stored as SHA-256) that expires in 7 days. Email is trimmed and lowercased. |
| accept_invite | p_token | verified email must match; single use; atomic; role `member` |
| set_member_role / remove_member / transfer_owner / delete_workspace | workspace, target user | Row locks and live role checks. Only the owner changes roles, transfers, or deletes. Admins remove members only. A deferred constraint trigger enforces exactly one active owner. |
| create_card | p_workspace_id,p_type,p_payload | private, revision 1, owner from JWT; `private.valid_card_payload` mirrors the zod schemas |
| update_card | p_card_id,p_expected_revision,p_payload | Owner, or owner/admin for shared cards. Stale revision → PT409. Enqueues a new source revision in the same transaction. |
| set_card_visibility | p_card_id,p_expected_revision,p_visibility | owner only; sharing blocked by `PRIVATE_DEPENDENCIES` (PT409) |
| delete_card | p_card_id,p_expected_revision | tombstone; the source is deleted, its jobs canceled, and its chunks removed in the same transaction |
| create_generated_card | p_workspace_id,p_type,p_payload,p_dependencies[{source_id,revision_id}] | private card plus `source_dependencies`; each dependency must be currently readable (else PT404) |
| create_upload_source | p_workspace_id,p_filename,p_size,p_mime | `.txt/.md/.markdown`, `text/plain` or `text/markdown`, 1 B–5 MiB. Returns `{source_id,revision_id,bucket:'uploads',path}`, where path is `<workspace>/<user>/<source>/<revision>`. |
| (Storage upload) | PUT to `uploads/<path>` with user JWT | the `uploads_insert` policy allows only the caller's own **pending** server-created path; the bucket is private with a 5 MiB and MIME allow-list |
| finalize_upload | p_source_id | Owner only. Requires the staged object (else `UPLOAD_MISSING`, PT422). Size re-checked from object metadata. Enqueues an indexing job and returns `{revision_id,state:'queued'}`. The worker then rejects NUL bytes, invalid UTF-8 (`INVALID_UTF8`), >100,000 characters, and empty text. |
| delete_source / set_source_visibility / retry_source | p_source_id[,p_visibility] | Owner only, for non-card sources. Delete removes chunks immediately. Unshare/delete invalidates shared derived cards. Retry re-queues a failed revision with a new fence. |
| match_knowledge | p_workspace_id,p_query,p_embedding?,p_limit | SECURITY INVOKER, so RLS filters candidates. Returns top-50 cosine (HNSW, iterative scan) fused by RRF (k=60) with top-50 `ts_rank_cd`, at most 2 chunks per source, limit 1–20. A null embedding runs keyword-only mode. |
| action_prepare | p_workspace_id,p_kind,p_payload,p_idempotency_key | Requires an active Google connection (else `RECONNECT_REQUIRED`). Stores a server-canonical payload and `payload_hash` (sha256 of jsonb text) and expires in 15 min. The same key with the same content returns the same row. The same key with different content → PT409. |
| action_claim | p_action_id,p_payload_hash | See "Concurrency and external outcomes" |
| consume_rate_limit | p_kind | per-user per-minute counter; used by Edge routes |

Service-role-only RPCs (`svc_*`, `worker_*`) are not callable by `anon`/`authenticated`. The DB tests verify this: `svc_secret`, `svc_oauth_state_create/consume`, `svc_google_store/credentials/update_access/set_status`, `svc_drive_snapshot`, `svc_source_unavailable`, `svc_action_record`, `worker_claim_jobs/store_text/put_chunks/activate/fail`.

## Edge Function routes

A single function `api` (deployed with `verify_jwt=false`, see ADR-0001) serves `/functions/v1/api/<route>`. All routes are POST except `health` and `google-config` (GET allowed). "User" routes verify the bearer token with `auth.getUser` and use a user-JWT Supabase client, so RLS applies. The privileged client is used only for credentials, the worker, and `svc_*` calls after the user has been authorized.

| Route | Auth | Input | Output |
|---|---|---|---|
| health | none | — | `{ok:true}` |
| intent | user + member | workspace_id,text,locale?,request_seq | `{intent,confidence,probabilities,classifier,fallback,request_seq}`; Jev (`jev-1.13.0`) or `keyword-v1` fallback |
| search | user | workspace_id,query,limit? | `{mode,results:[{chunk_id,source_id,revision_id,title,source_kind,visibility,external_url,imported_at,score,snippet,content}],pending_sources}`; mode `hybrid` or `keyword` (embedding failure) |
| generate | user + member | workspace_id,task answer/summary/email,instruction?,query?,source_ids?,draft_fields{to,cc?,tone?}? | answer/summary or `{to,cc,subject,body}` plus `citations,dependencies,private_required,model,prompt_version,excluded_passages`; `abstained` for answer/summary |
| index-now | user | — | one bounded worker pass (≤4 jobs, 25 s): `{processed,ready,retried,failed,stale}` |
| ingest-worker | `Bearer WORKER_TOKEN` (constant-time compare) | — | bounded pass (≤16 jobs, 40 s), sanitized counts |
| google-config | none | — | `{configured,client_id,api_key,app_id}` (public Picker/GIS config only) |
| google-connect | user | capability drive/gmail/calendar | `{client_id,scope:'openid email <scope>',state,capability}`; state stored hashed, 10 min, one use |
| google-callback | user | code,state (GIS popup code flow, `redirect_uri=postmessage`) | `{connection_id,email,capability}`; verifies granted scope, ID-token `aud`/`sub`/`email_verified`; tokens AES-GCM encrypted at rest |
| google-picker-token | user | — | `{access_token,expires_in}` for Picker only (drive scope required); client keeps it in memory |
| google-import | user + member | workspace_id,file_id | private `drive_snapshot` source + queued revision, `snapshot:true,google_shared,imported_at` |
| google-disconnect | user | — | revokes refresh token (best effort), deletes credentials, marks the user's Drive sources `unavailable`, cancels their jobs |
| source-refresh | user (source creator) | source_id | new revision/job; access loss → `SOURCE_ACCESS_LOST` and source `unavailable` |
| action-prepare | user | workspace_id,kind gmail_draft/calendar_event,payload,idempotency_key | `{action_id,payload_hash,expires_at,state,preview,account_email,destination}` |
| action-execute | user | action_id,payload_hash | `{action_id,state,provider_resource_id,provider_link,error_code}`; state succeeded/failed/outcome_unknown/expired/executing |

Google scopes: `drive.file`, `gmail.compose`, `calendar.events.owned`, each requested incrementally with `openid email`. Outbound Google calls go through a wrapper that only allows `https://*.googleapis.com` and rejects redirects. No Gmail send route exists.

Upload staging and finalization are RPCs, not routes (see above). Worker scheduling: pg_cron `ingest-worker` every 20 s → `private.kick_worker()` → pg_net POST to `WORKER_URL` with `WORKER_TOKEN` from Vault, only when claimable jobs exist. The worker never accepts a user-selected actor or job payload.

## Concrete examples

```json
{"workspace_id":"<uuid>","task":"email","instruction":"Explain our onboarding checklist","source_ids":["<uuid>"],"draft_fields":{"to":["colleague@example.com"],"tone":"concise"}}
```

```json
{"data":{"workspace_id":"<uuid>","task":"email","prompt_version":"email-v1","to":["colleague@example.com"],"cc":[],"subject":"Onboarding checklist","body":"...","citations":[{"source_id":"<uuid>","revision_id":"<uuid>","chunk_id":"<uuid>","quote":"..."}],"dependencies":[{"source_id":"<uuid>","revision_id":"<uuid>"}],"private_required":true,"model":"gpt-4.1-mini-2025-04-14","excluded_passages":0},"request_id":"<uuid>"}
```

A `source_ids` array narrows access. It never grants it. Nonaccessible IDs cause a generic NOT_FOUND. Email recipients are always the user-supplied `draft_fields.to/cc`, because the model schema has no recipient fields.

## Concurrency and external outcomes

`action-prepare` canonicalizes the payload on the server (Gmail: `to, cc?, subject, body`; Calendar: `title, start, end, timezone, location?, notes?` with the IANA zone validated) and stores its hash. The client echoes `payload_hash` and it is only compared, never trusted as the snapshot. Reusing an idempotency key with a different payload → 409.

`action-execute` calls `action_claim(action_id, payload_hash)`, which locks the row and returns `{claimed, action}`:

- hash mismatch → PT409; foreign/nonmember action → PT404; inactive connection → `RECONNECT_REQUIRED`.
- `executing` for more than 2 min → set to `outcome_unknown` (`DISPATCH_INTERRUPTED`) before anything else.
- state ≠ `prepared` → `claimed:false` and the recorded state is returned. Duplicate confirmations never dispatch again.
- expired → `expired`, `claimed:false`.
- otherwise `prepared→executing`, audited, `claimed:true`. Only this caller dispatches.

The outcome is recorded with `svc_action_record` before the response.

- **Gmail:** timeout or 5xx → `outcome_unknown`, never retried automatically (manual reconciliation). 4xx → `failed`.
- **Calendar:** inserts with the deterministic ID `'a' + hex(sha256(action_id))[0:40]` and `sendUpdates=none`, with no attendees field. A timeout or 409 triggers a GET by that ID to reconcile. A later `action-execute` on an `outcome_unknown` calendar action looks the event up: found → `succeeded`, 404 → `failed` (`NOT_CREATED`).

Responses never claim a rollback of an external mutation.
