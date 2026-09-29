# Source review and evidence

Reviewed 29 September 2026. Sources establish platform behavior and upstream inspiration; the product requirements, scope choices, budgets, permissions, and job design in this package are original proposed specifications, not claims that the reference already implements them.

## Reference project

[anishfn/shapeshift](https://github.com/anishfn/shapeshift) was inspected through its README and selected repository files. It uses adaptive cards, a Jev classifier with an offline fallback, deterministic parsing, and a stability state machine. Its persistence is browser-local; this specification replaces that boundary with shared Supabase persistence. Its stack uses Next.js/React/TypeScript. Its license is MIT. This is a targeted source assessment, not a complete code/security audit.

Inspected files and blob SHAs (not a pinned whole-repository commit):

| File | Blob SHA |
|---|---|
| src/lib/jev/questions.ts | a3bec0c7f68ca356b720350297164894d4a21633 |
| src/lib/decide.ts | a0bdc6579bc8184e9b39d66563baa59eaa363cab |
| package.json | c9c25dc05cf1c1317d9096d9e0825dc9eed96a3e |
| LICENSE | dff0ebc22ebc07d47c96c0d837e67ca85bc2dacb |

Before reusing code, pin an upstream commit and preserve the corresponding license notices. No upstream source code is bundled here.

## Primary documentation

| Source | Relevance |
|---|---|
| [Supabase AI and vectors](https://supabase.com/docs/guides/ai) | Postgres/pgvector as embedding store |
| [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) | Database-enforced authorization |
| [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google) | Google sign-in and Supabase identity/session integration |
| [Supabase Edge Functions](https://supabase.com/docs/guides/functions) | Deno/TypeScript function runtime |
| [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting) | Docker-based deployment path |
| [Supabase Cron](https://supabase.com/docs/guides/cron) | Scheduling SQL/functions/HTTP work |
| [Supabase Queues](https://supabase.com/docs/guides/queues) | Evaluated durable queue alternative; delivery is not end-to-end external-action exactly-once |
| [Google GIS code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model) | Server-side authorization code exchange |
| [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) | Per-file authorization and Picker approach |
| [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) | Compose grant breadth and restricted classification |
| [Gmail draft creation](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create) | Draft endpoint and accepted scopes |
| [Gmail draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts) | MIME/base64url draft format |
| [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) | Owned-calendar event permission |

Provider APIs, OAuth requirements, supported versions, and runtime constraints can change. Revalidate them in M0 and before release. Do not infer capabilities from undocumented examples or assume a development consent configuration is production-ready.
