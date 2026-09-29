# ShapeShift-inspired Workspace — SDD package

Version: 0.1 · 29 September 2026 · Status: proposed implementation baseline

**A self-hostable, open-source team workspace where one input becomes the right tool: a note, checklist, event, search result, or grounded email draft.** “ShapeShift-inspired Workspace” is a descriptive placeholder, not a final product name or a claim of affiliation.

This repository package contains specifications, not a running application. No application, infrastructure, credentials, or Google integrations have been provisioned. Commands in the implementation plan are contracts for the future repository, not commands that work in this document-only package.

## Product decisions

- Preserve an adaptive input and structured cards; use Jev for classification.
- Supabase owns Auth, Postgres, pgvector, Storage, and server functions. No separate Go, Java, or Express CRUD service.
- RAG storage and retrieval run in PostgreSQL/pgvector. No browser vector database.
- Use an LLM for grounded answers, summaries, and email composition, only on explicit invocation.
- Support personal and team workspaces with database-enforced access control.
- Google sign-in is distinct from granting Drive, Gmail, or Calendar access.
- MVP Google integration: import selected Drive documents, save Gmail drafts, create personal Calendar events.
- Support a Docker-based self-hosted Supabase installation, as well as hosted Supabase.

## Read in this order

1. [Product and MVP](docs/PRODUCT.md)
2. [Requirements and acceptance criteria](docs/REQUIREMENTS.md)
3. [Architecture](docs/ARCHITECTURE.md)
4. [Data model and permissions](docs/DATA_MODEL.md)
5. [RAG specification](docs/specs/RAG.md)
6. [Google Workspace specification](docs/specs/GOOGLE_WORKSPACE.md)
7. [API contracts](docs/API_CONTRACTS.md)
8. [UX and adaptive input](docs/UX.md)
9. [Security and operations](docs/SECURITY_OPERATIONS.md)
10. [Verification and traceability](docs/VERIFICATION.md)
11. [Milestones and tasks](docs/IMPLEMENTATION_PLAN.md)
12. [Decision record](docs/adr/0001-baseline.md)
13. [Agent workflow](AGENTS.md), [handoff](docs/STATUS.md), [change template](docs/templates/CHANGE_SPEC.md)
14. [Sources and upstream assessment](docs/SOURCES.md)

## First implementation slice

Complete M0 compatibility checks, then M1: Google sign-in → personal workspace → team creation and invitation → save/edit one note → prove another user cannot access it. Do not start with Gmail or an unconstrained chat agent. Use the requirement IDs in PRs and implement one milestone-sized slice at a time.

## Proposed repository layout

```text
apps/web/                     React + TypeScript + Vite frontend
packages/domain/              card schemas, parsers, classifier contracts
packages/ai/                  prompts, provider interfaces, evaluation fixtures
supabase/migrations/          schema, RLS, RPCs, indexes, queue setup
supabase/functions/           Jev, RAG, LLM, OAuth, Google actions, workers
supabase/tests/               database and tenant-isolation tests
tests/e2e/                    browser journeys
infra/                       production Compose, proxy, backup guidance
docs/                        this specification set
```

Suggested toolchain: pnpm, Node.js 24 LTS for development/build, TypeScript strict, React, Vite, Tailwind, shadcn/ui, Zod, Supabase JS, Deno for Edge Functions, Vitest, Playwright, and pgTAP. Pin exact compatible versions and container digests in M0. Jev SDK compatibility with Deno is a mandatory spike; use its documented HTTP interface if needed. Do not invent a provider endpoint.

## Open-source and distribution

Proposed project license: MIT, with the actual copyright holder set before publication. Keep upstream copyright and license notices when reusing code; record reused files and revisions in THIRD_PARTY_NOTICES.md. Verify all dependency licenses. A publicly available model API is not assumed to be open source or included in the application license. Self-hosting the app does not imply Jev, Google, or a chosen LLM runs locally.

## Implementation status

All requirements and tasks are **not implemented**. User-mandated choices are separated from proposed defaults in the ADR. Review the defaults before their milestone; do not treat document creation as implementation approval of every optional capability.
