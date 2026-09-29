# Incremental implementation plan

All tasks are pending. Deliver vertical slices with visible behavior and test evidence. M0 resolves technical uncertainties; M1–M6 are ordered by dependencies. Numbers are work order, not time estimates.

| Task | Deliverable | Dependency | Exit evidence |
|---|---|---|---|
| M0.1 Baseline | Confirm working name, license owner, MVP defaults; record exact dependency/image versions | None | ADR updated, lockfiles planned |
| M0.2 Provider spike | Jev Deno/HTTP call; one embedding profile/dimension; structured generation fixture | M0.1 | Real documented APIs and sanitized results |
| M0.3 Platform spike | Self-host functions, vector index, private job claim, scheduler; GIS/Supabase token exchange | M0.1 | Compatibility matrix on pinned stack |
| M0.4 Google spike | Test-account GIS code grant, Picker drive.file, Gmail compose, Calendar owned-event compatibility | M0.3 | Scope/consent/deployment constraints recorded; no general user account mutations |
| M1.1 Foundation | Frontend/domain/function workspace, scripts, CI, env templates | M0 | Build/lint/typecheck baseline |
| M1.2 Identity | Google sign-in, profiles, idempotent personal workspace | M1.1 | T01 |
| M1.3 Team security | Membership/role/invite RPCs, constraints, RLS | M1.2 | T02,T03 including raw API tests |
| M1.4 First note | Note CRUD and private/shared toggle with optimistic edits | M1.3 | Save→reload→edit→conflict→delete demo |
| M2.1 Input engine | Jev proxy, fallback, versioned schemas, adaptive preview | M1.4 | T04,T05 |
| M2.2 Card set | Checklist/event/bookmark/email persistence, palette, dates | M2.1 | T06 and accessible keyboard journey |
| M3.1 Knowledge storage | Sources/revisions/chunks/profile, private buckets | M2.2 | Constraints and access tests |
| M3.2 Durable pipeline | Upload/finalize, extraction, batching, leases/fences | M3.1 | T07,T08 fault-injection report |
| M3.3 Search | Authorized keyword+vector RPC and evidence UI | M3.2 | T09 and hybrid/keyword degradation demo |
| M4.1 Generation | Answer/summary/email functions and explicit controls | M3.3 | T11,T12 |
| M4.2 Derived privacy | Provenance, private-only outputs, deletion/unsharing propagation | M4.1 | T10 and AI-02 proof |
| M4.3 Quality gate | Frozen/held-out RAG and classifier datasets | M4.2 | Threshold report, limitations documented |
| M5.1 Connections | OAuth state, encryption, scoped consent, reconnect/disconnect | M4.3,M0.4 | T13 |
| M5.2 Drive | Picker-selected import/refresh/private snapshot/share disclosure | M5.1 | T14 with test docs |
| M5.3 Gmail | Reviewed action ledger, MIME, draft-only adapter, uncertain outcomes | M5.1 | T15 |
| M5.4 Calendar | Confirmed primary calendar event, deterministic ID recovery | M5.1 | T16 |
| M6.1 Operations | Rate limits/usage, metrics/logs, purge policies | M5 | Security tests and limits evidence |
| M6.2 Distribution | Hosted guide, self-host Compose/config/runbook, licenses/notices | M6.1 | T17 on fresh environments |
| M6.3 Release | Restore/load drill, end-to-end acceptance, accurate README | M6.2 | T18,T19; all MUST criteria pass |

## First coding assignment

After M0, implement M1.1 and M1.2 only. Create the repository scaffold and authentic Google→Supabase session flow, then demonstrate a single personal workspace per user. Implement schemas and tests alongside the bootstrap. Do not create empty shells for every future integration. The next assignment is the membership/RLS slice before shared content exists.

## Definition of ready

Task has requirement IDs, relevant spec links, testable acceptance criteria, known external dependencies, and no unresolved decision that would invalidate its design. If Google approval blocks broad distribution, development can continue using documented test-account capabilities; release remains blocked for that audience until resolved.

## Definition of done

Behavior works end-to-end; meaningful tests pass; error and unauthorized paths verified; migrations and environment changes documented; requirement traceability and STATUS updated; user-facing limitations accurate. A mock integration may satisfy a component test but not the live connector acceptance criterion.

## SDD change control

Small clarifications update the relevant spec in the same PR. Changes to tenant boundaries, provider contracts, data visibility, external actions, or MVP scope require a change spec and ADR before implementation. Review requirements → design/contracts → tasks/tests → code, then check actual code against the spec. Never use a single “implement all documents” task as the delivery workflow.
