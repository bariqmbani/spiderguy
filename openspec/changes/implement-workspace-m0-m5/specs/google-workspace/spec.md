# Spec Delta

## Purpose

Connects each user's Google capabilities independently from app sign-in and performs only selected, confirmed Workspace actions. Google credentials remain private to the owning user and are never shared through a team workspace.

## ADDED Requirements

### Requirement: Google API connections use scoped, server-held credentials
The system MUST request only the scopes required for the selected capability, keep refresh/access credentials encrypted and server-side, bind connection state to the authenticated user and requested capability, and support reconnect and disconnect. Sign-in alone MUST NOT grant Workspace API access.

#### Scenario: User grants one capability
- **WHEN** a user connects Drive, Gmail, or Calendar
- **THEN** the system MUST request that capability's documented scope and keep credentials inaccessible to browser storage and other workspace members

#### Scenario: Consent is denied, account mismatches, or connection is revoked
- **WHEN** a scope is denied, callback state is invalid, Google identity mismatches, or refresh returns invalid_grant
- **THEN** the system MUST reject the connection or mark only the affected capability as requiring reconnect

### Requirement: Drive imports are selected private snapshots
The system MUST import only files explicitly selected through the supported picker flow, revalidate the file using the connected account, store a private snapshot with source link and import time, and refresh only on explicit user request. The system MUST disclose that app sharing is independent of live Google ACL changes.

#### Scenario: User imports a supported selected file
- **WHEN** the server validates a picker-selected supported file
- **THEN** it MUST create a private source snapshot and display its source link and import timestamp

#### Scenario: File is unsupported or permission is lost on refresh
- **WHEN** validation rejects the file or refresh observes 403/404/disconnection
- **THEN** the system MUST report the reason and make the snapshot unavailable, cancel indexing, and queue purge as applicable

### Requirement: Gmail integration creates drafts only after exact confirmation
The system MUST show the owning account, recipients, subject, and exact body before confirmation; create an unsent Gmail draft only; and MUST NOT expose a send operation. Duplicate submissions MUST return the prior result or an explicit uncertain outcome without blind retry.

#### Scenario: User confirms the reviewed draft
- **WHEN** the authorized user confirms an unchanged prepared Gmail action
- **THEN** the system MUST create one unsent draft in that user's account and report its recorded result

#### Scenario: Concurrent or uncertain Gmail submission
- **WHEN** the same action is submitted concurrently or the provider result is lost
- **THEN** the system MUST return the existing processing state or mark outcome unknown and MUST NOT retry creation automatically

### Requirement: Calendar events require confirmation and avoid duplicates
The system MUST show and confirm title, start/end, timezone, and primary calendar; create events without attendees or recurrence; reject unresolved ambiguous local times; and use deterministic reconciliation before retrying uncertain creation.

#### Scenario: User confirms a valid event
- **WHEN** an authorized user confirms a valid event with a resolved timezone
- **THEN** the system MUST create one event in the primary calendar without attendees and return its link

#### Scenario: Event time is ambiguous or submission outcome is uncertain
- **WHEN** a local time is ambiguous/nonexistent or the provider request times out
- **THEN** the system MUST require correction or reconcile the deterministic event identifier before any retry