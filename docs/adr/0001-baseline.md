# ADR-0001 — Supabase-centered adaptive workspace

Date: 2026-09-29 · Status: proposed baseline; user-mandated constraints accepted

## Decisions

| Decision | Authority/status | Rationale and consequence |
|---|---|---|
| ShapeShift-like adaptive input | User requirement | Structured interaction remains the core experience |
| Jev classifier; deterministic parsing | Carried-forward user constraint | Classification is separated from generation and arithmetic |
| Supabase backend and pgvector store | User requirement | Avoid separate CRUD service; still implement migrations, RLS, functions, jobs |
| Team workspaces, Google integration, LLM assistance | User requirement | Requires tenant boundaries and explicit external-action contracts |
| OSS and self-hosting | Carried-forward user constraint | Portable production deployment required; external APIs remain dependencies |
| Google GIS + Supabase identity exchange | Proposed reconciliation of Google SDK and Supabase Auth | Google UI/identity SDK with Supabase session ownership |
| React/Vite SPA | Proposed default | Static deployment; avoids a second server business layer; upstream Next.js code requires adaptation |
| Six-card MVP | Proposed default | Focus on knowledge/work actions before matching all reference card types |
| Private by default; explicit workspace sharing | Proposed default | Team membership alone does not expose personal imports |
| Selected Drive snapshots, no continuous sync | Proposed default | Tractable ACL semantics; imported copies can differ from later Google permissions |
| Gmail drafts and personal Calendar events only | Proposed default | Useful integrations without autonomous mail or invitations |
| Installation-wide AI config, vector(1536) initial profile | Proposed default, M0 validation | Simple operation; concrete model/dimension compatibility must be proven |
| Postgres leased job table + scheduled Edge worker | Proposed default | Durable processing on hosted/self-hosted installs without custom server |
| Non-streaming generation | Proposed default | Access can be rechecked before content leaves server; slower perceived first token |
| MIT license | Proposed, copyright holder pending | Permissive OSS distribution; retain upstream notices if code reused |

## Alternatives considered

A custom Java/Go backend offers runtime flexibility but expands the build/operations scope. Browser RAG cannot provide a single shared authorized corpus and is explicitly excluded. A general chat agent with broad tools makes confirmation and access control harder to bound. Automatic whole-Drive synchronization requires more scope, sync state, and permission propagation than this MVP.

## Risks and follow-up decisions

- Jev/Deno compatibility and production worker budget: M0 spike; documented HTTP adapter or bounded function architecture adjustment if needed.
- Google restricted-scope deployment requirements: M0/M5 verification; copy-only email remains usable but does not satisfy Gmail-integration release criteria.
- Vector model/provider and quality: choose in M0; reevaluate in M4 with dataset evidence.
- Static SPA auth/session security: use supported SDK lifecycle and hardened CSP; no credentials beyond public config in bundle.
- Snapshot ACLs: explicit disclosure and deletion behavior; live synchronization requires a future ADR, not a silent implementation change.

## Decisions still open

Final name; exact model IDs and dependency versions; provider budgets; target server sizing; Google deployment audience. Recommended defaults allow planning, but do not invent these facts. Record M0 outcomes here before dependent migrations/features.
