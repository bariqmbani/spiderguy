# Tasks

## 1. Provider and embedding compatibility

- [ ] 1.1 Record exact TypeSafe SDK, Node, Deno, Supabase Edge Runtime, and `word2vec` package versions plus upstream license/source evidence in an M0 compatibility report; verify all cited versions and license identifiers against upstream metadata.
- [ ] 1.2 Run a bounded TypeSafe `systemOne` contract test in the target Edge runtime, first with a sanitized fixture and then with a live Jev request when the operator installs `TYPESAFE_API_KEY` as a server secret; record typed response, timeout, and sanitized failure behavior without logging key or prompt content.
- [ ] 1.3 If the TypeSafe SDK fails in Deno, test only the documented TypeSafe HTTP request using Deno `fetch`; compare results and record which adapter is viable, verifying the request shape against the official quickstart and the same response contract fixture.
- [ ] 1.4 Evaluate the pinned `word2vec` package and an explicitly identified model for license, native install/runtime requirements, dimensions, deterministic tokenization/pooling, OOV behavior, finite normalized output, and synthetic retrieval quality; attach reproducible test results and do not change the proposed pgvector dimension or substitute a provider without an approved decision.

## 2. Supabase and pgvector compatibility

- [ ] 2.1 Use Supabase MCP to identify the target project's environment and database/runtime versions before inspection; if no explicitly authorized disposable development target is available, perform read-only checks only and record write tests as blocked rather than selecting a project implicitly.
- [ ] 2.2 On the confirmed disposable development database only, verify pgvector extension availability, supported vector dimensions, index/operator support, and profile mismatch rejection; capture sanitized SQL/API results and remove temporary test objects.
- [ ] 2.3 Verify the required Edge Function secret handling, private job-claim behavior, and authenticated scheduler path on hosted and self-hosted targets or document each untested target as a portability blocker; include bounded concurrency/lease evidence for job claim and never touch production schema.

## 3. Decision record and handoff

- [ ] 3.1 Update docs/adr/0001-baseline.md with evidence-backed SDK/HTTP choice, embedding profile decision or blocker, package license/runtime constraints, Supabase compatibility matrix, and explicit unresolved decisions; verify every decision links to sanitized spike evidence.
- [ ] 3.2 Update docs/STATUS.md and affected architecture/data-model notes with exact checks and outcomes, the live Jev check status, any skipped/blocked checks and reasons, and the earliest next implementation task; verify no secret, raw prompt, or customer content appears in changed documentation.
- [ ] 3.3 Run the documented provider contract tests and disposable database checks from a clean environment, then record exact commands/results and confirm M1.1/M1.2 are either unblocked or explicitly gated on named decisions in the handoff.