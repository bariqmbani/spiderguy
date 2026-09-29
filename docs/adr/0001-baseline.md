# ADR-0001 — Supabase-centered adaptive workspace

Date: 2026-09-29 · Status: accepted for M0–M5 implementation, with recorded deviations (see "M0 outcomes"); name, license holder, and Google audience still open

## Decisions

| Decision | Authority/status | Rationale and consequence |
|---|---|---|
| ShapeShift-like adaptive input | User requirement | Structured interaction remains the core experience |
| Jev classifier; deterministic parsing | Carried-forward user constraint | Classification is separated from generation and arithmetic |
| Supabase backend and pgvector store | User requirement | Avoid separate CRUD service; still implement migrations, RLS, functions, jobs |
| Team workspaces, Google integration, LLM assistance | User requirement | Requires tenant boundaries and explicit external-action contracts |
| OSS and self-hosting | Carried-forward user constraint | Portable production deployment required; external APIs remain dependencies |
| ~~Google GIS + Supabase identity exchange~~ | Superseded 2026-09-29 by the next row | — |
| Supabase Auth Google provider for sign-in and capability consent | User instruction ("Use supabase for google auth"); implemented; live verification pending | One Google client configured in Supabase; Supabase PKCE/state replaces app-managed OAuth state; provider tokens transit the browser once (deviation 10) |
| React/Vite SPA | Proposed default | Static deployment; avoids a second server business layer; upstream Next.js code requires adaptation |
| Six-card MVP | Proposed default | Focus on knowledge/work actions before matching all reference card types |
| Private by default; explicit workspace sharing | Proposed default | Team membership alone does not expose personal imports |
| Selected Drive snapshots, no continuous sync | Proposed default | Tractable ACL semantics; imported copies can differ from later Google permissions |
| Gmail drafts and personal Calendar events only | Proposed default | Useful integrations without autonomous mail or invitations |
| Installation-wide AI config, vector(1536) initial profile | Accepted (M0): text-embedding-3-small, 1536, cosine | Simple operation; profile row immutable; model change requires new profile and full re-embed |
| Postgres leased job table + scheduled Edge worker | Accepted; pg_cron + pg_net verified locally and hosted | Durable processing on hosted/self-hosted installs without custom server |
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

Final name; license copyright holder; provider budgets; target server sizing; Google deployment audience (testing vs. production, restricted-scope verification for `gmail.compose`). Model IDs and dependency versions are now recorded below.

## M0 outcomes and implementation decisions (2026-09-29)

### Pinned versions

| Component | Version | Evidence |
|---|---|---|
| Node.js / pnpm | Node ≥24 (engines); pnpm 11.9.0 (`packageManager`) | package.json |
| Web | React 19.3.0, Vite 8.3.1, TypeScript 5.9.3, @vitejs/plugin-react 6.1.1, ESLint 10.11.0 | apps/web/package.json |
| Shared | zod 3.25.76, @supabase/supabase-js 2.117.2, vitest 3.2.4 | package.json, supabase/functions/api/deno.json |
| Jev SDK | `@typesafe-ai/sdk` 0.6.0 (npm specifier in Deno) | supabase/functions/api/deno.json |
| Deno (local check/test) | 2.9 | `pnpm typecheck:functions`, `pnpm test:functions` |
| Supabase CLI local stack | CLI 2.118, edge-runtime 1.76.2, Postgres 17.6, pgvector 0.8 | local `supabase start` |

Container image digests for a production self-host are not yet pinned (M6.2).

### Provider decisions (user decisions this session)

- **Classifier:** Jev via TypeSafe SDK, `TypeSafeClient.systemOne` with one `choice` question over the six intents. `jev-latest` resolved to `jev-1.13.0` in live calls. 2 s timeout, no retries. Any failure falls back to the deterministic keyword classifier `keyword-v1` with `fallback: true`. Live verified locally and on the hosted dev project.
- **LLM:** OpenAI-compatible Azure endpoint, model `gpt-4.1-mini` (responses report `gpt-4.1-mini-2025-04-14`). Strict `json_schema` output, temperature 0.2, max 2,000 output tokens, 45 s timeout. `gpt-5-mini` was requested first, but that deployment returned 404 DeploymentNotFound, so the user specified `gpt-4.1-mini` instead.
- **Embeddings:** Azure `text-embedding-3-small`, 1536 dimensions, L2-normalized, cosine distance. The profile row is `openai-compatible / text-embedding-3-small / 1536 / l2 / cosine / te3s-1536-v1` and cannot be changed after insert (trigger-enforced). The user first asked for the npm `word2vec` package. It was evaluated: the C build succeeded and it was trained on the text8 corpus. The user then explicitly told us to use `text-embedding-3-small`, which supersedes it. **This is a user decision.** The word2vec package was removed.

### Deviations from the proposed baseline

