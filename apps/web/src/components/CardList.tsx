import { useCallback, useEffect, useState } from "react";
import { safeHttpUrl, validatePayload } from "@shared/schemas.ts";
import { rpcMessage, supabase } from "../lib/supabase.ts";
import { CardFields } from "./CardFields.tsx";
import { ActionDialog } from "./ActionDialog.tsx";
import type { Card, Source } from "../types.ts";

const PAGE = 25;

export function CardList({ workspaceId, userId, role, refreshKey }: { workspaceId: string; userId: string; role: string; refreshKey: number }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (append = false, before?: Card) => {
    let q = supabase.from("cards").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE);
    if (before) q = q.lt("created_at", before.created_at);
    const { data, error } = await q;
    if (error) return setError("Could not load cards.");
    const rows = (data ?? []) as Card[];
    setCards((c) => (append ? [...c, ...rows] : rows));
    setMore(rows.length === PAGE);
    const ids = rows.map((c) => c.id);
    if (ids.length) {
      const { data: s } = await supabase.from("sources").select("*").in("card_id", ids);
      setSources((m) => ({ ...(append ? m : {}), ...Object.fromEntries(((s ?? []) as Source[]).map((x) => [x.card_id!, x])) }));
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!Object.values(sources).some((s) => ["pending", "processing", "retry_wait"].includes(s.state))) return;
    const t = setTimeout(() => load(), 4000);
    return () => clearTimeout(t);
  }, [sources, load]);

  return (
    <section aria-label="Saved cards">
      {error && <p className="error">{error}</p>}
      {!cards.length && <p className="muted">No cards yet. Type above to create one.</p>}
      <ul className="cards">
        {cards.map((c) => (
          <CardItem key={c.id} card={c} source={sources[c.id]} userId={userId} role={role} onChanged={() => load()} />
        ))}
      </ul>
      {more && <button className="secondary" onClick={() => load(true, cards[cards.length - 1])}>Load more</button>}
    </section>
  );
}

function summary(c: Card): React.ReactNode {
  const p = c.payload as Record<string, never>;
  switch (c.type) {
    case "note":
      return <><strong>{p.title}</strong><p className="pre">{p.text}</p></>;
    case "checklist":
      return <><strong>{p.title || "Checklist"}</strong><ul className="plain">{(p.items as { text: string; done: boolean }[]).map((i, k) => <li key={k}>{i.done ? "☑" : "☐"} {i.text}</li>)}</ul></>;
    case "event":
      return <><strong>{p.title}</strong><p>{new Date(p.start).toLocaleString(undefined, { timeZone: p.timezone })} – {new Date(p.end).toLocaleTimeString(undefined, { timeZone: p.timezone, hour: "2-digit", minute: "2-digit" })} ({p.timezone}){p.location ? ` · ${p.location}` : ""}</p></>;
    case "bookmark": {
      const href = safeHttpUrl(p.url);
      return <><strong>{p.title || p.url}</strong><p>{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{p.url}</a> : p.url}</p>{p.note && <p>{p.note}</p>}</>;
    }
    case "email":
      return <><strong>{p.subject || "(no subject)"}</strong><p className="muted small">To: {(p.to as string[]).join(", ")}</p><p className="pre">{p.body}</p></>;
  }
}

function CardItem({ card, source, userId, role, onChanged }: { card: Card; source?: Source; userId: string; role: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"gmail_draft" | "calendar_event" | null>(null);
  const mine = card.owner_id === userId;
  const canEdit = mine || (card.visibility === "workspace" && ["owner", "admin"].includes(role));

  async function saveEdit() {
    const v = validatePayload(card.type, editing);
    if (!v.success) return setError(v.error.issues[0]?.message ?? "Invalid");
    const { error } = await supabase.rpc("update_card", { p_card_id: card.id, p_expected_revision: card.revision, p_payload: v.data });
    if (error) return setError(rpcMessage(error));
    setEditing(null);
    setError("");
    onChanged();
  }

  async function toggleItem(i: number) {
    const items = (card.payload.items as { text: string; done: boolean }[]).map((x, k) => (k === i ? { ...x, done: !x.done } : x));
    const { error } = await supabase.rpc("update_card", { p_card_id: card.id, p_expected_revision: card.revision, p_payload: { ...card.payload, items } });
    if (error) setError(rpcMessage(error));
    onChanged();
  }

  async function share(visibility: "private" | "workspace") {
    const { error } = await supabase.rpc("set_card_visibility", { p_card_id: card.id, p_expected_revision: card.revision, p_visibility: visibility });
    if (error) {
      setError(error.message?.startsWith("PRIVATE_DEPENDENCIES")
        ? "This card was generated from private sources. Share those sources and regenerate, or remove them."
        : rpcMessage(error));
      return;
    }
    onChanged();
  }

  async function remove() {
    if (!confirm("Delete this card? It will also be removed from search.")) return;
    const { error } = await supabase.rpc("delete_card", { p_card_id: card.id, p_expected_revision: card.revision });
    if (error) return setError(rpcMessage(error));
    onChanged();
  }

  return (
    <li className="card">
      <header>
        <span className="tag">{card.type}</span>
        <span className={card.visibility === "private" ? "badge private" : "badge shared"}>{card.visibility === "private" ? "🔒 Private" : "👥 Shared"}</span>
        {card.generated && <span className="badge">AI-assisted</span>}
        {source && <span className="muted small">index: {source.state}{source.error_code ? ` (${source.error_code})` : ""}</span>}
        {card.hidden_reason && <span className="warn small">Unshared because a source became private or was deleted.</span>}
      </header>
      {editing ? (
        <>
          <CardFields type={card.type} value={editing} onChange={setEditing} />
          <div className="row">
            <button onClick={saveEdit}>Save</button>
            <button className="secondary" onClick={() => { setEditing(null); setError(""); }}>Cancel</button>
            {error && <button className="link" onClick={onChanged}>Reload latest</button>}
          </div>
        </>
      ) : card.type === "checklist" && canEdit ? (
        <>
          <strong>{String(card.payload.title || "Checklist")}</strong>
          <ul className="plain">
            {(card.payload.items as { text: string; done: boolean }[]).map((i, k) => (
              <li key={k}><label><input type="checkbox" checked={i.done} onChange={() => toggleItem(k)} /> {i.text}</label></li>
            ))}
          </ul>
        </>
      ) : summary(card)}
      {error && <p role="alert" className="error">{error}</p>}
      {!editing && (
        <div className="row small">
          {canEdit && <button className="link" onClick={() => setEditing(card.payload)}>Edit</button>}
          {canEdit && <button className="link" onClick={remove}>Delete</button>}
          {mine && card.visibility === "private" && <button className="link" onClick={() => share("workspace")}>Share with workspace</button>}
          {mine && card.visibility === "workspace" && <button className="link" onClick={() => share("private")}>Make private</button>}
          {mine && card.type === "event" && <button className="link" onClick={() => setAction("calendar_event")}>Create in Google Calendar</button>}
          {mine && card.type === "email" && (card.payload.to as string[]).length > 0 && <button className="link" onClick={() => setAction("gmail_draft")}>Save to Gmail drafts</button>}
        </div>
      )}
      {action && (
        <ActionDialog workspaceId={card.workspace_id} kind={action}
          payload={Object.fromEntries(Object.entries(card.payload).filter(([k]) => k !== "citations" && k !== "tone"))} onClose={() => setAction(null)} />
      )}
    </li>
  );
}
