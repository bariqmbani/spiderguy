# Design

## Context

See proposal.md for motivation and scope. The current repository is a specification package with no application source, tests, migrations, credentials, or provisioned Google integration. The detailed system boundaries and data/authorization contracts are in `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/specs/RAG.md`, and `docs/specs/GOOGLE_WORKSPACE.md`; the capability specs in this change are the observable contracts.

## Goals / Non-Goals

**Goals:**
- Deliver M0–M5 as dependency-ordered vertical slices with a passing gate before downstream work starts.
- Keep Postgres/RLS as the tenant authorization boundary and use the user's JWT for browser CRUD and retrieval.
- Keep provider and Google credentials server-side, and treat provider output as untrusted data.
- Resolve SDK/runtime, embedding profile, and deployment compatibility before migrations depend on them.
- Preserve the documented private-by-default, explicit-sharing, snapshot, and confirmed-action semantics.

**Non-Goals:**
- M6 production packaging, operational limits/retention rollout, backup/restore drill, final release, or publication.
- Browser-side vector storage, a separate CRUD backend, arbitrary agent tools, Gmail reading/sending, broad Drive crawling, or implicit team sharing.
- Selecting an untested replacement embedding model or changing the vector dimension solely to make the initial migration easier.

## Decisions

### 1. Establish a compatibility gate before implementation

M0 pins exact tool/runtime/container versions and records evidence for TypeSafe SDK/Deno use (with only the documented TypeSafe HTTP contract as fallback), the requested `word2vec` package and identified model, Supabase hosted/self-host behavior, pgvector indexes, private job claim/scheduler, and GIS/Google API contracts. The Jev key is an operator-provided server secret; until supplied, only fixture/request-shape checks can pass. The `word2vec` profile is accepted only after license, build/runtime, dimension, finite-vector, repeatability, normalization, and synthetic retrieval checks. No provider or vector-profile substitution is implicit.

### 2. Build one static SPA and one Supabase data plane

Use React, TypeScript, and Vite for the browser application. Use Supabase Auth, Postgres, RLS, Storage, RPCs, and Edge Functions; do not add a separate business CRUD server. Keep shared schemas Deno-compatible. Browser CRUD and user retrieval use supabase-js under the active user's JWT. Narrow transactional RPCs handle sensitive multi-row operations. Edge Functions derive actor identity from a verified Supabase JWT and recheck live authorization. Privileged access is limited to token handling and bounded internal jobs/actions after independent authorization.

### 3. Sequence the product by persisted behavior and trust boundary

- **M1:** create the workspace/CI baseline, Google identity-to-Supabase session flow, idempotent personal workspace, then team membership and RLS tests before shared data; finish with private note CRUD and optimistic conflicts.
- **M2:** add the classifier proxy/fallback and versioned card schemas, then the supported card palette and deterministic date/input parsing. Classifier output selects a preview only.
- **M3:** add source/revision/profile schema and private Storage first, then a leased/fenced idempotent indexing worker, then authorized keyword/vector search and evidence display.
- **M4:** add explicit answer/summary/email generation over retrieved evidence, validate citations and recheck access, propagate source visibility to derived content, then run frozen and held-out quality evaluations.
- **M5:** add OAuth state/token encryption and incremental scopes, then selected Drive snapshots, Gmail draft-only actions, and confirmed primary Calendar actions. Each action uses an immutable server snapshot, permission and confirmation gates, idempotency, and connector-specific unknown-outcome recovery.

Each milestone lands its own migrations, tests, documentation, and traceability before its dependent milestone. Do not create empty integration shells for later milestones.

### 4. Make tenant and source authorization structural

Use composite workspace-scoped foreign keys where needed, separate RLS policies for each operation, private-schema authorization helpers with fixed search paths, and invoker-rights search RPCs. Keep source active-revision pointers, ownership, visibility, job state, and action state out of direct browser writes. Evaluate current membership and source state in retrieval SQL before ranking and again before returning. Never query all tenants and filter in application code.

### 5. Make ingestion at-least-once and activation atomic

