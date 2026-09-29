# Requirements and acceptance criteria

Status of every row (2026-09-29): see the "Implementation traceability" table below. Rows are implemented and verified locally, except for live Google checks (pending an OAuth client and test account) and OPS-01 (M6, not started). MUST is release-blocking for the relevant milestone. IDs remain stable when text changes. Retire IDs rather than recycle them.

| ID | Requirement | Observable acceptance criteria |
|---|---|---|
| AUTH-01 | Google authentication through Supabase | Valid Google identity creates a Supabase session and one personal workspace; invalid nonce/audience, canceled login, or expired session does not grant access. No Workspace API scope is required to sign in. |
| TEAM-01 | Tenant lifecycle | Authenticated user creates a team; creator is owner; membership is checked in DB; selecting another workspace clears all prior workspace query caches and in-flight results. |
| TEAM-02 | Invitations and roles | Owner/admin creates a seven-day single-use invite bound to an email and member role; acceptance requires matching verified identity and is atomic; expired/reused/mismatched tokens fail; only owner changes privileged roles or transfers ownership. |
| TEAM-03 | Removal and ownership | Removal blocks reads, writes, jobs, and pending actions on the next authorization check, even with an unexpired JWT; concurrent owner removal/transfer cannot leave a workspace ownerless. |
| UI-01 | Stable adaptive cards | Jev maps input to supported intent; manual palette always works; late classifier responses cannot replace newer text; low-confidence classification cannot save or execute anything. |
| CARD-01 | Durable card CRUD | Save/edit/delete note, checklist, event, bookmark, or email card; reject invalid typed payloads; stale revision update produces conflict without data loss. Search is a transient UI card, not a saved content type. |
| ACL-01 | Private and shared access | New objects are private; only owner can share/unshare their content; another member, including admin, cannot read private content; nonmembers cannot access even shared rows or blobs. |
| SRC-01 | Ingest bounded content | TXT/Markdown upload, saved-card source, or selected Google Doc becomes queued then ready; unsupported, oversized, empty, or invalid content yields a visible reason and no partial searchable revision. |
| RAG-01 | Server-side authorized retrieval | Search combines keyword and vector retrieval in Postgres using current authorization; no browser embeddings; unauthorized titles, snippets, counts, and citations never appear. |
| RAG-02 | Grounded answers | Explicit Ask generates from retrieved passages with valid source/revision/chunk references; unsupported questions yield an abstention; unavailable generation leaves ordinary search usable. |
| RAG-03 | Version and deletion correctness | Reindex atomically changes active revision; old revisions stop matching; deleting a source removes it from retrieval immediately, including while a worker is embedding it. |
| AI-01 | Bounded generative assistance | User explicitly requests answer, summary, or email draft; server validates structured result, model configuration, context budget, and limits; malformed output cannot invoke an action. |
| AI-02 | Content visibility inheritance | Generated/saved content using any private source remains private; sharing is blocked until private-source dependencies are removed or explicitly shared and regenerated. |
| GWS-01 | Separate scoped connections | Connect only the requested capability with incremental consent; denied scope disables that feature alone; credentials never appear in browser storage, logs, or public tables. |
| GWS-02 | Selected Drive snapshot import | Picker selection is validated server-side using the connected account; import is private and shows source link/import time; explicit refresh produces a new revision; observed loss of permission hides the source pending resolution. |
| GWS-03 | Gmail draft only | User sees and confirms account, recipients, subject, and body; create an unsent Gmail draft; no send endpoint exists; duplicate submission returns prior result or an explicit uncertain state. |
| GWS-04 | Calendar creation | User confirms timezone, start/end, title, and primary calendar; create one event without attendees; ambiguous times require correction; duplicate confirmation does not create another event. |
| JOB-01 | Durable background work | Closing browser does not lose accepted import; leased jobs retry transient failures with bounds; failed jobs have a safe error and retry control; stale workers cannot activate canceled revisions. |
| OPS-01 | Portable installation | Fresh installation works with hosted and self-hosted Supabase; documented Google setup, worker scheduling, migration, backup, and restore drills succeed; no hosted-only implicit dependency. |
| SEC-01 | Secure operational baseline | RLS/grants cover all exposed objects, service credentials stay server-only, SSRF/output injection tests pass, rate limits are server-enforced, and logs redact content and tokens. |
| SDD-01 | Traceable delivery | Each completed task links requirement IDs, changed code, test evidence, and updated docs; baseline modifications have a change spec/ADR when architectural. |

## Implementation traceability

Paths are relative to the repo root. Migrations are abbreviated by number (`0100` = `supabase/migrations/20260929000100_identity_workspaces.sql`, etc.). Evidence abbreviations:

- **db:** `pnpm test:db` (supabase/tests/db/rls_test.sql)
- **api:** `pnpm test:api` (scripts/api-test.mjs)
- **deno:** `pnpm test:functions`
- **vitest:** `pnpm test`
- **smoke:** hosted `scripts/smoke-hosted.mjs`

