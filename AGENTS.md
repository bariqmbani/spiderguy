# Agent working agreement

## Mission and source of truth

Build the product described by docs/PRODUCT.md using the acceptance criteria in docs/REQUIREMENTS.md. The user’s current instructions override this document. Explicitly requested constraints: ShapeShift-like interaction, Jev classification, Supabase backend and pgvector store, LLM reasoning/composition, Google Workspace integration, team workspaces, OSS/self-hosting. No browser RAG or separate CRUD backend.

Read README.md, docs/STATUS.md, the active milestone, and relevant specifications before editing. Read DATA_MODEL.md before any persistence or authorization work. For conflicts, identify them and update the affected spec/ADR before broad implementation; do not silently substitute a different architecture.

## Work loop

1. Select the earliest unblocked task from IMPLEMENTATION_PLAN.md.
2. Restate requirement IDs, scope, acceptance criteria, dependencies, and verification plan in the task/PR.
3. Resolve repository and provider compatibility facts. Do not fabricate SDK APIs or commands.
4. Implement the smallest end-to-end increment. Include the migration, policies, contract, and meaningful tests together when they form one behavior.
5. Run applicable checks. Record exact commands and outcomes, including skipped checks and why.
6. Update traceability, STATUS.md, and any changed specifications. Commit small coherent changes with Conventional Commits.
7. Report observable behavior and remaining risks. Never mark work complete solely because code compiles.

## Boundaries

- Frontend may contain only public configuration. Provider keys, Google refresh tokens, worker credentials, and Supabase privileged keys stay server-side.
- Treat workspace_id, card_id, source_id, and all model outputs as untrusted input. Authorize each object server-side and through RLS.
- Do not rely on a client filter for team isolation. Do not use service-role retrieval in user search or RAG.
- Classifier output selects UI only. It cannot authorize persistence, sharing, generation, or Google actions.
- LLMs produce schema-validated proposed content. They do not run SQL, choose unrestricted URLs, or execute external tools.
- Search results and citations must be checked against current source access and source revision.
- Never add Gmail send, broad Drive crawling, attendees/invitations, or implicit team sharing as “helpful” extras.
- Google imports are explicit snapshots. Do not describe them as live ACL synchronization.
- Make asynchronous operations resumable and idempotent. Do not blindly retry an uncertain Gmail draft creation.
- Store timestamps in UTC and retain IANA time zones. Use decimal/minor-unit arithmetic for money.
- Do not modify production schemas or publish releases without the authorization required by the current session.

## Required gates

Every RLS change requires adversarial cross-user and cross-workspace SQL/API tests. Every external action requires permission, confirmation, failure, and duplicate-submission tests. Every AI behavior change requires fixture or evaluation results; a successful example is insufficient.

Never edit applied migrations in shared environments. Add forward migrations; document backfill and rollback/roll-forward. Preserve user edits with optimistic concurrency. Keep content/tokens out of logs and fixtures. Use synthetic evaluation data.

## Context and handoff

Update docs/STATUS.md after each work session: active task; completed requirement IDs; commits; test evidence; decisions; known failures; next exact action. Keep design rationale in ADRs and durable product facts in specs, not only chat or an agent scratchpad. Do not record credentials or personal customer data. Do not delegate to additional agents unless the user or repository instructions authorize it.
