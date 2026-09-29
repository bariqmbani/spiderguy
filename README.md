# ShapeShift-inspired Workspace

Version: 0.1 · 29 September 2026 · Status: M0–M5 implemented. Non-Google behavior is verified locally and on a hosted dev project. Google live verification and M6 are pending (see [STATUS](docs/STATUS.md)).

**A self-hostable, open-source team workspace where one input becomes the right tool: a note, checklist, event, search result, or grounded email draft.** “ShapeShift-inspired Workspace” is a descriptive placeholder, not a final product name or a claim of affiliation.

The repository contains the specification set and a working implementation: a React/Vite SPA, Supabase migrations with RLS, and a single Supabase Edge Function `api`. No Google OAuth client has been provisioned, so Google sign-in, Drive, Gmail, and Calendar are implemented but not live-verified.

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

## Next work

M0–M5 are implemented (see Implementation status below). Remaining work:

- live Google verification with a dedicated test account (M0.4, M5)
- M4.3 evaluation results
- M6: operations, self-host distribution, backup/restore, and release

Use the requirement IDs in PRs and implement one milestone-sized slice at a time.

## Quick start (local)

Prerequisites: Node.js ≥24, pnpm 11.9, Docker, Supabase CLI (verified with 2.118), and Deno 2.9 (only for `typecheck:functions`/`test:functions`). You also need provider credentials for Jev (TypeSafe), an OpenAI-compatible chat endpoint (`gpt-4.1-mini`), and an embeddings endpoint (`text-embedding-3-small`, 1536 dims).

```bash
pnpm install
supabase start                                   # Postgres 17 + pgvector, Auth, Storage, edge-runtime; applies supabase/migrations
cp supabase/functions/.env.example supabase/functions/.env   # fill in provider keys, WORKER_TOKEN, TOKEN_ENCRYPTION_KEY
cp apps/web/.env.example apps/web/.env.local                 # VITE_SUPABASE_PUBLISHABLE_KEY from `supabase status`
pnpm functions:serve                             # serves /functions/v1/api/* (keep running)
bash scripts/local-vault.sh                      # stores WORKER_URL/WORKER_TOKEN in Vault so pg_cron can call the worker
pnpm dev                                         # http://localhost:5173
```

Create a user with **Sign up** in the app. Email/password sign-in is enabled by `VITE_ENABLE_PASSWORD_AUTH=true` and is for development only. Local email confirmations are off. A personal workspace is created automatically. Invitations require the invitee's verified email to match.

Generate secrets with `openssl rand -hex 32` (`WORKER_TOKEN`) and `openssl rand -base64 32` (`TOKEN_ENCRYPTION_KEY`, which must decode to 32 bytes). If the Google variables are empty, the app shows Google features as not configured.

## Tests and checks

```bash
pnpm check              # web typecheck + deno check, lint, vitest, deno tests, build
pnpm test:db            # adversarial RLS/RPC SQL tests against the local DB container (rolls back)
cp .env.test.example .env.test && pnpm test:api   # raw authenticated API tests; needs functions:serve and live providers
node --env-file=.env.hosted scripts/smoke-hosted.mjs   # hosted smoke: SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_PASSWORD; users smoke.alice/bob@example.test
```

`.env.test.example` contains only the well-known local Supabase demo keys. Never commit `.env.test`, `.env.hosted`, or `supabase/functions/.env`.

## Hosted deployment