Persist source revision plus deduplicated job in one transaction. Workers claim with `FOR UPDATE SKIP LOCKED`, lease expiry, attempt limits, and a monotonically increasing fence. Process bounded extraction/embedding batches and upsert chunks by revision/ordinal. A source revision becomes active only when all chunks are valid and the source, actor, and fence are still current. An old active revision may remain available during refresh, but deletion or access revocation blocks it immediately. Hosted Cron and an operator scheduler must call the same authenticated bounded worker path.

### 6. Separate identity login from Google API authorization

Use GIS identity sign-in exchanged for a Supabase app session. Request Drive/Gmail/Calendar authorization independently per capability using validated one-use state and server-side code exchange. Encrypt refresh credentials with operator-managed keys and keep them private to their owner. Drive imports are selected snapshots, not live ACL mirrors. Gmail confirmation creates drafts only; do not expose send APIs. Calendar actions create only confirmed primary-calendar events without attendees or recurrence.

### 7. Treat generated content as a proposal with provenance

Generation is an explicit request using at most the authorized retrieved evidence and fixed context/output limits. Validate a strict response schema, each citation against the retrieval result, and exact quoted substrings. Recheck membership, source revisions, and dependencies immediately before returning. Generated cards store source dependencies and cannot be shared if any source remains private. Model output never chooses unrestricted URLs, executes tools, or supplies authoritative recipients.

### 8. Use forward-only schema evolution

Apply additive reviewed migrations in the local development stack first; exercise them against a disposable hosted or self-hosted development project through Supabase tooling/MCP only after confirming its identity. Never change an applied migration in a shared environment or touch production without explicit authorization. If the validated embedding profile changes after a migration, add a forward migration/new vector storage and re-embedding plan. RLS changes include cross-user and cross-workspace SQL/API tests in the same slice.

## Risks / Trade-offs

- [TypeSafe's Node SDK does not run in Deno] -> Prove support in M0 and use only the documented HTTP contract if that is the validated alternative.
- [`word2vec` does not provide suitable document embeddings, model licensing, or Deno support] -> Keep M0 as a hard gate; request an explicit provider/profile decision rather than changing the requirement silently.
- [Google consent verification blocks broad distribution] -> Use permitted test-account configurations during M0/M5 and document the audience limitation; release remains M6 work.
- [RLS joins and approximate vector indexes under-fill results] -> Filter before ranking, test adversarial nearest neighbors, and use supported iterative scans or bounded exact authorized fallback.
- [External action outcome is uncertain after timeout] -> Never promise exactly-once Gmail creation; store an unknown state and require reconciliation, while Calendar uses a tested deterministic event ID.
- [M0–M5 is too large for one implementation pass] -> Tasks remain milestone-sized; apply should stop at each milestone gate and resume with the next task only after evidence is recorded.
- [M6 is excluded] -> M0–M5 can produce a functioning development MVP but does not establish production release readiness or operational compliance.

## Migration Plan

1. Complete M0 evidence and update the ADR before dependent schema choices.
2. Build M1 locally; apply additive auth/profile/workspace/membership/card migrations and run RLS/API tests against local Supabase.
3. Add M2 card changes and M3 sources, revisions, embedding profile, chunks, jobs, RPCs, and indexes as new forward migrations; validate against disposable targets before any shared deployment.
4. Add M4 provenance/usage/generation contracts and M5 private OAuth/action-ledger schema with adversarial and failure-path tests in the same milestones.
5. Keep rollback data-preserving: deploy compatible code and forward migrations; do not drop user data to reverse a failed rollout. Production rollout, backup/restore, and deployment runbooks are deferred to M6.

## Open Questions

- Which exact `word2vec` model artifact and license is acceptable for redistribution and self-hosted installation? M0 must resolve this before selecting the vector profile.
- Which disposable Supabase project is authorized for MCP-based development validation? Confirm its environment and project identity before any write.
- Which Google OAuth audience and consent configuration will be available for testing? M0.4 records limitations; broad-production verification remains outside this change.