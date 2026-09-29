import { useCallback, useEffect, useState } from "react";
import { api, supabase } from "../lib/supabase.ts";
import { type Capability, connectGoogle, SCOPES } from "../lib/google.ts";

type Conn = { email: string; scopes: string[]; status: string; updated_at: string };
const CAPS: { id: Capability; label: string }[] = [
  { id: "drive", label: "Google Drive (selected files only)" },
  { id: "gmail", label: "Gmail (create drafts only; never sends)" },
  { id: "calendar", label: "Google Calendar (events you create)" },
];

export function GooglePanel({ userId }: { userId: string }) {
  const [refresh, setRefresh] = useState<boolean | null>(null);
  const [conn, setConn] = useState<Conn | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("google_connections").select("email, scopes, status, updated_at").maybeSingle();
    setConn(data as Conn | null);
  }, []);

  useEffect(() => {
    api<{ refresh_enabled: boolean }>("google-config").then((c) => setRefresh(c.refresh_enabled)).catch(() => setRefresh(false));
    load();
  }, [load]);

  async function connect(capability: Capability) {
    setMsg("");
    try {
      await connectGoogle(capability, userId);
    } catch (e) {
      setMsg(`Google sign-in is unavailable: ${(e as Error).message}`);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Google? Imported Drive snapshots become unavailable.")) return;
    await api("google-disconnect", {}).catch((e: Error) => setMsg(e.message));
    load();
  }

  const active = conn?.status === "active";
  return (
    <div className="stack">
      <p>
        {conn ? <>Connected as <strong>{conn.email}</strong> · {conn.status === "active" ? "active" : conn.status === "reconnect_required" ? "reconnect required" : "disconnected"}</> : "Not connected."}{" "}
        <span className="muted small">Your Google connection is personal; teammates can never use it.</span>
      </p>
      <ul className="plain">
        {CAPS.map((c) => {
          const granted = active && conn!.scopes.includes(SCOPES[c.id]);
          return (
            <li key={c.id} className="row">
              <span>{c.label}: {granted ? "✓ granted" : "not granted"}</span>
              {!granted && <button className="secondary" onClick={() => connect(c.id)}>{conn?.status === "reconnect_required" ? "Reconnect" : "Connect"}</button>}
            </li>
          );
        })}
      </ul>
      {refresh === false && <p className="muted small">This installation cannot refresh Google access in the background, so connections last about an hour before you are asked to reconnect.</p>}
      {conn && conn.status !== "disconnected" && <button className="danger" onClick={disconnect}>Disconnect Google</button>}
      {msg && <p role="status" className="muted">{msg}</p>}
    </div>
  );
}
