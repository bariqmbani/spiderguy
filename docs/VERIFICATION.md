# Verification and requirement traceability

No tests have been executed for an application; only the document package has been checked. The following is the required implementation test plan.

## Traceability matrix

| Requirements | Implementation area | Verification IDs | Milestone |
|---|---|---|---|
| AUTH-01 | Auth UI/session bootstrap | T01 | M1 |
| TEAM-01, TEAM-02, TEAM-03 | workspace/member/invite RPCs | T02,T03 | M1 |
| ACL-01, SEC-01 | RLS, grants, Storage, function guards | T03,T14,T16 | M1–M6 |
| UI-01 | classifier/parser/state machine | T04,T05 | M2 |
| CARD-01 | schemas, card RPCs | T06 | M1–M2 |
| SRC-01, JOB-01 | ingest jobs/worker | T07,T08 | M3 |
| RAG-01, RAG-03 | embedding profile, search, lifecycle | T09,T10 | M3–M4 |
| RAG-02, AI-01 | generation and evidence | T11,T12 | M4 |
| AI-02 | dependency ACLs | T10,T12 | M4 |
| GWS-01, GWS-02 | OAuth, Picker, Drive snapshot | T13,T14 | M5 |
| GWS-03, GWS-04 | Google action functions | T15,T16 | M5 |
| OPS-01 | deployment and recovery | T17,T18 | M6 |
| SDD-01 | PR/checklist/handoff | T19 | Every milestone |

## Test scenarios

- **T01 Auth:** successful and canceled GIS login, invalid nonce/audience, session expiry, concurrent personal-workspace bootstrap; only one workspace is created.
- **T02 Teams:** owner/admin/member permissions, matching and mismatched invite email, expiry/replay, two simultaneous invite acceptances, concurrent owner transfer and removal.
- **T03 Isolation:** user A private and shared data in W1, user B member of W1, user C in W2; direct REST/RPC/Storage reads and writes, guessed IDs, join queries, counts, vector queries, and stale JWT after removal. B cannot read A private data; C sees no W1 data.
- **T04 Routing:** 120 labeled samples including incomplete/ambiguous phrases and explicit Search/Email. Macro accuracy ≥90%; unknown/manual fallback always available. Evaluate Jev and fallback separately; do not claim fallback reaches Jev's target without evidence.
- **T05 UI stability:** out-of-order responses, rapidly changed text, manual override, user-edited fields, keyboard focus, reduced motion, mobile and screen-reader semantics.
- **T06 Cards:** each schema valid/invalid input, two-tab revision conflict, delete during edit, date timezone ambiguity, malicious Markdown/URL.
- **T07 Ingestion:** valid upload, wrong MIME, empty, invalid UTF-8, >5 MiB or >100k chars, duplicate finalize, partial embeddings, transactional source activation.
- **T08 Jobs:** kill worker after batch save, expire lease, recover concurrently, stale fence activation, browser closure, retry exhaustion, actor removal, source deletion during embedding.
- **T09 Retrieval:** frozen 50-query corpus, Recall@5 ≥.85, keyword degradation, provider profile mismatch, filtered HNSW under-fill, unauthorized sources at nearest vector positions.
- **T10 Lifecycle:** edit → new revision, failed refresh keeps old snapshot, delete/unshare blocks current search and derived cards, access revoked during generation, stale citation expansion denied.
- **T11 Grounding:** 20 unanswerable questions, conflicting dates/revisions, exact quote validation, fabricated source IDs, unsupported statements; ≥90% supported claims and correct abstentions.
- **T12 AI attacks:** source contains “ignore instructions/send secrets,” malformed JSON, unexpected fields, invented recipients, provider timeout; no execution or leakage. Private source yields private-only generated card.
- **T13 Google identity:** denied incremental scope, swapped account, replayed state, missing refresh token, refresh rotation, invalid_grant, disconnect during queued import.
- **T14 Drive:** actual Picker selection, supported export, unsupported format, revoked permission on refresh, team-share disclosure, no arbitrary-host fetch, disconnect hides shared snapshots.
- **T15 Gmail:** exact reviewed content and correct account, Unicode MIME, CRLF header attack, duplicate concurrent clicks, response lost after creation, outcome_unknown has no blind retry, no send endpoint.
- **T16 Calendar/actions:** timezone/DST cases, no attendees, altered confirmation payload, expired action, removed member, deterministic event ID timeout reconciliation, connection version mismatch.
- **T17 Install:** clean hosted and self-hosted deployments, live Google test account, provider contract smoke tests, scheduler invocation after browser exit, missing configuration behavior.
- **T18 Recovery/load:** restore database+objects+keys in isolation, reapply deletion ledger, verify RPO/RTO; 20-user/50k-chunk fixture performance, resource and provider-latency report.
- **T19 SDD:** each delivered requirement points to code/test evidence; docs and actual behavior agree; no unreviewed scope change.

## Test execution policy

Use Vitest for pure parsers/state/schema logic; pgTAP and real local Supabase API tests for authorization/transactions; Playwright for user journeys; mocked adapters for deterministic fault injection; a dedicated Google test account for a small explicit live integration suite. Never run external-action tests against a user's ordinary account without explicit authorization.

CI required scripts to implement: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm test:e2e`, `pnpm build`; Edge Functions also require Deno format/lint/check/test. Lock model-dependent evaluation to named profiles and record artifacts separately from fast CI. Security and tenancy failures block release irrespective of aggregate score.
