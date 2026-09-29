# Requirements and acceptance criteria

Status of every row: specified, not implemented. MUST is release-blocking for the relevant milestone. IDs remain stable when text changes; retire rather than recycle them.

| ID | Requirement | Observable acceptance criteria |
|---|---|---|
| AUTH-01 | Google authentication through Supabase | Valid Google identity creates a Supabase session and one personal workspace; invalid nonce/audience, canceled login, or expired session does not grant access. No Workspace API scope is required to sign in. |
| TEAM-01 | Tenant lifecycle | Authenticated user creates a team; creator is owner; membership is checked in DB; selecting another workspace clears all prior workspace query caches and in-flight results. |
| TEAM-02 | Invitations and roles | Owner/admin creates a seven-day single-use invite bound to an email and member role; acceptance requires matching verified identity and is atomic; expired/reused/mismatched tokens fail; only owner changes privileged roles or transfers ownership. |
| TEAM-03 | Removal and ownership | Removal blocks reads, writes, jobs, and pending actions on the next authorization check, even with an unexpired JWT; concurrent owner removal/transfer cannot leave a workspace ownerless. |
| UI-01 | Stable adaptive cards | Jev maps input to supported intent; manual palette always works; late classifier responses cannot replace newer text; low-confidence classification cannot save or execute anything. |
| CARD-01 | Durable card CRUD | Save/edit/delete note, checklist, event, bookmark, or email card; reject invalid typed payloads; stale revision update produces conflict without data loss. Search is a transient UI card, not a saved content type. |
| ACL-01 | Private and shared access | New objects are private; only owner can share/unshare their content; another member, including admin, cannot read private content; nonmembers cannot access even shared rows or blobs. |
| SRC-01 | Ingest bounded content | TXT/Markdown upload, saved-card source, or selected Google Doc becomes queued then ready; unsupported, oversized, empty, or invalid content yields a visible reason and no partial searchable revision. |
| RAG-01 | Server-side authorized retrieval | Search combines keyword and vector retrieval in Postgres using current authorization; no browser embeddings; unauthorized titles, snippets, counts, and citations never appear. |
| RAG-02 | Grounded answers | Explicit Ask generates from retrieved passages with valid source/revision/chunk references; unsupported questions yield an abstention; unavailable generation leaves ordinary search usable. |
| RAG-03 | Version and deletion correctness | Reindex atomically changes active revision; old revisions stop matching; deleting a source removes it from retrieval immediately, including while a worker is embedding it. |
| AI-01 | Bounded generative assistance | User explicitly requests answer, summary, or email draft; server validates structured result, model configuration, context budget, and limits; malformed output cannot invoke an action. |
| AI-02 | Content visibility inheritance | Generated/saved content using any private source remains private; sharing is blocked until private-source dependencies are removed or explicitly shared and regenerated. |
| GWS-01 | Separate scoped connections | Connect only the requested capability with incremental consent; denied scope disables that feature alone; credentials never appear in browser storage, logs, or public tables. |
| GWS-02 | Selected Drive snapshot import | Picker selection is validated server-side using the connected account; import is private and shows source link/import time; explicit refresh produces a new revision; observed loss of permission hides the source pending resolution. |
| GWS-03 | Gmail draft only | User sees and confirms account, recipients, subject, and body; create an unsent Gmail draft; no send endpoint exists; duplicate submission returns prior result or an explicit uncertain state. |
| GWS-04 | Calendar creation | User confirms timezone, start/end, title, and primary calendar; create one event without attendees; ambiguous times require correction; duplicate confirmation does not create another event. |
| JOB-01 | Durable background work | Closing browser does not lose accepted import; leased jobs retry transient failures with bounds; failed jobs have a safe error and retry control; stale workers cannot activate canceled revisions. |
| OPS-01 | Portable installation | Fresh installation works with hosted and self-hosted Supabase; documented Google setup, worker scheduling, migration, backup, and restore drills succeed; no hosted-only implicit dependency. |
| SEC-01 | Secure operational baseline | RLS/grants cover all exposed objects, service credentials stay server-only, SSRF/output injection tests pass, rate limits are server-enforced, and logs redact content and tokens. |
| SDD-01 | Traceable delivery | Each completed task links requirement IDs, changed code, test evidence, and updated docs; baseline modifications have a change spec/ADR when architectural. |

## Cross-cutting behavior

Authentication failures use 401; unauthorized or missing objects use a consistent 404 where existence is sensitive; invalid payloads 422; concurrency conflicts 409; rate limits 429. Never substitute empty search results for an infrastructure failure. Distinguish “no matches,” “still indexing,” “provider unavailable,” and “access removed.”

Authorization is evaluated at request admission and immediately before returning sensitive generation/action results. Membership removed during a provider call causes the result to be discarded. Bytes already delivered to a user cannot be recalled; do not claim retroactive erasure from their device.
