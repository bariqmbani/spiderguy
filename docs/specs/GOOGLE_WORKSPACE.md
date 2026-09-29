# Google Workspace integration

## Identity and connections

Sign-in and Google API authorization both use Supabase Auth's Google provider (ADR-0001 deviation 10; user instruction). Google sign-in is `signInWithOAuth({provider:'google'})` with a redirect back to the SPA (preserving `?invite=`). Supabase owns the session and handles OAuth state/PKCE. The Supabase session is application authorization; a Google token is never used as one.

Connect Drive/Gmail/Calendar separately with incremental consent:

1. The SPA records the pending capability and current app user ID in `sessionStorage` (no tokens), then calls `linkIdentity` (if the user has no Google identity yet; requires Supabase manual linking) or `signInWithOAuth` with exactly one capability scope, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, and `redirectTo ?google_connect=<capability>`.
2. On return, the SPA requires the query capability to match the pending one and the returned session user to be the same app user, then POSTs `provider_token` and `provider_refresh_token` once to `google-session-connect` and immediately calls `refreshSession()` so the stored session no longer carries them.
3. The server validates the access token with Google `tokeninfo`, requires `aud`/`azp` to equal `GOOGLE_CLIENT_ID` when configured, requires `sub` to equal the user's linked Supabase Google identity (`ACCOUNT_MISMATCH` otherwise), and requires the capability scope (`SCOPE_DENIED` otherwise). A different Google subject while a connection is active is also rejected.

Accepted trade-off: provider tokens are briefly present in the browser's Supabase session before hand-off. Do not log or persist them elsewhere in the client.

Keep refresh/access tokens encrypted with an operator-managed key outside DB backups, key version recorded. Only server functions can decrypt. Serialize token refresh per connection, preserve the old refresh token when Google omits a new one, and mark invalid_grant as reconnect_required. Supabase does not refresh Google provider tokens; the server refreshes them with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` of the same OAuth client configured in Supabase. Without those secrets (or without a refresh token), access lasts about one hour and then returns `RECONNECT_REQUIRED` with a clear reconnect prompt.

## Capability and scope contract

| Capability | Requested scopes | Product restriction |
|---|---|---|
| App sign-in | openid, email, profile | Identity only |
| Selected Drive imports | `https://www.googleapis.com/auth/drive.file` plus Picker configuration | Read only selected files in app code; the OAuth grant itself is broader than read-only |
| Gmail draft save | `https://www.googleapis.com/auth/gmail.compose` | Draft creation only; this scope also permits sending, so scope alone does not enforce product policy |
| Primary Calendar event | `https://www.googleapis.com/auth/calendar.events.owned` | Create only in primary calendar; no attendees, recurring events, or general calendar browsing |

These choices are implementation proposals grounded in current Google documentation. Verify actual consent and method compatibility in M0/M5. Gmail compose is a restricted scope; deployment audience and use of Google data can trigger verification/security assessment requirements. Self-hosting is not an automatic exemption. Document the operator's test/internal/external audience configuration and enabled APIs before release.

## Drive snapshots

Use Google Picker to select only supported files. Browser Picker access tokens are short-lived and held only in memory; a refresh token is never returned to the browser. The server rechecks file metadata/access and MIME independently, then downloads/exports using the user's stored connection. Accept Google file IDs, not arbitrary URLs. Limit stream bytes and exported text size, follow only expected Google API hosts, and reject unsupported types with a reason.

The private snapshot stores file ID, canonical source link, import time, external modified time, revision hash, and connection owner. No folder crawler, watch subscription, or automatic periodic refresh in MVP. Refresh is explicit and idempotent. Share dialog: “This creates a shared copy in this workspace. Google sharing changes will not automatically change access to this copy.”

Disconnect first disables use and makes all associated snapshots unavailable, including team-shared copies, then revokes the grant best-effort and purges local credentials/content asynchronously. Show this consequence before disconnect. Reconnecting does not silently restore old snapshots; user must reimport.

## Gmail draft action

Generation only creates editable app content. Prepare a Gmail action with account, explicit To/Cc/Bcc addresses, subject, plain-text body, and payload hash. MVP: no attachments, no reply/thread IDs, no mailbox reads. Confirmation screen shows exact content and “Save to Gmail drafts — does not send.” Editing any field invalidates the prepared action.

Execute `users.drafts.create` with a correctly encoded RFC 2822 MIME message in base64url. Reject CR/LF in headers, validate addresses, and encode Unicode subject/body correctly. Keep provider draft ID on success. Never expose or implement drafts.send/messages.send. Opening Gmail for user review is separate from the API mutation.

Gmail create has no assumed idempotency key. Before the provider call, mark action executing transactionally. Concurrent duplicate requests return that action state. If the response is lost, mark outcome_unknown and do not retry automatically; user checks Gmail before explicitly starting a new action. This is not an exactly-once promise. A successful recorded result is replayed for repeat confirmation.

## Calendar action

Use the user's primary calendar, verified connection, explicit title, start/end and IANA timezone; optional description/location. No attendees, Meet generation, reminders customization, or recurrence in MVP. Missing end time can be proposed as +30 minutes but requires visible confirmation. Ambiguous local time during DST must be resolved; nonexistent local time is rejected.

Generate a valid deterministic Google event ID from the action UUID using the API-allowed encoding, validated in the connector spike. On timeout, retrieve that ID to reconcile before retrying; verify ownership and expected payload. Store the Google event ID and expose a success link. Saving an internal event card alone never creates a Google event.

## Common action rules

Action snapshot expires after ten minutes. Confirmation requires matching actor, workspace, connection version, card revision if used, and payload hash. Recheck current membership and scopes immediately before dispatch. A stale or removed user receives an error. Disconnect increments connection version and invalidates pending actions. Persist sanitized audit records. A provider 429 honors Retry-After only for operations safe to retry; a provider error does not erase the user's app draft.
