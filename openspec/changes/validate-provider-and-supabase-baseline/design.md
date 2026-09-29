# Design

## Context

See proposal.md for motivation and scope. There is no application code or configured deployment to extend yet. The design documents define Jev as the classifier, Supabase Edge Functions as the provider boundary, Postgres/pgvector as the authorized vector store, and a proposed 1536-dimensional profile that must be validated before migrations.

## Goals / Non-Goals

**Goals:**
- Produce reproducible compatibility evidence for the named SDK, embedding package, and Supabase capabilities on the pinned target versions.
- Make the embedding profile decision from actual output dimensions, licensing, operational fit, and a small synthetic retrieval fixture rather than package naming or assumptions.
- Keep every credential server-side and make the Jev live-call check independently runnable once an operator supplies the key.
- Use Supabase MCP for database inspection and disposable development validation, without risking production data.

**Non-Goals:**
- Building product features, applying a production migration, creating cloud resources, or configuring production secrets.
- Replacing Jev or `word2vec` with an unrequested provider if either fails the compatibility gate.
- Completing Google compatibility work from M0.4.

## Decisions

1. **Validate the TypeSafe JavaScript SDK in the actual function runtime before adopting it.** Record pinned package/runtime versions and execute a bounded `systemOne` call contract test. If the SDK cannot run reliably in Deno, test the documented TypeSafe HTTP contract with Deno `fetch`; do not invent a different endpoint or payload. Until the Jev key is provided, validate request construction and typed parsing with sanitized fixtures, mark the live provider call pending, and rerun it after the key is installed as a server secret.

2. **Treat `word2vec` as an experimental embedding implementation, not as proof of a sentence-embedding contract.** Pin the npm release; inspect its source and license; verify install hooks and target-runtime support; identify the exact vector model and dimensions; define deterministic tokenization, aggregation/pooling, out-of-vocabulary handling, and normalization; and run repeated-output and retrieval checks on synthetic text. Do not choose a pgvector dimension until this produces a finite, stable vector profile. If its required model, license, runtime, or retrieval behavior is unsuitable, record the blocker and request a decision; do not silently substitute another model or change the proposed 1536 dimension.

3. **Use a disposable Supabase development target through Supabase MCP for the platform check.** First confirm target identity and version and use read-only inspection. Any DDL or job/scheduler experiment must be confined to a disposable development database explicitly selected for this work. Verify pgvector extension/type/index support, function runtime and secrets behavior, and the private job-claim/scheduling path required by the architecture. Do not apply experiments to hosted production or a shared self-hosted database.

4. **Keep evidence free of secrets and user content.** Store exact versions, environment details, test commands, pass/fail results, synthetic fixture identifiers, and sanitized provider status only. Jev keys and raw prompts/responses are not written to the repository, logs, or ADR.

5. **Update durable decisions only after evidence exists.** In the implementation phase, update ADR-0001 and docs/STATUS.md with verified compatibility, selected vector dimensions/profile, known limitations, exact next milestone, and skipped/pending checks. Keep proposed decisions labeled until validated. No applied migration is part of this change.

## Risks / Trade-offs

- [SDK works in Node but not Deno] -> Test in the deployed Edge runtime; retain only the documented HTTP fallback if validated.
- [No Jev key is available during the first spike] -> Complete offline contract validation and clearly leave the live call pending; rerun the live smoke test when the operator provisions the secret.
- [`word2vec` package or model cannot produce appropriate document vectors] -> Fail the profile gate and preserve the decision for user review; do not force a schema dimension or hide a replacement.
- [Package license or native build requirements conflict with distribution/runtime] -> Record license and deployment findings before dependency adoption; exclude the package if redistribution or deployment is not acceptable.
- [Wrong Supabase project is selected] -> Confirm project identity and environment before any MCP write; restrict experiments to a disposable development database and stop if that cannot be established.
- [Self-hosted and hosted capabilities differ] -> Record a compatibility matrix and required operator scheduler fallback; do not claim portability based on hosted-only success.

## Migration Plan

No production migration is created or applied by this change. Any temporary database objects used by the spike are created only in the confirmed disposable development target and removed after evidence is captured. The later M1/M3 migrations must use the profile and platform decisions recorded here; if profile selection changes after a migration exists, use a forward migration and re-embedding plan rather than editing an applied migration.

## Open Questions

- Which Supabase development project is disposable and authorized for MCP validation? Resolve its identity before any write-capable database test.
- Which exact word2vec model/artifact and distribution license can be used? The package alone does not identify a model file or its redistribution terms.