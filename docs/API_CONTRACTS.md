# API and RPC contracts

These are design contracts to implement, not deployed endpoints. Browser requests use the Supabase app access token, never a Google ID token as application authorization. Every UUID/path is validated. JSON is UTF-8; timestamps ISO-8601 UTC plus IANA timezone fields where meaningful.

## Common envelope

Success: `{data, request_id}`. Error: `{error:{code,message,retryable,field_errors?},request_id}`. Avoid source titles/content in unauthorized errors. Error codes include UNAUTHENTICATED, NOT_FOUND, INVALID_INPUT, CONFLICT, RATE_LIMITED, PROVIDER_UNAVAILABLE, RECONNECT_REQUIRED, INDEX_PENDING, OUTCOME_UNKNOWN. Error bodies omit stack traces and provider credentials.

Default max request body: 64 KiB excluding signed file uploads; intent input 4,000 characters; search 2,000; generation instruction 8,000; draft body 50,000. Cursor pagination defaults 25/max100, deterministic order by created_at/id. No unbounded selects.

## Direct data and RPC operations

| Operation | Input | Result and enforcement |
|---|---|---|
| Read cards/sources | workspace_id, filters, cursor | RLS; accessible items only |
| create_workspace | name | workspace+owner membership atomically |
| create_invite | workspace_id,email | one-use link; hashed token storage; admin/owner only |
| accept_invite | token | membership; token consumed atomically against verified email |
| set_member_role / remove_member / transfer_owner | workspace_id,target user, intended change | row locks, live role checks, last-owner protection |
| create_card | workspace_id,type,payload | private card rev1; owner derived from JWT |
| update_card | card_id,expected_revision,payload | typed DB validation, optimistic update, source job |
| set_visibility | object_id,expected_revision,visibility | owner-only; validate dependency sharing; invalidate derived cards when needed |
| delete_source / delete_card | object_id,expected_revision | tombstone, cancel jobs, invalidate dependencies in transaction |
| match_knowledge | workspace_id,query_text,query_vector,profile_id,limit | SECURITY INVOKER, workspace and visibility filters, active revisions, ranked passages |

Visibility changes use a single shared transaction helper for cards and associated sources; no direct public column writes. RPCs return IDs/revisions rather than privileged internal metadata.

## Edge Functions

| Function / method | Input | Output |
|---|---|---|
| intent POST | workspace_id,text,locale,request_seq | intent probabilities, signals, classifier version, fallback flag, echoed sequence |
| source-upload POST | workspace_id,filename,size,mime | source_id, single-source staged upload authorization |
| source-finalize POST | source_id | revision_id, queued status after size/type checks |
| source-refresh POST | source_id | revision/job status; creator-only Drive connection use |
| search POST | workspace_id,query,limit | results with IDs/title/snippet/score/source URL/import time, mode hybrid/keyword |
| generate POST | workspace_id,task answer/summary/email,instruction,source_ids?,query?,draft_fields? | answer or structured draft plus citations, private_required, model/prompt version |
| google-connect POST | capability | state-bound authorization configuration |
| google-callback GET or POST | documented GIS flow code/state fields | redirect/status; no tokens in URL |
| google-picker-token POST | capability=drive | short-lived access token for Picker only, memory-only client handling |
| google-import POST | workspace_id,file_id | private source and queued job |
| google-disconnect POST | connection_id | disabled status and purge job IDs |
| action-prepare POST | workspace_id,kind gmail_draft/calendar_event,payload,idempotency_key,card_revision? | immutable action_id,payload_hash,expires_at,preview |
| action-execute POST | action_id,payload_hash,idempotency_key | succeeded resource ID/link, processing, or outcome_unknown |
| ingest-worker POST | bounded worker trigger | sanitized processed/requeued counts; scheduler credential only |

Function paths are `/functions/v1/<name>`; DB RPC paths are `/rest/v1/rpc/<name>`. Google callback is the only browser-facing unauthenticated route and uses single-use OAuth state instead of an app JWT on redirect. The worker uses separate scheduler authentication and never accepts a user-selected actor or unrestricted job payload.

## Concrete examples

```json
{"workspace_id":"<uuid>","task":"email","instruction":"Explain our onboarding checklist","source_ids":["<uuid>"],"draft_fields":{"to":["colleague@example.com"],"tone":"concise"}}
```

```json
{"data":{"subject":"Onboarding checklist","body":"...","citations":[{"source_id":"<uuid>","revision_id":"<uuid>","chunk_id":"<uuid>","quote":"..."}],"private_required":true,"model":"<configured-model>","prompt_version":"email-v1"},"request_id":"<uuid>"}
```

A source_ids array narrows access; it never grants it. Nonaccessible IDs cause a generic NOT_FOUND. Mixed-workspace lists are invalid. Email output cannot introduce a new recipient; recipients come from user-confirmed fields.

## Concurrency and external outcomes

`action-prepare` stores a server-canonical payload hash. The client hash is only compared, never trusted as the canonical snapshot. The same idempotency key with different payload is 409. Atomic pending→executing allows only one dispatcher. Provider response recorded before returning success. Unknown Gmail outcomes require manual reconciliation; Calendar uses deterministic provider ID. Timeout responses must not falsely claim rollback of an external mutation.
