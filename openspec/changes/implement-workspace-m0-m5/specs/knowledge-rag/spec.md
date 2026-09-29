# Spec Delta

## Purpose

Stores bounded, versioned knowledge sources and retrieves only currently authorized evidence. Search and indexing remain usable without generation, and stale or revoked content cannot remain active evidence.

## ADDED Requirements

### Requirement: Source ingestion is bounded and atomic
The system MUST accept saved textual cards, UTF-8 TXT/Markdown uploads, and explicitly selected supported Google documents within the configured byte and extracted-character limits. Unsupported, empty, malformed, or oversized content MUST produce a visible reason and MUST NOT create a partially searchable revision.

#### Scenario: Supported source is submitted
- **WHEN** an authorized user submits a supported source within limits
- **THEN** the system MUST create a private pending revision and durable deduplicated indexing job

#### Scenario: Source is invalid or exceeds limits
- **WHEN** MIME, encoding, content, or size validation fails
- **THEN** the system MUST report the reason and leave no active searchable revision for that submission

### Requirement: Indexing is resumable and fenced
The system MUST process indexing as bounded, durable, at-least-once jobs with leases, retry limits, deduplication, and fencing. Only a complete current revision for a live, authorized source may become active.

#### Scenario: Worker restarts or lease expires
- **WHEN** a job is interrupted or reclaimed after lease expiry
- **THEN** processing MUST resume idempotently and a stale worker MUST NOT activate its revision

#### Scenario: Source is deleted or access is revoked during indexing
- **WHEN** source deletion, actor removal, or cancellation occurs before activation
- **THEN** the revision MUST remain unavailable to search and the job MUST be canceled or prevented from activation

### Requirement: Search is hybrid and authorization-filtered in PostgreSQL
The system MUST perform keyword and vector retrieval using the active embedding profile and current workspace membership/visibility predicates before candidate ranking and again before returning results. If embedding is unavailable, it MUST label keyword-only degradation; database failures MUST be distinct from no matches.

#### Scenario: User searches authorized sources
- **WHEN** a user submits a valid explicit search query
- **THEN** the system MUST return bounded ranked passages from currently authorized active revisions with source and revision references

#### Scenario: Search encounters restricted candidates or embedding outage
- **WHEN** unauthorized candidates rank highly or embedding is unavailable
- **THEN** restricted titles, snippets, counts, and citations MUST NOT be exposed, and keyword fallback MUST be labeled degraded

#### Scenario: Database search fails
- **WHEN** the retrieval database is unavailable
- **THEN** the system MUST report a search failure rather than presenting an empty result set

### Requirement: Revisions and deletion immediately govern retrieval
The system MUST expose only the active live revision; deletion, unsharing, and observed external permission loss MUST block retrieval immediately, including for in-progress indexing and derived content.

#### Scenario: New revision is being indexed
- **WHEN** a refresh is processing successfully
- **THEN** the previous active revision MAY remain searchable until atomic activation unless the source was deleted or access was revoked

#### Scenario: Source is deleted, unshared, or access is observed revoked
- **WHEN** the source becomes unavailable
- **THEN** its passages MUST stop matching immediately and dependent generated content MUST be hidden or invalidated according to its dependencies