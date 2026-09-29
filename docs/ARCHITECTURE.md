# Architecture

## Ownership of responsibilities

| Component | Responsibilities | Not allowed |
|---|---|---|
| React/Vite browser app | Input, deterministic parsing, cards, session client, Google GIS/Picker UI | Provider secrets, privileged DB client, local vector store |
| Supabase Auth | Google identity exchange, app sessions | Implicit Google API authorization |
| Postgres + pgvector | Records, constraints, RLS, search RPCs, jobs and action ledger | Model-generated SQL |
| Supabase Storage | Private upload staging and export objects | Public knowledge buckets |
| Edge Functions | Jev proxy, embedding/LLM gateway, OAuth exchange, Google actions, job consumption | Trusting client membership or arbitrary tools |
| Operator-configured providers | Jev classification, embeddings, language generation | Direct database access |

Browser CRUD uses supabase-js under the user's JWT and RLS. Multi-row or security-sensitive mutations use narrow transactional RPCs. Edge Functions validate the Supabase JWT using supported verification APIs, derive user identity from it, and authorize current workspace membership. User search RPCs run with the user's JWT. A separate privileged client is permitted only for token access, job processing, and tightly scoped internal mutations after explicit authorization.

Frontend is a static SPA to avoid introducing another business backend. Vite replaces the reference project's Next.js shell as a proposed implementation choice; the interaction pattern is retained. Route fallback, CSP, and cache headers belong in the static server/proxy. Share pure Zod schemas between frontend and functions using Deno-compatible imports.

## Request flows

1. Typing → debounce → authorized Jev function → typed intent → deterministic parser → stable preview. Network failure selects keyword/manual fallback with a visible indicator.
2. Save → validated mutation → DB transaction → card revision plus source revision/outbox job → background indexing. Card save is successful even while indexing is pending.
3. Search submission → query embedding on server → authorized hybrid RPC → source revision recheck → passages. Optional Ask uses those passages, validates citations, rechecks access, then returns an answer.
4. Draft generation → user edits → prepare action snapshot → explicit confirmation → execute action against the user's Google connection → persist outcome.

## Background execution

Use a private Postgres job table, claim RPC with `FOR UPDATE SKIP LOCKED`, lease expiration, attempt count, and fencing token. A Supabase Cron job invokes a bounded Edge Function worker through authenticated HTTP. Document pg_cron/pg_net availability and scheduling on both targets. If unavailable on a self-host image, use an operator scheduler container calling the same authenticated function; no new application backend is required.

Jobs process one bounded extraction or embedding batch per invocation, persist progress, and requeue until complete. Never rely solely on request-lifetime background promises. Treat execution as at-least-once; uniqueness and transactional activation prevent duplicate active data. PGMQ is a possible later transport, not a required second queue for MVP.

## Provider boundaries

`IntentClassifier.classify(text, locale)` returns a supported intent distribution and optional typed signals. `EmbeddingProvider.embed(texts, profile)` returns finite vectors with the configured dimensions. `GenerationProvider.generate(task, context, schema)` returns validated output and usage metadata. Adapters must expose timeouts, retry classification, and model identity.

Initial provider contract is an operator-configured OpenAI-compatible chat/embedding API; compatibility is proven in M0, not presumed for every “compatible” server. Jev remains the classifier. Local inference may be configured if it passes the same contract; it is not required to ship a model. No provider endpoints or keys are user-supplied in browser requests.

## Initial budgets (proposed)

Classifier: 350 ms debounce, 2 s provider timeout, latest-request-wins, no retries during typing. Generation: 45 s deadline, maximum 2,000 output tokens and 8,000 context tokens; bounded non-streaming response in MVP simplifies access recheck. Embedding: 20 s timeout per batch, 16 chunks per worker batch. Worker invocation: 45 s internal deadline, 90 s lease; platform limits must exceed these or budgets must be reduced in M0.

Targets on a documented reference environment: card reads/writes p95 <500 ms; keyword search p95 <1 s; hybrid search p95 <3 s excluding provider outage; generated answer p95 <20 s. Capture end-to-end and provider latency separately. These are test targets, not service promises.

## Deployment portability

Production topology: TLS proxy/static web + Supabase gateway/Auth/Postgres/Storage/Edge runtime + scheduler. Use official self-hosting configuration as a maintained dependency, pin images, and supply application migrations/functions on top. The development Supabase CLI stack is not the production installation. Google/Jev/cloud inference require outbound connectivity; offline mode is limited to unsaved local previews and deterministic tools.
