# Durable project status

Updated: 2026-09-29

## Current state

M0–M5 are implemented as one OpenSpec change (`openspec/changes/implement-workspace-m0-m5`). Everything that does not need Google has been verified locally, and a core subset has been verified on the hosted dev Supabase project. The Google Workspace flows (sign-in, consent, Picker, Drive, Gmail, Calendar) are coded and unit/negative-tested, but **they have not been live-verified** because there is no Google OAuth client or test account yet. M6 (operations, self-host distribution, backup/restore, release) has not started.

## Session ledger — 2026-09-29

- **Active task and requirement IDs:** closing the implement-workspace-m0-m5 documentation and evidence for M4.3 evaluation (UI-01, RAG-01, RAG-02, AI-01) and SDD-01.
- **Completed behavior (implemented and verified locally):**
  - AUTH-01: session bootstrap and personal workspace, via dev password sign-in. The Google sign-in path is pending live verification.
  - TEAM-01, TEAM-02, TEAM-03
  - UI-01
  - CARD-01
  - ACL-01
  - SRC-01 (upload, card, and Drive code paths; Drive is pending live verification)
  - RAG-01, RAG-02, RAG-03
  - AI-01, AI-02
  - JOB-01
  - SEC-01 (except live Google token handling)
- **Verified on the hosted dev project:** TEAM-01/02/03 (team, invite, accept, removal), 401 boundaries, UI-01 (live Jev), SRC-01/JOB-01 (indexing with embeddings via cron worker), RAG-01 (hybrid search without private leakage), RAG-02 (grounded answer via gpt-4.1-mini with citations).
- **Pending live Google:** AUTH-01 (GIS sign-in), GWS-01, GWS-02, GWS-03, GWS-04.
- **Not started:** OPS-01 (M6: self-host, backup/restore drills).
- **Commits:**
  - `3019de4` feat(db,functions): migrations 0100–0600 and the single `api` Edge Function
  - `decf73f` test(api): raw API tests and shared Deno tests
  - `5477cb2` feat(web): React SPA
  - `dc4d2eb` fix(actions): `action_claim` (migration 0700) and the hosted smoke test

### Verification commands and results (local unless noted)

| Command | Result |
|---|---|
| `pnpm test:db` (supabase/tests/db/rls_test.sql) | `ALL DB TESTS PASSED`. Adversarial cross-user/cross-workspace SQL covering: invites (email mismatch, unverified, reuse, expiry), roles, owner-transfer invariants, private cards vs. admins, fencing/reclaim/stale activation, keyword + hybrid search authorization, derived-card invalidation, upload path scoping, action idempotency/claim/outcome_unknown, service-function denial, anon denial |
| `pnpm test:api` (scripts/api-test.mjs, live Jev/LLM/embeddings) | 15/15 passed. Covers: 401/404/422 envelopes; Jev event classification; private-by-default and conflicts; upload of valid md and of invalid UTF-8 → failed `INVALID_UTF8`; hybrid search without leakage; grounded answer with citations and `private_required`; abstention; prompt injection treated as data; email recipients preserved; summary 404 for others; Google actions `RECONNECT_REQUIRED`; header injection 422; worker 401; removal with an unexpired JWT; deletion hides immediately |
| `pnpm test:functions` (Deno) | 10 passed: DST ambiguous/nonexistent, event parsing, checklist parsing, schemas, keyword fallback, chunker, citations, MIME header injection |
| `pnpm test` (Vitest) | 5 passed (classifier stabilizer: thresholds, stale responses, near-ties, hysteresis) |
| `pnpm --filter @app/web typecheck`, `pnpm lint`, `pnpm build` | pass; built bundle scanned for secrets: none |
| `supabase db advisors --local` | no issues |
| Manual browser check | sign-in (password), Jev event preview, save, search, Ask with citations |
| Hosted: `node --env-file=.env.hosted scripts/smoke-hosted.mjs` | PASSED (team/invite/accept, 401 boundaries, Jev live event, indexing with embeddings, hybrid search without private leakage, grounded answer with citations, removal enforced) |
| Hosted: Supabase security advisor | 22 WARN `authenticated_security_definer_function_executable` (intentional narrow RPCs with `auth.uid()`/membership checks); leaked-password protection disabled (dashboard setting) |

