# Tasks

## 1. M0: Resolve compatibility and product defaults

- [ ] 1.1 (M0.1) Confirm the working name, license/copyright owner, MVP defaults, and exact development/runtime/container versions; record evidence and planned dependency locks in ADR-0001 and verify every selected version/license against upstream metadata.
- [ ] 1.2 (M0.2) Test TypeSafe `systemOne`/`jev-latest` in the target Deno runtime and evaluate the requested `word2vec` package plus an identified model for license, install/runtime support, stable finite dimensions, normalization, and synthetic retrieval; record the profile decision and sanitized results, with live Jev verification marked pending until `TYPESAFE_API_KEY` is installed server-side.
- [ ] 1.3 (M0.3) Verify hosted and self-hosted Supabase Edge Functions, required JWT/secrets behavior, pgvector dimension/index behavior, private job claim, scheduler fallback, and GIS-to-Supabase token exchange; use Supabase MCP only after confirming an authorized disposable development target, then record a compatibility matrix and exact check results.
- [ ] 1.4 (M0.4) Using a dedicated Google test account, verify GIS code grant, Picker `drive.file`, Gmail compose draft capability, and owned primary Calendar event compatibility; record scopes, audience/consent limits, and safe test evidence without general-user account mutations.

## 2. M1: Establish identity, teams, and first persisted card

- [ ] 2.1 (M1.1) Create the React/TypeScript/Vite, domain, and Supabase function workspace with pinned dependencies, CI scripts, and placeholder-only environment templates; verify clean dependency installation, build, lint, and typecheck.
- [ ] 2.2 (M1.2; AUTH-01) Implement Google identity sign-in exchanged for a Supabase session and idempotent profile/personal-workspace bootstrap; verify T01 including valid, canceled, invalid nonce/audience, expired session, and concurrent bootstrap cases.
- [ ] 2.3 (M1.3; TEAM-01, TEAM-02, TEAM-03, ACL-01, SEC-01) Implement team membership/roles, invite lifecycle, ownership protections, and RLS/grants in forward migrations; verify T02 and adversarial T03 through SQL and raw authenticated API tests, including stale-JWT removal and cross-workspace denial.
- [ ] 2.4 (M1.4; CARD-01, ACL-01) Implement private-by-default note CRUD, explicit owner visibility toggle, revision-checked optimistic edits, and conflict UI; verify save/reload/edit/conflict/delete behavior and prove admins/nonmembers cannot read private content.

## 3. M2: Deliver adaptive typed cards

- [ ] 3.1 (M2.1; UI-01) Implement the server-side Jev classifier adapter, typed/versioned intent schema, deterministic/manual fallback, latest-request-wins sequence handling, and visible provider status; verify T04 fixtures and T05 stale-response, manual-override, failure, and low-confidence cases, recording live Jev evidence when the secret is available.
- [ ] 3.2 (M2.2; CARD-01, UI-01) Add checklist, event, bookmark, and email card schemas and accessible palette/preview flows with deterministic parsing and timezone-aware dates; verify T06 valid/invalid payloads, stale revisions, date ambiguity, keyboard journey, and mobile layout.

## 4. M3: Store and search authorized knowledge

- [ ] 4.1 (M3.1; SRC-01, RAG-03, ACL-01) Add source, revision, chunk, and immutable embedding-profile schema plus private Storage policies and size/type constraints using the M0-selected vector dimension; verify migration constraints, profile mismatch rejection, and cross-user/workspace access tests.
- [ ] 4.2 (M3.2; SRC-01, JOB-01, SEC-01) Implement upload/finalize, bounded extraction/chunking, deduplicated leased/fenced jobs, batch embeddings, retries, and atomic revision activation; verify T07/T08 invalid uploads, partial failures, browser closure, worker crash/reclaim, stale fences, deletion, and actor removal.
- [ ] 4.3 (M3.3; RAG-01, RAG-03, ACL-01) Implement user-JWT authorized keyword/vector RPCs, ranking/fusion, evidence UI, and explicit keyword-degraded mode; verify T09 Recall@5 fixtures, unauthorized nearest-neighbor cases, filtered-index under-fill, and distinct database-failure behavior.

## 5. M4: Add grounded assistance and quality gates

- [ ] 5.1 (M4.1; RAG-02, AI-01, SEC-01) Implement explicit answer, selected-text summary, and email-draft generation with bounded context/output and strict schemas; verify T11 citations/abstention and T12 malformed output, prompt-injection, timeout, and recipient-integrity fixtures.
- [ ] 5.2 (M4.2; AI-02, RAG-03, ACL-01) Persist source provenance and enforce private-only derived visibility plus invalidation on source deletion/unsharing/access loss; verify T10 concurrent access-change cases and AI-02 proofs across database policies and APIs.
- [ ] 5.3 (M4.3; UI-01, RAG-01, RAG-02, AI-01) Build frozen and held-out synthetic classifier/RAG evaluation sets, record model/profile/chunker/prompt versions, and publish measured metrics and limitations; verify routing, Recall@5, supported-claim, abstention, and zero-leakage thresholds without substituting mock results for live connector evidence.

## 6. M5: Connect scoped Google Workspace actions

- [ ] 6.1 (M5.1; GWS-01, SEC-01) Implement one-use OAuth state, incremental capability consent, encrypted per-user token storage, refresh serialization, reconnect/disconnect, and account-subject checks; verify T13 denial, replay, mismatch, rotation, invalid_grant, disconnect, and no-secret-in-logs cases.
- [ ] 6.2 (M5.2; GWS-02, SRC-01, ACL-01) Implement Picker-selected Drive import and explicit refresh as private snapshots with sharing disclosure and permission revalidation; verify T14 supported/unsupported files, size limits, revoked access, no arbitrary-host fetch, and disconnect invalidation using test documents.
- [ ] 6.3 (M5.3; GWS-03, SEC-01) Implement immutable prepare/confirm action ledger and Gmail draft-only MIME adapter with no send endpoint; verify T15 exact content/account confirmation, Unicode and header validation, duplicate clicks, lost response/outcome_unknown, and no automatic retry against a dedicated test account.
- [ ] 6.4 (M5.4; GWS-04, SEC-01) Implement confirmed primary-calendar event creation with IANA timezone validation and deterministic event-ID recovery; verify T16 DST ambiguity, no attendees, changed/expired confirmation, timeout reconciliation, duplicate confirmation, and ownership against a dedicated test account.