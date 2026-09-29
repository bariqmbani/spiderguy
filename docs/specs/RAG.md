# Knowledge ingestion and RAG

## Supported sources

MVP indexes saved notes/checklists/events/bookmarks and explicitly saved email cards, TXT/Markdown uploads, and selected native Google Docs exported as plain text or Drive TXT/Markdown downloaded as bytes. Do not index transient prompts, generated search answers, or Gmail itself automatically. Bookmark indexing includes title, note, and URL text, not the remote web page.

Limits: 5 MiB uploaded bytes; 100,000 decoded/extracted characters; UTF-8 text; no archives, HTML ingestion, OCR, or PDF. Check MIME, extension, actual bytes, and decoded size. Treat Markdown as text for indexing and sanitize rendered Markdown separately.

## Ingestion transaction and worker

1. Authorize actor and workspace. Create private source, pending revision, and deduplicated job. Upload path is server-created, single-source scoped, and belongs to the uploader. Finalize validates the staged object before indexing.
2. Worker claims job with lease/fence. Recheck source state, membership, and connection ownership. Extract canonical text, normalize whitespace while preserving headings, and hash it.
3. Chunk by paragraph/heading into a target 600 tokens, maximum 800, overlap 100; use a fixed versioned tokenizer for the chosen embedding model. Oversized paragraphs split safely. Empty text becomes a visible non-indexable state.
4. Embed in batches, validating vector count, finiteness, dimensions, and model profile. Upsert by `(revision_id,ordinal)` with hashes. Never combine different embedding profiles in one search.
5. Atomically activate only if the source is still live, the job fence is current, all chunks are complete, and no newer revision has superseded it. Replace active revision and retire old chunks. Garbage-collect retired data asynchronously.

Source state: pending → processing → ready; recoverable failure → retry_wait; terminal failure → failed; deletion → deleted. A refresh keeps the old active snapshot searchable until the new one succeeds unless access was revoked or content explicitly deleted. UI must label indexing state and timestamp.

Retry transient errors at 5 s, 30 s, 2 min, 10 min, and 30 min with jitter and provider Retry-After support; stop after five retries beyond initial attempt. Permanent invalid input and denied permissions do not retry. Expired worker leases allow recovery; fencing prevents an old worker publishing after recovery. Cancel jobs for deleted sources or removed actors.

## Search contract

Search requires workspace_id, explicit submit, and a 1–2,000 character query. Default limit 10, maximum 20. Server generates the query embedding with the active profile. Authorized vector and full-text candidates are selected separately, up to 50 each; fuse using reciprocal rank fusion with k=60, deduplicate, then return at most two chunks per source in the top ten.

Tenant/visibility/live-revision predicates must be applied within retrieval SQL before candidate ranking and again before return. Approximate indexing plus restrictive filters can under-fill results: use iterative scans supported by the pinned pgvector version or an exact authorized fallback within a bounded timeout. Do not solve under-fill by searching all tenants then filtering in JavaScript.

If embedding is unavailable, execute keyword-only search and label degraded mode. If Postgres search fails, show failure, not zero matches. Scores are ranking signals, not calibrated probabilities. Start without a hard similarity cutoff; tune evidence selection against the evaluation set in M4.

## Grounded generation

Ask is a separate action from ordinary search. Use up to eight authorized chunks, maximum 8,000 context tokens including system/task context; reserve output budget. Include source IDs, revision IDs, chunk IDs, title, import timestamp, and exact passage text. Treat retrieved instructions as quoted data. Prompt the model to answer only supported factual questions, cite claims, and abstain when evidence is insufficient.

Return `{answer, citations:[{source_id,revision_id,chunk_id,quote}], abstained}`. Validate all references against the retrieved set and current permissions, require each quote to be a substring of the referenced chunk, and reject invented citations. Structural validation alone does not prove factual entailment; measure entailment through the evaluation rubric. On validation failure retry generation once with the errors, then return a safe failure with search results.

No multi-turn conversational memory in MVP. Each request has explicit context. Summarize selected sources and draft email use the same retrieval/authorization boundary. Draft recipient addresses are provided/confirmed by the user, never resolved from a person's name by a model. Citation metadata appears beside the draft and is excluded from Gmail body unless the user intentionally inserts it.

## Access changes and generated artifacts

Generated cards record dependencies. If any source is private, the generated card must be private. Never use a teammate's private content even if a privileged worker could technically read it. Source deletion, loss of membership, and explicit unsharing must invalidate affected results/derived visibility. After generation, recheck every dependency before delivering output; with no streaming, revoked results can be discarded in full.

Drive snapshots do not inherit live Google ACLs. Explicit refresh revalidates Google access; 403/404 or disconnect makes corresponding snapshots unavailable immediately upon observation, cancels processing, and queues purge. Manual sharing is separately disclosed. No claim of real-time external revocation detection is made.

## Evaluation fixtures

Create 50 answerable and 20 unanswerable questions over at least 20 synthetic documents, including near-duplicates, conflicting revisions, dates, English/Unicode names, and access boundaries. Add 20 adversarial prompts embedded in documents. Track Recall@5 ≥0.85, supported-claim rate ≥0.90, abstention correctness ≥0.90 on unanswerable questions, and zero cross-tenant leakage. Record model/profile, chunker, prompt version, and dataset commit with each run; use held-out examples for the release gate.
