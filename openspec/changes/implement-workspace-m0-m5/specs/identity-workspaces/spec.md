# Spec Delta

## Purpose

Provides authenticated personal and team workspaces with database-enforced membership and content isolation. It makes explicit sharing, verified invitations, and current authorization the basis for access.

## ADDED Requirements

### Requirement: Google identity establishes a Supabase session
The system MUST exchange a verified Google sign-in identity for a Supabase application session without requiring Google Workspace API scopes. A valid first sign-in MUST create exactly one personal workspace for the user.

#### Scenario: First valid sign-in
- **WHEN** a user completes Google sign-in with a valid audience and nonce
- **THEN** the system MUST establish a Supabase session and create or return that user's single personal workspace

#### Scenario: Invalid or canceled sign-in
- **WHEN** sign-in is canceled or identity validation fails
- **THEN** the system MUST NOT create an authenticated session or grant workspace access

### Requirement: Workspace membership controls tenant access
The system MUST enforce current membership and object visibility in the database for every workspace-scoped read and write. New content MUST be private to its owner by default; sharing MUST be an explicit owner action.

#### Scenario: Member accesses private and shared content
- **WHEN** a workspace member requests another member's private item or an explicitly shared item
- **THEN** the private item MUST remain unavailable and the shared item MUST be available subject to its current source and membership state

#### Scenario: Nonmember guesses an object identifier
- **WHEN** a user outside the workspace requests a known or guessed workspace object identifier
- **THEN** the system MUST deny access without revealing whether the object exists

### Requirement: Team roles and invitations are transactionally enforced
The system MUST support owner, admin, and member roles; seven-day single-use invitations bound to a normalized verified email; protected role changes and ownership transfer; and atomic removal or acceptance. Personal workspaces MUST NOT accept team invitations or additional members.

#### Scenario: Invitation is accepted by the matching user
- **WHEN** an authenticated user with a matching verified email accepts an unexpired invitation
- **THEN** the system MUST atomically consume the invitation and establish one active member record

#### Scenario: Invite is invalid or privileged operation is unauthorized
- **WHEN** an invite is expired, reused, email-mismatched, or a non-owner requests a reserved role or ownership transfer
- **THEN** the operation MUST fail without changing membership or leaving the workspace without an owner

### Requirement: Removed members lose access on the next authorization check
The system MUST re-evaluate current membership for requests, background work, and pending external actions; an unexpired application token MUST NOT preserve access after removal.

#### Scenario: Membership is removed during a provider operation
- **WHEN** membership is revoked before sensitive output is returned or an action is dispatched
- **THEN** the system MUST discard the result or reject the action and deny subsequent reads and writes

#### Scenario: User switches workspaces
- **WHEN** the active workspace changes
- **THEN** the client MUST clear prior workspace query caches and ignore in-flight results from the previous workspace