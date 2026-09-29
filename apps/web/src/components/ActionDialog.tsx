import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/supabase.ts";

type Prepared = { action_id: string; payload_hash: string; expires_at: string; preview: Record<string, unknown>; account_email: string | null; destination: string };
type Outcome = { state: string; provider_link: string | null; error_code: string | null };

/** Prepare → show immutable server snapshot → explicit confirm → execute. Never retried automatically. */
export function ActionDialog({ workspaceId, kind, payload, onClose }: {
  workspaceId: string; kind: "gmail_draft" | "calendar_event"; payload: Record<string, unknown>; onClose: () => void;
}) {
  const key = useRef(crypto.randomUUID());
  const [snapshot] = useState(payload);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Prepared>("action-prepare", { workspace_id: workspaceId, kind, payload: snapshot, idempotency_key: key.current })
      .then(setPrepared)
      .catch((e: ApiError) => setError(e.code === "RECONNECT_REQUIRED" ? "Connect your Google account in the Google tab first. Your content is kept." : e.message));
  }, [workspaceId, kind, snapshot]);

  async function confirm() {
    if (!prepared || busy) return;
    setBusy(true);
    try {
      setOutcome(await api<Outcome>("action-execute", { action_id: prepared.action_id, payload_hash: prepared.payload_hash }));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const p = prepared?.preview ?? {};
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="action-title">
      <div className="dialog">
        <h2 id="action-title">{kind === "gmail_draft" ? "Save to Gmail drafts" : "Create in Google Calendar"}</h2>
        {!prepared && !error && <p>Preparing…</p>}
        {prepared && (
          <dl className="snapshot">
            <dt>Google account</dt><dd>{prepared.account_email ?? "unknown"}</dd>
            <dt>Destination</dt><dd>{prepared.destination}</dd>
            {kind === "gmail_draft" ? (
              <>
                <dt>To</dt><dd>{(p.to as string[]).join(", ")}</dd>
                {Array.isArray(p.cc) && <><dt>Cc</dt><dd>{(p.cc as string[]).join(", ")}</dd></>}
                <dt>Subject</dt><dd>{String(p.subject)}</dd>
                <dt>Body</dt><dd><pre>{String(p.body)}</pre></dd>
              </>
            ) : (
              <>
                <dt>Title</dt><dd>{String(p.title)}</dd>
                <dt>Start</dt><dd>{String(p.start)} ({String(p.timezone)})</dd>
                <dt>End</dt><dd>{String(p.end)}</dd>
                {p.location ? <><dt>Location</dt><dd>{String(p.location)}</dd></> : null}
                <dt>Attendees</dt><dd>None (no invitations are sent)</dd>
              </>
            )}
          </dl>
        )}
        {outcome?.state === "succeeded" && (
          <p role="status">Done. {outcome.provider_link && <a href={outcome.provider_link} target="_blank" rel="noopener noreferrer">Open in Google</a>}</p>
        )}
        {outcome?.state === "outcome_unknown" && (
          <p role="alert" className="warn">We couldn't confirm the result. Check {kind === "gmail_draft" ? "your Gmail Drafts folder" : "your Google Calendar"} before trying again.</p>
        )}
        {outcome && ["failed", "expired"].includes(outcome.state) && <p role="alert" className="error">Not completed ({outcome.error_code ?? outcome.state}).</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="row">
          {prepared && !outcome && <button disabled={busy} onClick={confirm}>{busy ? "Working…" : "Confirm"}</button>}
          <button className="secondary" onClick={onClose}>{outcome ? "Close" : "Cancel"}</button>
        </div>
      </div>
    </div>
  );
}
