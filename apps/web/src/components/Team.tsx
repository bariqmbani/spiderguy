import { useCallback, useEffect, useState } from "react";
import { rpcMessage, supabase } from "../lib/supabase.ts";
import type { Workspace } from "../types.ts";

type Member = { user_id: string; role: string; joined_at: string; profile?: { display_name: string; email: string } };
type Invite = { id: string; email_normalized: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };

export function Team({ workspace, userId, role, onChanged }: { workspace: Workspace; userId: string; role: string; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState("");
  const team = workspace.kind === "team";

  const load = useCallback(async () => {
    const { data: m } = await supabase.from("memberships").select("user_id, role, joined_at").eq("workspace_id", workspace.id).eq("state", "active");
    const ids = (m ?? []).map((x) => x.user_id);
    const { data: p } = ids.length ? await supabase.from("profiles").select("id, display_name, email").in("id", ids) : { data: [] };
    const byId = new Map((p ?? []).map((x) => [x.id, x]));
    setMembers(((m ?? []) as Member[]).map((x) => ({ ...x, profile: byId.get(x.user_id) })));
    if (["owner", "admin"].includes(role)) {
      const { data: i } = await supabase.from("invitations").select("id, email_normalized, expires_at, accepted_at, revoked_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(50);
      setInvites((i ?? []) as Invite[]);
    }
  }, [workspace.id, role]);

  useEffect(() => {
    load();
  }, [load]);

  async function call(fn: string, args: Record<string, unknown>, done?: string) {
    const { data, error } = await supabase.rpc(fn, args);
    setMsg(error ? rpcMessage(error) : done ?? "");
    load();
    return error ? null : data;
  }

  async function createTeam(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    if (await call("create_workspace", { p_name: name }, `Created "${name}".`)) onChanged();
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email"));
    const r = await call("create_invite", { p_workspace_id: workspace.id, p_email: email });
    if (r) {
      setLink(`${location.origin}${location.pathname}?invite=${r.token}`);
      form.reset();
    }
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={createTeam}>
        <input name="name" required maxLength={80} placeholder="New team name" aria-label="New team name" />
        <button>Create team workspace</button>
      </form>
      {!team && <p className="muted">This is your personal workspace. Create a team workspace to collaborate; personal workspaces cannot be shared.</p>}
      {team && (
        <>
          <h2>Members</h2>
          <ul className="plain">
            {members.map((m) => (
              <li key={m.user_id} className="row">
                <span>{m.profile?.display_name || m.profile?.email || m.user_id} <span className="muted small">{m.profile?.email} · {m.role}</span></span>
                {role === "owner" && m.role !== "owner" && (
                  <>
                    <button className="link" onClick={() => call("set_member_role", { p_workspace_id: workspace.id, p_user_id: m.user_id, p_role: m.role === "admin" ? "member" : "admin" })}>
                      Make {m.role === "admin" ? "member" : "admin"}
                    </button>
                    <button className="link" onClick={() => confirm("Transfer ownership? You will become an admin.") && call("transfer_owner", { p_workspace_id: workspace.id, p_user_id: m.user_id }).then(onChanged)}>Transfer ownership</button>
                  </>
                )}
                {m.user_id !== userId && m.role !== "owner" && (role === "owner" || (role === "admin" && m.role === "member")) && (
                  <button className="link" onClick={() => confirm("Remove this member? Their private content in this team becomes inaccessible.") && call("remove_member", { p_workspace_id: workspace.id, p_user_id: m.user_id })}>Remove</button>
                )}
              </li>
            ))}
          </ul>
          {["owner", "admin"].includes(role) && (
            <>
              <h2>Invite</h2>
              <form className="row" onSubmit={invite}>
                <input name="email" type="email" required placeholder="teammate@example.com" aria-label="Invite email" />
                <button>Create invite link</button>
              </form>
              {link && <p className="small">Send this single-use link (expires in 7 days, only works for that email): <code>{link}</code></p>}
              <ul className="plain small">
                {invites.map((i) => (
                  <li key={i.id}>
                    {i.email_normalized} · {i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : `pending until ${new Date(i.expires_at).toLocaleDateString()}`}
                    {!i.accepted_at && !i.revoked_at && <button className="link" onClick={() => call("revoke_invite", { p_invite_id: i.id })}>Revoke</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row">
            {role !== "owner" && <button className="secondary" onClick={() => confirm("Leave this workspace?") && call("remove_member", { p_workspace_id: workspace.id, p_user_id: userId }).then(onChanged)}>Leave workspace</button>}
            {role === "owner" && <button className="danger" onClick={() => confirm(`Delete "${workspace.name}" for everyone?`) && call("delete_workspace", { p_workspace_id: workspace.id }).then(onChanged)}>Delete workspace</button>}
          </div>
        </>
      )}
      {msg && <p role="status" className="muted">{msg}</p>}
    </div>
  );
}