1. **Database:** apply `supabase/migrations/*` in order, either with `supabase link --project-ref <ref> && supabase db push` or through Supabase MCP `apply_migration`. MCP records its own apply timestamps as versions. Reconcile them with `supabase migration repair` before switching to `db push`. The migrations enable `vector`, `pgcrypto`, `pg_net`, and `pg_cron`, and schedule the `ingest-worker` cron job.
2. **Function:** `supabase functions deploy api --no-verify-jwt` (or MCP `deploy_edge_function` with `verify_jwt=false`). Every route authenticates itself (see [API contracts](docs/API_CONTRACTS.md)).
3. **Secrets:** use the names in [supabase/functions/.env.example](supabase/functions/.env.example): `TYPESAFE_API_KEY`, `JEV_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `WORKER_TOKEN`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`. Set them with `supabase secrets set --env-file supabase/functions/.env`. Or, if you have no CLI access, store them in Vault (`select vault.create_secret('<value>', '<NAME>');`). The function reads the environment first, then Vault, via the service-role-only `svc_secret` RPC, which only accepts these names. You can generate secrets inside SQL (e.g. `encode(extensions.gen_random_bytes(32), 'base64')`) so they never leave the server.
4. **Scheduler:** add Vault secrets `WORKER_URL` = `https://<ref>.supabase.co/functions/v1/api/ingest-worker` and `WORKER_TOKEN`. pg_cron calls the worker every 20 s, but only when there are claimable jobs. Where pg_cron/pg_net are unavailable, any scheduler can POST to that URL with `Authorization: Bearer <WORKER_TOKEN>`.
5. **Web:** build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_GOOGLE_CLIENT_ID`, and `VITE_ENABLE_PASSWORD_AUTH=false` outside development. Serve `apps/web/dist` as a static SPA with a CSP.
6. **Hardening:** enable leaked-password protection in the Supabase dashboard. Review the security advisor. The `authenticated_security_definer_function_executable` warnings are expected for the narrow RPCs.

### Google setup (not yet live-verified)

1. In a Google Cloud project, enable the Drive API, Gmail API, Google Calendar API, and Google Picker API.
2. Configure the OAuth consent screen with scopes `openid`, `email`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/gmail.compose`, and `https://www.googleapis.com/auth/calendar.events.owned`. `gmail.compose` is a restricted scope, so a production audience requires Google verification.
3. Create an OAuth **Web** client. Add the app origin to the authorized JavaScript origins. The code flow uses `redirect_uri=postmessage`.
4. Create an API key restricted to the Picker API. `GOOGLE_APP_ID` is the Cloud project number.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, and `GOOGLE_APP_ID` server-side. Set `VITE_GOOGLE_CLIENT_ID` for the web build.
6. For Google sign-in, enable the Supabase Auth Google provider with the same client ID. The web app uses GIS plus `signInWithIdToken` with a hashed nonce.

Each capability is connected separately with incremental consent. Refresh tokens are AES-GCM encrypted in `private.google_credentials`. Only Gmail **drafts** and primary-calendar events without attendees are created, and only after explicit confirmation.

## Security notes

- The browser holds only public configuration. Provider keys, Google secrets and tokens, `WORKER_TOKEN`, and the service-role key stay in function env or Vault. The built bundle has been scanned for secrets.
- All browser table access is SELECT under RLS. Writes go through narrow `SECURITY DEFINER` RPCs that check `auth.uid()` and live membership. `svc_*`/`worker_*` RPCs are granted only to `service_role`. Search runs `SECURITY INVOKER` under the user's JWT.
- New content is private. Admins cannot read members' private content. Removal takes effect on the next request even with an unexpired JWT.
- LLM output is schema-validated. Citations must quote retrieved passages exactly. Recipients come only from user input. Classifier output only selects UI.
- Drive imports are explicit snapshots, not live ACL sync. There is no Gmail send endpoint.

## Repository layout

```text
apps/web/                          React 19 + TypeScript + Vite SPA (supabase-js under the user's JWT)
supabase/migrations/               0100 identity/workspaces … 0700 action_claim: schema, RLS, RPCs, jobs, cron
supabase/functions/api/index.ts    single Edge Function router: /functions/v1/api/<route>
supabase/functions/api/lib/        auth/errors/secrets, providers (Jev, LLM, embeddings), knowledge, worker, Google
supabase/functions/api/shared/     zod schemas, parsers, chunker, grounding, MIME (also imported by the web app as @shared)
supabase/tests/db/                 adversarial RLS/RPC SQL tests
scripts/                           api-test, smoke-hosted, eval, local-vault
eval/                              synthetic evaluation dataset
docs/                              specification set, ADRs, status
```

The planned `tests/e2e/` (Playwright) and `infra/` (self-host Compose, backups) directories are M6 work. Pinned versions are recorded in [ADR-0001](docs/adr/0001-baseline.md).

## Open-source and distribution

Proposed project license: MIT, with the actual copyright holder set before publication. Keep upstream copyright and license notices when reusing code; record reused files and revisions in THIRD_PARTY_NOTICES.md. Verify all dependency licenses. A publicly available model API is not assumed to be open source or included in the application license. Self-hosting the app does not imply Jev, Google, or a chosen LLM runs locally.

## Implementation status

See [STATUS](docs/STATUS.md) for evidence and [REQUIREMENTS](docs/REQUIREMENTS.md) for per-requirement traceability.

- **Verified locally:** everything that does not need Google.
- **Verified on the hosted dev project:** a core subset (smoke test).
- **Pending a Google OAuth client and test account:** Google sign-in and the Drive, Gmail, and Calendar integrations.
- **Not started:** OPS-01 (self-host distribution, backup/restore; M6).

The license copyright holder and final name are still open.