1. **One Edge Function `api` with sub-routes** at `/functions/v1/api/<route>`. The routes are: health, intent, search, generate, index-now, ingest-worker, google-config, google-session-connect, google-picker-token, google-import, google-disconnect, source-refresh, action-prepare, action-execute. It is deployed with `verify_jwt=false`, and each route authenticates itself. User routes call `auth.getUser`. `ingest-worker` requires `Bearer WORKER_TOKEN`, compared in constant time. `health` and `google-config` are public and return no secrets. *Reason:* deploying through Supabase MCP needs one bundle and shared code, and it has to include unauthenticated health/config/worker routes.
2. **Upload staging uses Postgres RPCs, not Edge Functions.** `create_upload_source` and `finalize_upload` replace `source-upload` and `source-finalize`. A Storage RLS policy only allows inserts to the pending path the server created (`<workspace>/<user>/<source>/<revision>`). *Reason:* this is a smaller trusted surface, and the browser uploads under its own JWT.
3. ~~**`google-callback` is an authenticated POST** from the GIS popup code flow.~~ Superseded by deviation 10; `google-connect`/`google-callback` were removed.
4. **Operator secrets are read from the environment first, then from Supabase Vault**, through the service-role-only RPC `svc_secret`, which only accepts names on an allow-list. *Reason:* the hosted project had no CLI access token for `supabase secrets set`. On hosted, `WORKER_TOKEN` and `TOKEN_ENCRYPTION_KEY` were generated server-side in SQL, and the developer never saw them.
5. **Scheduler:** the pg_cron job `ingest-worker` runs every 20 s. It calls `private.kick_worker()`, which uses pg_net to POST to `WORKER_URL` with `WORKER_TOKEN` (both from Vault), and only does so when claimable jobs exist. Verified locally (cron → pg_net → worker 200). Cron runs succeed on hosted. The authenticated `index-now` route lets a client trigger one bounded worker pass (≤4 jobs, 25 s) to reduce latency.
6. **Development email/password sign-in** is behind `VITE_ENABLE_PASSWORD_AUTH`, because no Google OAuth client was provided. Google sign-in is `signInWithOAuth({provider:'google'})` (redirect, preserves `?invite=`), shown when `VITE_ENABLE_GOOGLE_AUTH` is not `false`. It has not been live-verified.
7. **Action execution uses the RPC `action_claim`.** Migration 0700 replaced `action_begin_execute`. It returns `{claimed, action}`, and only the caller that wins `prepared→executing` dispatches. Duplicate confirmations never re-dispatch. An action stuck in `executing` for more than 2 min becomes `outcome_unknown` (`DISPATCH_INTERRUPTED`). Calendar uses the deterministic event ID `'a' + sha256(action_id)[0:40]` for reconciliation. An unknown Gmail outcome is never retried.
8. **Chunker `para-v1/chars4-v1`:** paragraph/heading split, about 4 chars per token, target 600 / max 800 / overlap 100 tokens.
9. **Content-filter handling:** Azure's content filter can block a request when retrieved passages contain jailbreak text. When that happens, generation retries once without instruction-like passages and reports `excluded_passages`. If nothing can be excluded, the API returns `CONTENT_FILTERED`.
10. **Google via Supabase Auth's Google provider (user instruction "Use supabase for google auth").** Sign-in and per-capability consent both go through Supabase Auth; GIS is no longer used. Consent calls `linkIdentity` (if Google is not linked yet; needs manual linking) or `signInWithOAuth` with one capability scope, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`. On return the SPA checks the pending capability and that the same app user came back, POSTs `provider_token`/`provider_refresh_token` once to `google-session-connect`, then calls `refreshSession()` so the stored session no longer carries them. The server verifies the token with Google `tokeninfo`, requires `aud`/`azp` to match `GOOGLE_CLIENT_ID` when set, requires `sub` to equal the user's linked Supabase Google identity, requires the capability scope, and stores AES-GCM-encrypted tokens. `private.oauth_states` and `svc_oauth_state_*` are now unused (left in place; no destructive migration). **Trade-off:** Google provider tokens transit the browser (in the Supabase OAuth session in browser storage) for a brief window before hand-off. This deviates from "credentials never appear in browser storage"; accepted because the user asked for Supabase-based Google auth and a single Google client configured in Supabase. Background refresh needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (the same client) as function secrets/Vault; without them access lasts about one hour, then `RECONNECT_REQUIRED`.

### Hosted dev project

The user authorized use of a Supabase dev project through MCP. Migrations 0100–0700 were applied with MCP `apply_migration`. **The remote migration versions are the MCP apply timestamps, not the local file timestamps.** Reconcile this before any `supabase db push` (for example with `supabase migration repair`). Function `api` v1 is deployed and the Vault secrets are set. `node --env-file=.env.hosted scripts/smoke-hosted.mjs` passed. Security advisor results: 22 WARN `authenticated_security_definer_function_executable`, which are intentional narrow RPCs with `auth.uid()`/membership checks, and leaked-password protection disabled, which is a dashboard setting for the operator.

### Not yet verified

- The Google OAuth client and a dedicated test account (M0.4, M5.1–M5.4 live checks).
- A self-hosted (non-CLI) Supabase deployment.
- Performance/latency targets.
- M4.3 evaluation metrics.
