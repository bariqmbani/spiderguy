import type { CardType } from "@shared/schemas.ts";
import { isValidTimeZone, zonedToIso } from "@shared/parse.ts";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function localInputToIso(local: string, tz: string) {
  const [d, t] = local.split("T");
  const [y, mo, dd] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return zonedToIso({ y, mo, d: dd, h, mi }, tz);
}

/** Converts an ISO timestamp with offset into the value for a datetime-local input shown in `tz`. */
export function isoToLocalInput(iso: string, tz: string): string {
  if (!iso || !isValidTimeZone(tz)) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function CardFields({ type, value, onChange }: { type: CardType; value: P; onChange: (v: P) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  switch (type) {
    case "note":
      return (
        <div className="stack">
          <label>Title <input value={str(value.title)} maxLength={200} onChange={(e) => set("title", e.target.value)} /></label>
          <label>Text <textarea rows={4} value={str(value.text)} maxLength={20000} onChange={(e) => set("text", e.target.value)} /></label>
        </div>
      );
    case "checklist": {
      const items = (Array.isArray(value.items) ? value.items : []) as { text: string; done: boolean }[];
      const setItems = (next: typeof items) => set("items", next);
      return (
        <div className="stack">
          <label>Title <input value={str(value.title)} maxLength={200} onChange={(e) => set("title", e.target.value)} /></label>
          <ul className="checklist">
            {items.map((it, i) => (
              <li key={i}>
                <input type="checkbox" aria-label={`Done: ${it.text}`} checked={it.done} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
                <input aria-label={`Item ${i + 1}`} value={it.text} maxLength={500} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <button type="button" className="icon" aria-label={`Remove item ${i + 1}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => setItems([...items, { text: "", done: false }])}>+ Add item</button>
        </div>
      );
    }
    case "event": {
      const tz = str(value.timezone) || "UTC";
      const setTime = (k: "start" | "end", local: string) => {
        if (!local || !isValidTimeZone(tz)) return;
        set(k, localInputToIso(local, tz).iso);
      };
      return (
        <div className="stack">
          <label>Title <input value={str(value.title)} maxLength={200} onChange={(e) => set("title", e.target.value)} /></label>
          <div className="row">
            <label>Start <input type="datetime-local" value={isoToLocalInput(str(value.start), tz)} onChange={(e) => setTime("start", e.target.value)} /></label>
            <label>End <input type="datetime-local" value={isoToLocalInput(str(value.end), tz)} onChange={(e) => setTime("end", e.target.value)} /></label>
          </div>
          <label>Time zone <input value={tz} onChange={(e) => set("timezone", e.target.value)} aria-invalid={!isValidTimeZone(tz)} /></label>
          {!isValidTimeZone(tz) && <p className="error">Unknown IANA time zone.</p>}
          <label>Location <input value={str(value.location)} maxLength={300} onChange={(e) => set("location", e.target.value || undefined)} /></label>
        </div>
      );
    }
    case "bookmark":
      return (
        <div className="stack">
          <label>URL <input type="url" value={str(value.url)} maxLength={2000} onChange={(e) => set("url", e.target.value)} /></label>
          <label>Title <input value={str(value.title)} maxLength={200} onChange={(e) => set("title", e.target.value)} /></label>
          <label>Note <textarea rows={2} value={str(value.note)} maxLength={5000} onChange={(e) => set("note", e.target.value)} /></label>
        </div>
      );
    case "email": {
      const list = (k: "to" | "cc") => (Array.isArray(value[k]) ? (value[k] as string[]).join(", ") : "");
      const setList = (k: "to" | "cc", s: string) => set(k, s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean));
      return (
        <div className="stack">
          <label>To <input value={list("to")} onChange={(e) => setList("to", e.target.value)} placeholder="name@example.com" /></label>
          <label>Cc <input value={list("cc")} onChange={(e) => setList("cc", e.target.value)} /></label>
          <label>Subject <input value={str(value.subject)} maxLength={300} onChange={(e) => set("subject", e.target.value.replace(/[\r\n]/g, " "))} /></label>
          <label>Body <textarea rows={8} value={str(value.body)} maxLength={50000} onChange={(e) => set("body", e.target.value)} /></label>
        </div>
      );
    }
  }
}
