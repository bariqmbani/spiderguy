import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { rpcMessage, supabase } from "../lib/supabase.ts";
import { Composer } from "./Composer.tsx";
import { CardList } from "./CardList.tsx";
import { Knowledge } from "./Knowledge.tsx";
import { Team } from "./Team.tsx";
import { GooglePanel } from "./GooglePanel.tsx";
import type { Membership, Workspace } from "../types.ts";

type Tab = "capture" | "knowledge" | "team" | "google";

export function Shell({ session }: { session: Session }) {
  const userId = session.user.id;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(() => localStorage.getItem("ws"));
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [{ data: ws }, { data: ms }] = await Promise.all([
      supabase.from("workspaces").select("id, kind, name, owner_id").order("kind", { ascending: true }).order("created_at"),
      supabase.from("memberships").select("workspace_id, user_id, role, state").eq("user_id", userId).eq("state", "active"),
    ]);
    const list = (ws ?? []) as Workspace[];
    setWorkspaces(list);
    setRoles(Object.fromEntries(((ms ?? []) as Membership[]).map((m) => [m.workspace_id, m.role])));
    setActive((cur) => (cur && list.some((w) => w.id === cur) ? cur : list[0]?.id ?? null));
  }, [userId]);

  useEffect(() => {
    (async () => {
      await supabase.rpc("ensure_bootstrap");
      const token = new URLSearchParams(location.search).get("invite");
      if (token) {
        history.replaceState(null, "", location.pathname);
        const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
        if (error) setNotice(`Invite could not be accepted: ${rpcMessage(error)} It may be expired, used, or for a different email.`);
        else {
          setNotice("You joined the workspace.");
          setActive(data as string);
        }
      }
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (active) localStorage.setItem("ws", active);
  }, [active]);

  const dirty = useRef(false);
  const workspace = workspaces.find((w) => w.id === active);

  function switchTo(id: string) {
    if (id === active) return;
    if (dirty.current && !confirm("Discard your unsaved input? It will not be moved to the other workspace.")) return;
    dirty.current = false;
    setActive(id);
  }

  return (
    <div className="shell">
      <header className="top">
        <strong>ShapeShift</strong>
        <label className="row">
          <span className="sr-only">Workspace</span>
          <select value={active ?? ""} onChange={(e) => switchTo(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.kind === "personal" ? "🔒 " : "👥 "}{w.name}</option>)}
          </select>
        </label>
        {workspace && <span className="badge">{workspace.kind === "personal" ? "Personal" : `Team · ${roles[workspace.id] ?? ""}`}</span>}
        <span className="spacer" />
        <span className="muted small">{session.user.email}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {notice && <p role="status" className="notice">{notice}</p>}
      {workspace ? (
        <WorkspaceView key={workspace.id} workspace={workspace} userId={userId} role={roles[workspace.id] ?? "member"}
          onDirty={(d) => { dirty.current = d; }} onWorkspacesChanged={load} />
      ) : <p className="center muted">Loading workspace…</p>}
    </div>
  );
}

/** Keyed by workspace: switching unmounts everything, aborting requests and clearing cached results. */
function WorkspaceView({ workspace, userId, role, onDirty, onWorkspacesChanged }: {
  workspace: Workspace; userId: string; role: string; onDirty: (d: boolean) => void; onWorkspacesChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("capture");
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const tabs: [Tab, string][] = [["capture", "Capture"], ["knowledge", "Knowledge"], ["team", "Team"], ["google", "Google"]];
  return (
    <main>
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <div hidden={tab !== "capture"}>
        <Composer workspace={workspace} onDirty={onDirty} onSaved={() => setRefresh((n) => n + 1)} onSearch={(q) => { setQuery(q); setTab("knowledge"); }} />
        <CardList workspaceId={workspace.id} userId={userId} role={role} refreshKey={refresh} />
      </div>
      {tab === "knowledge" && <Knowledge workspace={workspace} userId={userId} initialQuery={query} />}
      {tab === "team" && <Team workspace={workspace} userId={userId} role={role} onChanged={onWorkspacesChanged} />}
      {tab === "google" && <GooglePanel />}
    </main>
  );
}
