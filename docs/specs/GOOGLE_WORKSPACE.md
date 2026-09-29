# Google Workspace integration

## Identity and connections

Use Google Identity Services (GIS) sign-in and exchange the verified Google ID token through Supabase `signInWithIdToken` to obtain the app session. Preserve nonce checking and configure valid audience/origins. This respects a Google SDK frontend while leaving session ownership with Supabase. The ID token is not a Google API access token.

Connect Drive/Gmail/Calendar separately through GIS authorization-code flow. A server-created, one-use state binds the user, requested capability, callback/origin, and ten-minute expiry. Edge Function callback validates state and exact redirect URI, exchanges code server-side, and validates the Google subject against the app user's Google identity. Reject account mismatch. Follow GIS code-flow CSRF/origin guidance and use PKCE where supported by the selected documented flow; do not assume browser sign-in provides a refresh token.

Keep refresh/access tokens encrypted with an operator-managed key outside DB backups, key version recorded. Only server functions can decrypt. Serialize token refresh per connection, preserve the old refresh token when Google omits a new one, and mark invalid_grant as reconnect_required. Do not assume Supabase refreshes Google credentials. Request offline access using the supported flow when required; missing offline credentials results in a clear reconnect prompt.

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
