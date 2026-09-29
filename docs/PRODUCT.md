# Product specification

## Problem and value

Small teams scatter notes, actionable items, and source documents across tools. Traditional forms require choosing a tool before expressing intent, while open-ended chat often returns prose that still needs manual conversion into useful data. This product converts intent into editable structured cards, searches authorized knowledge, and helps users prepare work in Google Workspace.

Primary users: a self-hosting individual; a small team member capturing and finding shared knowledge; a workspace owner managing access. The operator installs infrastructure and provider credentials; an operator is not automatically an in-app team owner, though a host administrator ultimately controls the database.

## Core journey

A user signs in with Google, selects their personal or team workspace, and types “draft an email explaining the onboarding process.” Jev suggests the email card. The user selects authorized sources and explicitly generates a draft. The result includes source references outside the email body. The user edits the content and explicitly saves it to their own Gmail drafts. No email is sent.

A second journey: type “find the release checklist,” choose Search, submit, inspect matching passages, and optionally request a cited answer. A third: type a meeting description, inspect the date/time card, save it internally, and separately confirm creation in the user's primary Calendar.

## MVP boundary

| Capability | MVP commitment | Deferred |
|---|---|---|
| Adaptive input | Note, checklist, event, bookmark, knowledge search, email draft; manual palette | Full upstream card parity, voice input |
| Persistence | Cards, personal/team workspaces, optimistic edits | Offline multi-device sync, CRDT editing |
| Teams | Owner/admin/member, invitation link, removal, ownership transfer | Billing, guests, SCIM, domain auto-join |
| Knowledge | Saved textual cards, TXT/Markdown, selected native Google Docs and Drive TXT/Markdown | PDF/OCR, spreadsheets, slides, arbitrary websites, entire Drive/mailbox crawling |
| RAG | Authorized hybrid search, citations, optional grounded answer | Autonomous multi-step research, custom rerankers |
| LLM | Answer, summarize selected text, compose/revise email | Arbitrary tool execution, sending mail, autonomous workflows |
| Google | GIS sign-in, per-user connections, selected Drive import, Gmail draft creation, primary Calendar event creation | Gmail reading/replies, Calendar invitations, recurring events, ongoing synchronization |
| Hosting | Documented hosted and self-hosted Supabase paths | Kubernetes, multi-region failover |

Bookmark URLs are stored as metadata; the MVP never fetches them. Event cards are not a reminder-delivery system. Google integration can be unavailable while card CRUD remains usable. A user can copy a locally generated email draft without granting Gmail access.

## Privacy semantics

Every object belongs to exactly one workspace. Within that workspace it is either private to its owner or shared with current workspace members. New cards and imports are private by default. Sharing is an explicit action, even in a team workspace. An owner's personal Google connection never becomes a team credential.

Drive imports create app-managed snapshots, not a mirror of Google permissions. Sharing a snapshot grants app members access independently of the original Google document. Show this before sharing. Source deletion or membership removal blocks subsequent retrieval immediately. Google permission changes are discovered on refresh, not continuously; the UI displays imported-at time and the snapshot model.

## Success and release targets

Proposed targets, to be measured rather than advertised: at least 90% correct routing on 120 labeled English intent examples; Recall@5 at least 0.85 on 50 answerable synthetic knowledge queries; at least 90% citation-supported factual claims in the answer evaluation; zero unauthorized disclosures in the isolation suite. Usability target: new users can save a note, find an imported fact, and prepare a Gmail draft without instructions beyond the UI.

MVP scale envelope: 20 active users per workspace; 1,000 documents and 50,000 active chunks per workspace; 5 MiB per upload; 100,000 extracted characters per document. Hard reject excessive input with actionable errors. These are initial configurable product limits, not claims about Supabase limits.

## Assumptions requiring later validation

English parsing is the MVP baseline; preserve Unicode content and timezone-aware dates. Indonesian classification/localization is a later evaluated extension. Team membership is invitation-only. One Google account per app user is supported and must match their Google sign-in subject. Installation-wide AI credentials are sufficient for MVP; bring-your-own-key per user/team is deferred. The final name, licensing copyright, exact models, and deployment sizing are M0 decisions.
