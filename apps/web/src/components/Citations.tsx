import type { Citation } from "../types.ts";

export function Citations({ citations, privateRequired }: { citations: Citation[]; privateRequired: boolean }) {
  if (!citations.length && !privateRequired) return null;
  return (
    <aside className="citations" aria-label="Sources used">
      {privateRequired && <p className="small">🔒 Uses private sources — anything saved from this stays private until those sources are shared and it is regenerated.</p>}
      {citations.length > 0 && (
        <ol>
          {citations.map((c) => (
            <li key={c.chunk_id}>
              <strong>{c.title ?? "Source"}</strong>: <q>{c.quote}</q>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
