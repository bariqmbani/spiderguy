# Spec Delta

## Purpose

Lets users express work in one adaptive input and save the result as typed, editable cards. Classification assists the interface but never bypasses explicit user control or server validation.

## ADDED Requirements

### Requirement: Adaptive input preserves manual control and response ordering
The system MUST support Jev-suggested note, checklist, event, bookmark, search, and email intents while always providing a manual palette. Only the latest input response may update the preview, and low-confidence classification MUST NOT save or execute an action.

#### Scenario: Current classification returns a supported intent
- **WHEN** the classifier returns a valid result for the current text sequence
- **THEN** the interface MUST show an editable preview for the supported intent

#### Scenario: Manual choice or newer input supersedes classification
- **WHEN** a user chooses an intent manually or changes the text before an earlier response arrives
- **THEN** the earlier response MUST NOT replace the user's current choice or preview

#### Scenario: Classifier is unavailable or uncertain
- **WHEN** classification fails or confidence is below the configured threshold
- **THEN** the system MUST preserve the input and expose manual selection without saving or executing anything

### Requirement: Typed cards support durable, optimistic CRUD
The system MUST persist versioned note, checklist, event, bookmark, and email payloads; validate each payload at the API and database boundary; default new cards to private; and use expected revisions for edits.

#### Scenario: Valid card is saved, reloaded, and edited
- **WHEN** an authorized user saves a valid card and later edits it with the current revision
- **THEN** the system MUST persist the card and increment its revision

#### Scenario: Payload is invalid or edit is stale
- **WHEN** a payload fails its type schema or an update uses an obsolete revision
- **THEN** the system MUST reject the mutation with actionable validation errors or a conflict while preserving the newer content

#### Scenario: Search intent is selected
- **WHEN** a user selects knowledge search
- **THEN** search MUST be a transient interface state and MUST NOT be persisted as a content card