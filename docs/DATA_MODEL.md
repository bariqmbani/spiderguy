# Data model and authorization

This is a normative logical schema. Implementation supplies reviewed SQL migrations; this package does not pretend untested SQL is production-ready. UUID identifiers; UTC timestamptz audit fields; NOT NULL unless called optional. JSON payloads have versioned schemas enforced at the API and DB boundary.

## Tables

| Table | Key columns and constraints |
|---|---|
| profiles | id FK auth.users; display_name; timezone IANA; locale |
| workspaces | id; kind personal/team; name; owner_id; created_at; deletion_state; personal owner unique partial index |
| memberships | PK(workspace_id,user_id); role owner/admin/member; state active/removed; joined_at; exactly one active owner matching workspaces.owner_id |
| invitations | id; workspace_id; email_normalized; role fixed member; token_hash unique; expires_at; accepted_at optional; revoked_at optional; invited_by |
| cards | id; workspace_id; owner_id; visibility private/workspace; type note/checklist/event/bookmark/email; payload_version; payload JSONB; revision integer; deleted_at optional |
| sources | id; workspace_id; owner_id; visibility; kind card/upload/drive_snapshot; card_id optional unique; title; external_file_id optional; connection_id optional; active_revision_id optional; state; deleted_at optional |
| source_revisions | id; workspace_id; source_id; content_hash; revision_number; extractor_version; chunker_version; embedding_profile_id; extracted_text; state; imported_at; external_modified_at optional; unique(source_id,revision_number) |
| chunks | id; workspace_id; source_id; revision_id; ordinal; text; tsvector; embedding vector(1536); content_hash; unique(revision_id,ordinal) |
| embedding_profiles | id; provider; model; dimensions; normalization; distance; version; active; immutable once used |
| source_dependencies | workspace_id; card_id; source_id; source_revision_id; created_at; tracks generated content provenance |
| google_connections | id; user_id; provider_subject; email; scopes; status; version; unique(user_id); metadata only to owner |
| private.google_credentials | connection_id; encrypted refresh/access tokens; key_version; expires_at; never API-exposed |
| private.oauth_states | state_hash; user_id; capability; nonce; redirect_uri; expires_at; consumed_at optional |
| private.jobs | id; workspace_id; source_id; revision_id; actor_id; type; dedupe_key unique; state; attempts; not_before; lease_until; fence; last_error_code |
| action_requests | id; workspace_id; actor_id; connection_id; kind; immutable payload; payload_hash; idempotency_key; state; expires_at; provider_resource_id optional; unique(actor_id,kind,idempotency_key) |
| audit_events | id; workspace_id; actor_id optional; action; target_type/id; outcome; request_id; created_at; sanitized metadata |
| private.usage_counters | bucket_key; window_start; count/token reservation; updated transactionally |

Use composite foreign keys `(workspace_id, source_id)` and `(workspace_id, revision_id)` where applicable, supported by corresponding unique keys. Cross-workspace references must fail even for a bug in server code. Revisions belong to the same source as their active pointer. Protect source active pointer and revision state from browser writes. Index membership lookups, workspace/owner visibility filters, source/revision IDs, full-text GIN, and cosine HNSW for active embedding profile.

Default embedding storage dimension is 1536 as a **proposed schema choice**, not a claim that every provider supports it. M0 must choose an actual model/profile matching it or amend this specification before the first migration. Switching dimensions requires a new table/column and index migration; switching model requires complete re-embedding even at equal dimensions.

## Authorization matrix

| Operation | Owner | Admin | Member |
|---|---|---|---|
| Read workspace-shared content | Yes | Yes | Yes |
| Read someone else's private content | No | No | No |
| Create own content | Yes | Yes | Yes |
| Edit/delete own content | Yes | Yes | Yes |
| Edit someone else's shared content | Yes | Yes | No |
| Delete someone else's shared content | Yes | Yes | No |
| Share/unshare another person's content | No | No | No |
| Invite/remove ordinary members | Yes | Yes | No |
| Change roles/remove admins/transfer owner | Yes | No | No |
| Delete team workspace | Yes | No | No |
| Use another person's Google credentials | No | No | No |

Members can edit checklists they own; collaborative editing of others' content is deliberately deferred. Owner/admin moderation of shared content does not grant access to the creator's private sources or Google connection. A source tied to a card follows the card visibility; independent changes are prohibited. Shared generated cards must have only shared dependencies.

## Policy rules

`can_read_content` = active membership AND not deleted AND (visibility=workspace OR owner_id=auth.uid()). Apply identically to cards, sources, revisions, chunks, and private Storage object paths. Require an active source and active revision for searchable chunks. Source document reads may expose only currently authorized non-deleted revisions; pending extraction content is internal.

Use SELECT/INSERT/UPDATE/DELETE policies separately; UPDATE has both USING and WITH CHECK. Revoke direct writes to ownership, workspace, role, visibility, active revision, action state, and job fields. Route changes through narrow RPCs. Membership-policy helpers must avoid recursive RLS: minimal SECURITY DEFINER functions in a private schema, fixed empty search_path, fully qualified names, no dynamic SQL, and restricted EXECUTE grants. Review their owner privileges. Search RPCs use SECURITY INVOKER.

Personal workspaces cannot receive invitations, additional memberships, or ownership transfers. All team-management RPCs reject personal workspaces.

Workspace creation, invite acceptance, owner transfer, content sharing, deletion, source activation, and revision-aware edits are transactions. Owner transfer locks the workspace and affected memberships. Never accept owner_id or actor_id as authoritative client identity. Role changes read current membership, not stale JWT custom claims. Invite normalization trims and case-folds email; never apply Gmail dot/plus alias rewriting.

## Lifecycles

Card changes increment revision and enqueue replacement index work transactionally. An admin editing a shared card cannot convert it to private ownership. Removed members lose all access, including their private content in that team; shared contributions remain owned by the former member but editable by owner/admin. Private contributions become inaccessible and are eligible for deletion by the operator retention process; do not transfer them to an admin.

Unsharing a source atomically hides shared derived cards that depend on it until their owner regenerates or removes the dependency. A source delete does the same and cancels jobs. Historical copies already exported cannot be recalled. Workspace deletion first marks unavailable, cancels jobs/actions, then asynchronously purges its blobs, content, and vectors. Personal Google connections survive deletion of a team.