### Evaluation results (M4.3)

**Pending.** Another work stream is producing the evaluation. Results will be recorded here from `eval/results/` (dataset `eval/dataset.json`, runner `scripts/eval.mjs`), with model/profile/chunker/prompt versions. No metrics have been measured yet, and none are claimed.

### Failed or skipped checks and reason

- **Google live checks (T01 GIS path, T13–T16 live):** skipped because there is no Google OAuth client or dedicated test account. The code paths are covered by negative tests only: no connection → `RECONNECT_REQUIRED`, header injection → 422.
- **Self-hosted (non-CLI) Supabase install (T17):** not attempted (M6.2).
- **Playwright E2E (`pnpm test:e2e`), pgTAP, performance/latency (T18):** not implemented. DB tests are plain psql assertions.
- **Concurrency tests:** simultaneous invite acceptance, concurrent bootstrap, and concurrent owner transfer are not exercised with parallel sessions. Row locks, unique indexes, and deferred owner triggers exist, and sequential cases are tested.
- **Filtered-HNSW under-fill (T09):** mitigated with `hnsw.iterative_scan=relaxed_order`, but no dedicated fixture yet.
- **Keyboard, screen-reader, and mobile layout (T05/T06):** not formally verified.

### Specification and ADR changes

- ADR-0001: new "M0 outcomes" section covering pinned versions, provider decisions (Jev `jev-1.13.0`, `gpt-4.1-mini`, `text-embedding-3-small`/1536; word2vec superseded by the user) and nine recorded deviations: single `api` function, upload RPCs, POST callback, Vault secrets, pg_cron scheduler, dev password auth, `action_claim`, chunker, content-filter retry.
- API_CONTRACTS.md now matches the implemented routes, RPCs, error codes, and SQLSTATE mapping.
- README quick start, REQUIREMENTS status/traceability, and openspec tasks were updated.

### Remaining uncertainties and blockers

- The Google OAuth client and a test account are needed for M0.4/M5 live verification. The Google deployment audience and restricted-scope (`gmail.compose`) verification are unresolved.
- The license copyright holder and final product name are unresolved.
- Hosted migration history uses MCP apply timestamps, not the local file versions. Reconcile before any `supabase db push`.
- Leaked-password protection is off on hosted (operator dashboard action).

### Exact next actions

1. Record the M4.3 evaluation results from `eval/results/` in the section above, and tick task 5.3 only if the thresholds are met with live providers.
2. Operator: create a Google OAuth Web client and a dedicated test account, configure the Supabase Google provider, and set `GOOGLE_CLIENT_ID/SECRET/API_KEY/APP_ID` (env or Vault) plus `VITE_GOOGLE_CLIENT_ID`. Then run the T01 and T13–T16 live checks and tick 1.4 and 6.1–6.4 when they pass.
3. Operator: enable leaked-password protection on the hosted project, and disable `VITE_ENABLE_PASSWORD_AUTH` for any non-development build.
4. Decide the license holder and name (task 1.1).
5. Start M6: self-hosted Compose install with pinned image digests (T17), backup/restore drill and load fixture (T18), workspace purge job, Playwright journeys, and a CI workflow running `pnpm check` + `pnpm test:db`.

## Session ledger template

- Active task and requirement IDs:
- Completed behavior and commits:
- Verification commands/results:
- Failed/skipped checks and reason:
- Specification/ADR changes:
- Remaining uncertainties/blockers:
- Exact next action:

## Known limitations

- Google integrations are unverified live.
- Performance and quality thresholds are targets, not measurements, until M4.3 and T18 results are recorded.
- Workspace deletion only marks the workspace `deleting`, which removes access. Asynchronous purge of blobs and vectors is not implemented (M6.1).
- Drive imports are point-in-time snapshots, not live ACL synchronization.
