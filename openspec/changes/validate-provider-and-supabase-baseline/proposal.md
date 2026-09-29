# Proposal

## Why

The project has no application implementation yet, and its first implementation milestone depends on provider and platform assumptions that have not been tested. Validate the required Jev/TypeSafe, `word2vec`, Supabase Edge Functions, and pgvector contracts before committing to a schema, runtime, or dependency set.

## What Changes

- Run bounded M0 compatibility spikes for the official TypeSafe JavaScript SDK and documented Jev HTTP API in the intended Supabase function runtime.
- Evaluate the requested `word2vec` npm package for install/runtime support, license compatibility, text-to-vector behavior, dimensionality, and suitability for the proposed pgvector profile.
- Verify the selected Supabase hosted/self-hosted database and function capabilities needed by the first vertical slice, using Supabase MCP only against an explicitly selected development project.
- Record sanitized evidence, exact versions, resolved provider choices, unresolved constraints, and the resulting embedding profile decision in the existing ADR and status handoff during implementation.
- Keep production schema changes, credential provisioning, and user-facing feature implementation out of this M0 change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change validates implementation constraints and updates planning decisions only; it does not change observable product behavior.

## Impact

Impacts M0.1–M0.3 in `docs/IMPLEMENTATION_PLAN.md`, provider/runtime assumptions in `docs/ARCHITECTURE.md`, the proposed embedding profile in `docs/DATA_MODEL.md`, deployment constraints in `docs/SECURITY_OPERATIONS.md`, and the decision record in `docs/adr/0001-baseline.md`. No production database, application code, or credentials are changed by this proposal.