| ID | Implementation | Evidence | Status |
|---|---|---|---|
| AUTH-01 | 0100 (`bootstrap_user`, auth trigger, `ensure_bootstrap`); apps/web/src/App.tsx, apps/web/src/lib/google.ts (GIS + `signInWithIdToken`, hashed nonce) | db (idempotent bootstrap, one personal workspace); api/smoke (401 on missing/invalid JWT) | Bootstrap verified locally and hosted via dev password sign-in; **Google sign-in pending live Google** |
| TEAM-01 | 0100 (`create_workspace`, memberships, `is_member`); apps/web/src/components/Team.tsx, Shell.tsx | db; api (nonmember 404); smoke | Verified hosted (workspace-switch cache clearing not separately tested) |
| TEAM-02 | 0100 (`create_invite`, `accept_invite`, `set_member_role`, `transfer_owner`) | db (mismatch, unverified, reuse, expiry, role limits); smoke (invite/accept) | Verified hosted (concurrent acceptance not exercised in parallel) |
| TEAM-03 | 0100 (`remove_member`, owner consistency trigger); 0400 (`on_membership_removed`) | db (removal, owner invariants, job cancel); api (unexpired JWT); smoke | Verified hosted |
| UI-01 | supabase/functions/api/lib/providers.ts (Jev), shared/parse.ts (`keyword-v1`), apps/web/src/lib/stabilizer.ts, components/Composer.tsx | vitest (5); deno (keyword fallback); api (Jev event, request_seq); smoke (live Jev) | Verified hosted; routing accuracy pending M4.3 eval |
| CARD-01 | 0200 (`valid_card_payload`, card RPCs); shared/schemas.ts; components/CardFields.tsx, CardList.tsx | db (invalid payloads, stale revision); deno (schemas, DST, parsing); api (conflicts) | Verified locally |
| ACL-01 | 0100/0200/0300 RLS + Storage policies, `can_read` | db (admin vs private, nonmember, upload path scoping, anon denial); api/smoke (no private leakage) | Verified hosted |
| SRC-01 | 0300 (`create_upload_source`, `finalize_upload`, card trigger); lib/worker.ts; lib/google.ts (`driveFetchText`); components/Knowledge.tsx | db (type/size/empty, finalize requires object); api (valid md, invalid UTF-8 → `INVALID_UTF8`); smoke (indexing) | Upload/card verified hosted; **Drive import pending live Google** |
| RAG-01 | 0300 (`match_knowledge`, HNSW + GIN, RRF); lib/knowledge.ts (`search`) | db (keyword + hybrid authorization); api/smoke (no leakage) | Verified hosted; Recall@5 pending M4.3 eval |
| RAG-02 | lib/knowledge.ts (`generate`), shared/grounding.ts; components/Citations.tsx | deno (citations); api (citations, abstention, injection as data); smoke (grounded answer) | Verified hosted; supported-claim rate pending M4.3 eval |
| RAG-03 | 0300 (`worker_activate`, fencing, delete_source) | db (stale fence, incomplete chunks, activation); api (deletion hides immediately) | Verified locally (delete-during-embedding relies on `worker_activate` deleted check; no dedicated race test) |
| AI-01 | lib/knowledge.ts (strict schemas, retries, `GENERATION_INVALID`, `CONTENT_FILTERED` exclusion); lib/providers.ts | api (email recipients preserved, injection); deno (MIME/citations) | Verified locally |
| AI-02 | 0400 (`source_dependencies`, `create_generated_card`, `invalidate_dependents`); knowledge.ts (`private_required`, `recheck`) | db (private-only derived, sharing blocked, unshare invalidates); api (summary 404 for others, `private_required`) | Verified locally |
| GWS-01 | 0500 (connections, encrypted credentials, OAuth state RPCs); lib/google.ts (`connect`, `callback`, `accessToken`, `disconnect`); components/GooglePanel.tsx | db (account mismatch, svc denial, connection visibility); api (`RECONNECT_REQUIRED`) | **Pending live Google** |
| GWS-02 | lib/google.ts (`driveImport`, `sourceRefresh`); 0500 (`svc_drive_snapshot`, `svc_source_unavailable`) | none live | **Pending live Google** |
| GWS-03 | 0500/0700 (`action_prepare`, `action_claim`); lib/google.ts (`actionExecute` Gmail); shared/mime.ts; components/ActionDialog.tsx | db (idempotency, hash mismatch, duplicate claim, outcome_unknown); deno (MIME injection); api (header injection 422) | **Pending live Google** |
| GWS-04 | lib/google.ts (Calendar insert, deterministic ID, reconciliation); shared/parse.ts (IANA/DST) | db (claim semantics); deno (DST ambiguous/nonexistent) | **Pending live Google** |
| JOB-01 | 0300 (`private.jobs`, `worker_claim_jobs` SKIP LOCKED, lease/fence, backoff); 0600 (pg_cron `ingest-worker`, `kick_worker`); lib/worker.ts; `index-now`/`ingest-worker` routes | db (reclaim, stale fence, actor-removal cancel); api (worker 401); local cron → pg_net → worker 200; smoke (hosted indexing) | Verified hosted |
| OPS-01 | README hosted notes; scripts/local-vault.sh | hosted dev deployment via MCP only | **Not started** (M6: self-host install, backup/restore drills) |
| SEC-01 | RLS/grants in all migrations; 0400 `consume_rate_limit`; 0600 `svc_secret` allow-list; lib/core.ts (`requireUser`, constant-time worker token); googleapis-only fetch | db (grants, anon, svc/worker denial); bundle secret scan; `supabase db advisors --local` clean; hosted advisor reviewed | Verified locally; leaked-password protection off on hosted (operator) |
| SDD-01 | docs/STATUS.md, ADR-0001, this table, openspec tasks | — | In progress (M4.3 results and M6 outstanding) |

## Cross-cutting behavior

Authentication failures use 401; unauthorized or missing objects use a consistent 404 where existence is sensitive; invalid payloads 422; concurrency conflicts 409; rate limits 429. Never substitute empty search results for an infrastructure failure. Distinguish “no matches,” “still indexing,” “provider unavailable,” and “access removed.”

Authorization is evaluated at request admission and immediately before returning sensitive generation/action results. Membership removed during a provider call causes the result to be discarded. Bytes already delivered to a user cannot be recalled; do not claim retroactive erasure from their device.
