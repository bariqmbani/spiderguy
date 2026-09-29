import { useCallback, useEffect, useState } from "react";
import { safeHttpUrl } from "@shared/schemas.ts";
import { api, ApiError, rpcMessage, supabase } from "../lib/supabase.ts";
import { pickDriveFile } from "../lib/google.ts";
import { Citations } from "./Citations.tsx";
import type { Generated, Source, Workspace } from "../types.ts";

type Hit = { chunk_id: string; source_id: string; revision_id: string; title: string; source_kind: string; visibility: string; external_url: string | null; imported_at: string; snippet: string; content: string; score: number };
type SearchResult = { mode: "hybrid" | "keyword"; results: Hit[]; pending_sources: number };
const MIME: Record<string, string> = { txt: "text/plain", md: "text/markdown", markdown: "text/markdown" };

export function Knowledge({ workspace, userId, initialQuery }: { workspace: Workspace; userId: string; initialQuery: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [answer, setAnswer] = useState<Generated | null>(null);
  const [open, setOpen] = useState<Hit | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("sources").select("*").eq("workspace_id", workspace.id).neq("kind", "card").order("created_at", { ascending: false }).limit(100);
    setSources((data ?? []) as Source[]);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!sources.some((s) => ["pending", "processing", "retry_wait"].includes(s.state))) return;
    const t = setTimeout(async () => {
      await api("index-now", {}).catch(() => undefined);
      load();
    }, 3000);
    return () => clearTimeout(t);
  }, [sources, load]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setBusy("search");
    setAnswer(null);
    setMsg("");
    try {
      setResult(await api<SearchResult>("search", { workspace_id: workspace.id, query: q.trim().slice(0, 2000), limit: 10 }));
    } catch (e) {
      setResult(null);
      setMsg(e instanceof ApiError && e.code === "SEARCH_FAILED" ? "Search is temporarily unavailable (this is not an empty result)." : (e as Error).message);
    } finally {
      setBusy("");
    }
  }, [workspace.id]);

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
  }, [initialQuery, runSearch]);

  async function ask(task: "answer" | "summary") {
    setBusy(task);
    setMsg("");
    try {
      const body = task === "answer" ? { workspace_id: workspace.id, task, query: query.trim() } : { workspace_id: workspace.id, task, source_ids: selected };
      setAnswer(await api<Generated>("generate", body));
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.message}${e.code === "PROVIDER_UNAVAILABLE" ? " Search still works." : ""}` : "Generation failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveAnswer() {
    if (!answer) return;
    const text = (answer.answer ?? answer.summary ?? "").slice(0, 20000);
    const { error } = await supabase.rpc("create_generated_card", {
      p_workspace_id: workspace.id, p_type: "note",
      p_payload: { title: (answer.task === "answer" ? query : "Summary").slice(0, 200), text },
      p_dependencies: answer.dependencies,
    });
    setMsg(error ? rpcMessage(error) : "Saved as a private note.");
  }

  async function upload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME[ext];
    if (!mime) return setMsg("Only .txt and .md files are supported.");
    if (file.size > 5 * 1024 * 1024) return setMsg("Files must be 5 MiB or smaller.");
    setBusy("upload");
    const { data, error } = await supabase.rpc("create_upload_source", { p_workspace_id: workspace.id, p_filename: file.name, p_size: file.size, p_mime: mime });
    if (error) {
      setBusy("");
      return setMsg(error.message.replace(/^[A-Z_]+: /, ""));
    }
    const up = await supabase.storage.from(data.bucket).upload(data.path, file, { contentType: mime, upsert: false });
    const fin = up.error ? null : await supabase.rpc("finalize_upload", { p_source_id: data.source_id });
    setBusy("");
    if (up.error || fin?.error) return setMsg("Upload failed; the source stays unindexed. Try again.");
    setMsg(`Uploaded ${file.name}; indexing…`);
    api("index-now", {}).catch(() => undefined).finally(load);
  }

  async function importDrive() {
    try {
      const cfg = await api<{ api_key: string | null; app_id: string | null }>("google-config");
      const { access_token } = await api<{ access_token: string }>("google-picker-token", {});
      const fileId = await pickDriveFile(access_token, cfg.api_key, cfg.app_id);
      if (!fileId) return;
      const r = await api<{ google_shared: boolean }>("google-import", { workspace_id: workspace.id, file_id: fileId });
      setMsg(`Imported a private snapshot${r.google_shared ? ". Note: the file is shared in Google, but this copy is private here." : "."} It won't update unless you refresh it.`);
      load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "SCOPE_REQUIRED" ? "Connect Google Drive in the Google tab first." : (e as Error).message);
    }
  }

  async function sourceAction(s: Source, act: "delete" | "share" | "unshare" | "retry" | "refresh") {
    let error: { message?: string; code?: string } | null = null;
    if (act === "delete") {
      if (!confirm(`Delete "${s.title}"? It is removed from search immediately.`)) return;
      ({ error } = await supabase.rpc("delete_source", { p_source_id: s.id }));
    } else if (act === "retry") ({ error } = await supabase.rpc("retry_source", { p_source_id: s.id }));
    else if (act === "refresh") {
      try {
        await api("source-refresh", { source_id: s.id });
      } catch (e) {
        setMsg((e as Error).message);
      }
    } else ({ error } = await supabase.rpc("set_source_visibility", { p_source_id: s.id, p_visibility: act === "share" ? "workspace" : "private" }));
    if (error) setMsg(rpcMessage(error));
    load();
  }

  return (
    <div className="knowledge">
      <section aria-label="Search">
        <form className="row" onSubmit={(e) => { e.preventDefault(); runSearch(query); }}>
          <input aria-label="Search query" value={query} maxLength={2000} onChange={(e) => setQuery(e.target.value)} placeholder="Search this workspace…" />
          <button disabled={!!busy || !query.trim()}>Search</button>
          <button type="button" disabled={!!busy || !query.trim()} onClick={() => ask("answer")}>{busy === "answer" ? "Thinking…" : "Ask"}</button>
        </form>
        {msg && <p role="status" className="muted">{msg}</p>}
        {answer && (
          <div className="answer">
            {answer.abstained ? <p><em>{answer.answer ?? answer.summary}</em></p> : <p className="pre">{answer.answer ?? answer.summary}</p>}
            <Citations citations={answer.citations} privateRequired={answer.private_required} />
            {!!answer.excluded_passages && <p className="muted small">{answer.excluded_passages} passage(s) containing instruction-like text were excluded.</p>}
            <p className="muted small">Model {answer.model} · {answer.prompt_version}</p>
            {!answer.abstained && <button className="secondary" onClick={saveAnswer}>Save as note</button>}
          </div>
        )}
        {result && (
          <>
            <p className="muted small">
              {result.mode === "keyword" ? "Keyword-only results (semantic search unavailable). " : ""}
              {result.pending_sources > 0 ? `${result.pending_sources} source(s) still indexing and not searchable yet. ` : ""}
              {result.results.length === 0 ? "No matches — try different words." : ""}
            </p>
            <ol className="results">
              {result.results.map((h) => (
                <li key={h.chunk_id}>
                  <button className="link" onClick={() => setOpen(open?.chunk_id === h.chunk_id ? null : h)}>{h.title}</button>
                  <span className="muted small"> · {h.source_kind}{h.visibility === "private" ? " · 🔒" : ""} · {new Date(h.imported_at).toLocaleDateString()}</span>
                  <p className="small">{h.snippet}{h.snippet.length < h.content.length ? "…" : ""}</p>
                  {open?.chunk_id === h.chunk_id && (
                    <div className="evidence">
                      <p className="pre small">{h.content}</p>
                      {safeHttpUrl(h.external_url) && <a href={safeHttpUrl(h.external_url)!} target="_blank" rel="noopener noreferrer">Open original</a>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-label="Sources">
        <h2>Sources</h2>
        <div className="row">
          <label className="button">Upload .txt/.md
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden disabled={busy === "upload"} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          </label>
          <button className="secondary" onClick={importDrive}>Import from Google Drive</button>
          <button className="secondary" disabled={!selected.length || !!busy} onClick={() => ask("summary")}>{busy === "summary" ? "Summarizing…" : `Summarize selected (${selected.length})`}</button>
        </div>
        <ul className="sources">
          {sources.map((s) => (
            <li key={s.id}>
              <label>
                <input type="checkbox" disabled={s.state !== "ready"} checked={selected.includes(s.id)}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                {s.title}
              </label>
              <span className="muted small"> · {s.kind === "drive_snapshot" ? "Drive snapshot" : "upload"} · {s.visibility === "private" ? "🔒 private" : "👥 shared"} · {s.state}{s.error_code ? ` (${s.error_code})` : ""} · {new Date(s.updated_at).toLocaleString()}</span>
              {s.owner_id === userId && (
                <span className="row small">
                  {s.visibility === "private" ? <button className="link" onClick={() => sourceAction(s, "share")}>Share</button> : <button className="link" onClick={() => sourceAction(s, "unshare")}>Make private</button>}
                  {s.state === "failed" && <button className="link" onClick={() => sourceAction(s, "retry")}>Retry</button>}
                  {s.kind === "drive_snapshot" && <button className="link" onClick={() => sourceAction(s, "refresh")}>Refresh snapshot</button>}
                  <button className="link" onClick={() => sourceAction(s, "delete")}>Delete</button>
                </span>
              )}
            </li>
          ))}
          {!sources.length && <li className="muted">No uploaded or imported sources yet. Saved cards are indexed automatically.</li>}
        </ul>
      </section>
    </div>
  );
}
