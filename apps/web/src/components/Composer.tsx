import { useEffect, useMemo, useRef, useState } from "react";
import { INTENTS, validatePayload, type CardType, type Intent, type IntentResult } from "@shared/schemas.ts";
import { draftPayload, keywordClassify } from "@shared/parse.ts";
import { api, ApiError, rpcMessage, supabase } from "../lib/supabase.ts";
import { applyIntent, initialPreview } from "../lib/stabilizer.ts";
import { CardFields } from "./CardFields.tsx";
import { ActionDialog } from "./ActionDialog.tsx";
import { Citations } from "./Citations.tsx";
import type { Generated, Workspace } from "../types.ts";

const LABEL: Record<Intent, string> = { note: "Note", checklist: "Checklist", event: "Event", bookmark: "Bookmark", search: "Search", email: "Email" };
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function Composer({ workspace, onSaved, onSearch, onDirty }: {
  workspace: Workspace; onSaved: () => void; onSearch: (q: string) => void; onDirty: (d: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(initialPreview);
  const [manual, setManual] = useState<Intent | null>(null);
  const [status, setStatus] = useState<"idle" | "classifying" | "jev" | "fallback">("idle");
  const [edited, setEdited] = useState<Record<string, unknown> | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [gmail, setGmail] = useState(false);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => onDirty(!!text.trim() || !!edited), [text, edited, onDirty]);
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    abort.current?.abort();
    if (!text.trim()) {
      setPreview(initialPreview);
      setStatus("idle");
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      setStatus("classifying");
      let r: IntentResult;
      try {
        r = await api<IntentResult>("intent", { workspace_id: workspace.id, text: text.slice(0, 4000), locale: navigator.language.slice(0, 35), request_seq: mySeq }, ctl.signal);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        r = keywordClassify(text, mySeq);
      }
      if (ctl.signal.aborted || r.request_seq !== seq.current) return;
      setStatus(r.fallback ? "fallback" : "jev");
      setPreview((p) => applyIntent(p, r));
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text, workspace.id]);

  const type: Intent | null = manual ?? (preview.mode === "selected" || preview.mode === "tentative" ? preview.intent : null);
  const confident = !!manual || preview.mode === "selected";
  const draft = useMemo(() => (type && type !== "search" ? draftPayload(type as CardType, text, Date.now(), TZ) : null), [type, text]);
  const payload = edited ?? (draft?.payload as Record<string, unknown> | undefined) ?? null;
  const validation = type && type !== "search" && payload ? validatePayload(type as CardType, payload) : null;

  function reset() {
    setText("");
    setManual(null);
    setEdited(null);
    setGenerated(null);
    setPreview(initialPreview);
  }

  async function save() {
    if (!type || type === "search" || !validation?.success) return;
    setBusy(true);
    setMessage("");
    const deps = generated?.dependencies ?? [];
    const { error } = deps.length
      ? await supabase.rpc("create_generated_card", { p_workspace_id: workspace.id, p_type: type, p_payload: validation.data, p_dependencies: deps })
      : await supabase.rpc("create_card", { p_workspace_id: workspace.id, p_type: type, p_payload: validation.data });
    setBusy(false);
    if (error) return setMessage(rpcMessage(error));
    setMessage(`${LABEL[type]} saved (private).`);
    reset();
    onSaved();
    api("index-now", {}).catch(() => undefined).finally(onSaved);
  }

  async function generateDraft() {
    const to = Array.isArray(payload?.to) ? (payload!.to as string[]) : [];
    const instruction = typeof payload?.body === "string" && !generated ? payload.body : text;
    setBusy(true);
    setMessage("");
    try {
      const g = await api<Generated>("generate", { workspace_id: workspace.id, task: "email", instruction: instruction.slice(0, 8000), query: instruction.slice(0, 2000), draft_fields: { to } });
      setGenerated(g);
      setEdited({ to: g.to ?? to, subject: g.subject ?? "", body: g.body ?? "" });
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Draft generation failed; your text is kept.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setManual(null);
      setEdited(null);
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (type === "search" && confident) {
      e.preventDefault();
      onSearch(text.trim());
    } else if (type && type !== "email" && confident && validation?.success) {
      e.preventDefault();
      save();
    }
  }

  return (
    <section className="composer" aria-label="Unified input">
      <textarea
        value={text}
        rows={3}
        maxLength={4000}
        placeholder="Type a note, a to-do list, 'lunch with Sara tomorrow at 1pm', a link, a question, or 'email sam@example.com about…'"
        onChange={(e) => {
          setText(e.target.value);
          if (!generated) setEdited(null);
        }}
        onKeyDown={onKeyDown}
        aria-describedby="preview-status"
      />
      <div className="palette" role="radiogroup" aria-label="Card type">
        {INTENTS.map((i) => (
          <button key={i} role="radio" aria-checked={type === i} className={type === i ? (manual === i ? "chip on manual" : "chip on") : "chip"}
            onClick={() => {
              setManual(manual === i ? null : i);
              setEdited(null);
            }}>
            {LABEL[i]}
          </button>
        ))}
        <span id="preview-status" className="muted small" aria-live="polite">
          {manual ? `${LABEL[manual]} (manual)` : preview.mode === "choice" ? "Choose a card type" : type ? `${LABEL[type]}${preview.mode === "tentative" ? "?" : ""}` : ""}
          {status === "fallback" && " · keyword fallback (classifier unavailable)"}
          {status === "classifying" && " · …"}
        </span>
      </div>
      {!manual && preview.mode === "choice" && (
        <div className="row">
          {preview.alternatives.map((a) => <button key={a} className="chip" onClick={() => setManual(a)}>{LABEL[a]}</button>)}
        </div>
      )}
      {type === "search" && text.trim() && (
        <div className="preview"><button onClick={() => onSearch(text.trim())}>Search workspace</button></div>
      )}
      {type && type !== "search" && payload && (
        <div className={`preview ${confident ? "" : "tentative"}`}>
          <CardFields type={type as CardType} value={payload} onChange={setEdited} />
          {draft?.issues.map((i) => <p key={i} className="warn">{i}</p>)}
          {validation && !validation.success && (edited || text.trim()) && (
            <p className="muted small">{validation.error.issues[0]?.message}</p>
          )}
          {generated && <Citations citations={generated.citations} privateRequired={generated.private_required} />}
          <div className="row">
            {type === "email" && <button disabled={busy} onClick={generateDraft}>{busy ? "Generating…" : generated ? "Regenerate draft" : "Generate draft"}</button>}
            <button disabled={busy || !validation?.success || !confident} onClick={save}>Save card</button>
            {type === "email" && validation?.success && (payload.to as string[]).length > 0 && (
              <button disabled={busy} onClick={() => setGmail(true)}>Save to Gmail drafts</button>
            )}
            {!confident && <span className="muted small">Pick a card type to save.</span>}
          </div>
        </div>
      )}
      {message && <p role="status" className="muted">{message}</p>}
      {gmail && validation?.success && (
        <ActionDialog workspaceId={workspace.id} kind="gmail_draft" payload={validation.data as Record<string, unknown>} onClose={() => setGmail(false)} />
      )}
    </section>
  );
}
