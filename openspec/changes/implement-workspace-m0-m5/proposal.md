# Proposal

## Why

The repository currently defines a complete product baseline but contains no application implementation, migrations, or integration tests. This change turns the documented M0–M5 milestones into a staged, verifiable implementation plan, beginning with compatibility evidence and ending with the MVP's Google integrations, without collapsing the work into a single untestable build task.

## What Changes

- Validate provider, runtime, embedding, Supabase, pgvector, job, and Google OAuth compatibility before dependent implementation; use Jev through the TypeSafe JavaScript SDK or its documented HTTP API if the SDK is incompatible with Deno.
- Evaluate the requested `word2vec` package and model for licensing, runtime/build support, stable fixed-dimension vectors, and retrieval quality before selecting an embedding profile or applying a vector migration.
- Build the React/TypeScript and Supabase foundation, Google sign-in, personal and team workspaces, membership/invitation lifecycle, database-enforced isolation, and optimistic card persistence.
- Deliver the adaptive card experience, bounded source ingestion, durable indexing, authorized hybrid search, cited generation, provenance/privacy propagation, and evaluation gates.
- Add incremental Google connections, selected Drive snapshot imports, confirmed Gmail draft creation, and confirmed primary Calendar event creation with idempotency and uncertain-outcome handling.
- Implement in dependency-ordered milestone slices, with the requirement-linked database/API, security, provider, and end-to-end verification for each slice.
- Exclude M6 operations/distribution/release work, including production Compose packaging, backup/restore drills, final release acceptance, and publication.

## Capabilities

### New Capabilities

- `provider-platform`: Server-side provider configuration, Jev classification boundary, validated embedding profiles, and portable Supabase execution constraints.
- `identity-workspaces`: Google-backed Supabase identity, personal/team workspaces, roles, invitations, removal, private/shared access, and tenant isolation.
- `adaptive-cards`: Jev-assisted adaptive input, deterministic/manual fallback, typed card persistence, and optimistic revision handling.
- `knowledge-rag`: Bounded source ingestion, durable indexing, authorized hybrid retrieval, citations, and revision/deletion correctness.
- `ai-assistance`: Explicit, schema-validated answer, summary, and email composition with evidence and visibility inheritance.
- `google-workspace`: Scoped account connections, selected Drive snapshots, Gmail draft-only action, and confirmed primary Calendar event creation.

### Modified Capabilities

None. The OpenSpec capability inventory is empty; the capabilities above establish the first OpenSpec behavior contracts from the normative requirements in `docs/REQUIREMENTS.md` and related specifications.

## Impact

Adds the planned `apps/web`, domain/AI packages, Supabase migrations/functions/tests, and end-to-end test surfaces described in `README.md`. It affects the API contracts, data model, provider and job architecture, privacy rules, and Google Workspace behavior in `docs/`. Dependencies include React/Vite/TypeScript, Supabase Auth/Postgres/pgvector/Storage/Edge Functions, TypeSafe/Jev, the evaluated `word2vec` package/model, and Google Identity/Drive/Gmail/Calendar APIs. M0–M5 completion does not claim M6 deployment portability or release readiness; those remain separate release-blocking work.