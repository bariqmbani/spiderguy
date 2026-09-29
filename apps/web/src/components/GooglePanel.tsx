import { useCallback, useEffect, useState } from "react";
import { api, ApiError, supabase } from "../lib/supabase.ts";
import { requestCode } from "../lib/google.ts";

type Conn = { email: string; scopes: string[]; status: string; updated_at: string };
const CAPS = [
  { id: "drive", label: "Google Drive (selected files only)", scope: "https://www.googleapis.com/auth/drive.file" },
  { id: "gmail", label: "Gmail (create drafts only; never sends)", scope: "https://www.googleapis.com/auth/gmail.compose" },
  { id: "calendar", label: "Google Calendar (events you create)", scope: "https://www.googleapis.com/auth/calendar.events.owned" },
] as const;

export function GooglePanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conn, setConn] = useState<Conn | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("google_connections").select("email, scopes, status, updated_at").maybeSingle();
    setConn(data as Conn | null);
  }, []);

  useEffect(() => {
    api<{ configured: boolean }>("google-config").then((c) => setConfigured(c.configured)).catch(() => setConfigured(false));
    load();
  }, [load]);

  async function connect(capability: string) {
    setMsg("");
    try {
      const cfg = await api<{ client_id: string; scope: string; state: string }>("google-connect", { capability });
      const { code, state } = await requestCode(cfg.client_id, cfg.scope, cfg.state);
      await api("google-callback", { code, state });
      setMsg("Connected.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : `Not connected: ${(e as Error).message}`);
    }
    load();
  }

  async function disconnect() {
    if (!confirm("Disconnect Google? Imported Drive snapshots become unavailable.")) return;
    await api("google-disconnect", {}).catch((e: Error) => setMsg(e.message));
    load();
  }

  if (configured === false) {
    return <p className="muted">Google integration is not configured on this installation (operator must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). Everything else works; you can still copy drafts manually.</p>;
  }
  const active = conn?.status === "active";
  return (
    <div className="stack">
      <p>{conn ? <>Connected as <strong>{conn.email}</strong> · {conn.status === "active" ? "active" : conn.status === "reconnect_required" ? "reconnect required" : "disconnected"}</> : "Not connected."} <span className="muted small">Your Google connection is personal; teammates can never use it.</span></p>
      <ul className="plain">
        {CAPS.map((c) => {
          const granted = active && conn!.scopes.includes(c.scope);
          return (
            <li key={c.id} className="row">
              <span>{c.label}: {granted ? "✓ granted" : "not granted"}</span>
              {!granted && <button className="secondary" onClick={() => connect(c.id)}>{conn?.status === "reconnect_required" ? "Reconnect" : "Connect"}</button>}
            </li>
          );
        })}
      </ul>
      {conn && conn.status !== "disconnected" && <button className="danger" onClick={disconnect}>Disconnect Google</button>}
      {msg && <p role="status" className="muted">{msg}</p>}
    </div>
  );
}
