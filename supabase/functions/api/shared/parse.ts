// Deterministic parsing and keyword fallback. Classification only picks a preview; these parsers fill fields.
import type { CardType, Intent, IntentResult } from "./schemas.ts";

type Local = { y: number; mo: number; d: number; h: number; mi: number };
export type ZonedResult = { iso: string; status: "ok" | "ambiguous" | "nonexistent" };

function partsIn(utcMs: number, tz: string): Local {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetMinutes(utcMs: number, tz: string): number {
  const l = partsIn(utcMs, tz);
  return Math.round((Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - Math.floor(utcMs / 60000) * 60000) / 60000);
}

function fmtOffset(min: number): string {
  const s = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** Converts a wall-clock time in an IANA zone to an ISO string with offset, flagging DST gaps and overlaps. */
export function zonedToIso(l: Local, tz: string): ZonedResult {
  const naive = Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);
  const candidates = new Set<number>();
  for (const probe of [naive - 36e5 * 14, naive, naive + 36e5 * 14]) {
    const off = offsetMinutes(probe, tz);
    const utc = naive - off * 60000;
    const back = partsIn(utc, tz);
    if (back.y === l.y && back.mo === l.mo && back.d === l.d && back.h === l.h && back.mi === l.mi) candidates.add(utc);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${l.y}-${pad(l.mo)}-${pad(l.d)}T${pad(l.h)}:${pad(l.mi)}:00`;
  if (candidates.size === 0) {
    const off = offsetMinutes(naive, tz);
    return { iso: wall + fmtOffset(off), status: "nonexistent" };
  }
  const first = Math.min(...candidates);
  return { iso: wall + fmtOffset(offsetMinutes(first, tz)), status: candidates.size > 1 ? "ambiguous" : "ok" };
}

export function localParts(utcMs: number, tz: string): Local {
  return partsIn(utcMs, tz);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type ParsedEvent = {
  title: string;
  start?: string;
  end?: string;
  timezone: string;
  issues: string[];
};

function addDays(l: Local, n: number): Local {
  const t = new Date(Date.UTC(l.y, l.mo - 1, l.d + n));
  return { ...l, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function parseClock(h: string, m: string | undefined, ap: string | undefined): { h: number; mi: number } | null {
  let hh = Number(h);
  const mi = m ? Number(m) : 0;
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    hh = (hh % 12) + (ap.toLowerCase().startsWith("p") ? 12 : 0);
  }
  if (hh > 23 || mi > 59) return null;
  return { h: hh, mi };
}

export function parseEvent(text: string, nowMs: number, tz: string): ParsedEvent {
  const issues: string[] = [];
  let rest = ` ${text} `;
  const today = partsIn(nowMs, tz);
  let day: Local | null = null;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };

  let m = take(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) day = { ...today, y: +m[1], mo: +m[2], d: +m[3] };
  if (!day && (m = take(/\b(today|tonight)\b/i))) day = today;
  if (!day && (m = take(/\b(tomorrow)\b/i))) day = addDays(today, 1);
  if (!day && (m = take(new RegExp(`\\b(?:on\\s+)?(next\\s+)?(${WEEKDAYS.join("|")})\\b`, "i")))) {
    const target = WEEKDAYS.indexOf(m[2].toLowerCase());
    const cur = new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay();
    const delta = (target - cur + 7) % 7 || 7;
    day = addDays(today, delta);
  }
  if (!day && (m = take(new RegExp(`\\b(?:on\\s+)?(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i")))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1;
    let y = today.y;
    if (mo < today.mo || (mo === today.mo && +m[2] < today.d)) y += 1;
    day = { ...today, y, mo, d: +m[2] };
  }

  let start: { h: number; mi: number } | null = null;
  let end: { h: number; mi: number } | null = null;
  const range = take(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (range) {
    start = parseClock(range[1], range[2], range[3] ?? range[6]);
    end = parseClock(range[4], range[5], range[6]);
  } else {
    const t = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? take(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/) ??
      take(/\bat\s+(\d{1,2})\b/i);
    if (t) {
      start = parseClock(t[1], t[2], t[3]);
      if (!t[3] && !t[2] && start) issues.push("Time has no am/pm; check the start time.");
    }
    if (!start && (m = take(/\bnoon\b/i))) start = { h: 12, mi: 0 };
  }
  let durationMin = 60;
  const dur = take(/\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b/i);
  if (dur) durationMin = Math.round(Number(dur[1]) * (/^h/i.test(dur[2]) ? 60 : 1));

  const title = rest.replace(/\s+(at|on|from|by)\s*$/i, "").replace(/\s{2,}/g, " ").trim()
    .replace(/^(schedule|add|create|book)\s+(an?\s+)?(event|meeting)?\s*/i, "").trim();
  const out: ParsedEvent = { title: title.slice(0, 200) || "Event", timezone: tz, issues };
  if (!day && !start) {
    issues.push("No date or time found; set the start and end.");
    return out;
  }
  day ??= today;
  if (!start) {
    issues.push("No time found; set the start time.");
    return out;
  }
  const s = zonedToIso({ ...day, ...start }, tz);
  let endLocal: Local;
  if (end) {
    endLocal = { ...day, ...end };
    if (end.h * 60 + end.mi <= start.h * 60 + start.mi) endLocal = addDays(endLocal, 1);
  } else {
    const total = start.h * 60 + start.mi + durationMin;
    endLocal = addDays({ ...day, h: 0, mi: 0 }, Math.floor(total / 1440));
    endLocal.h = Math.floor((total % 1440) / 60);
    endLocal.mi = total % 60;
  }
  const e = zonedToIso(endLocal, tz);
  for (const [label, r] of [["Start", s], ["End", e]] as const) {
    if (r.status === "ambiguous") issues.push(`${label} time occurs twice due to a daylight-saving change; confirm it.`);
    if (r.status === "nonexistent") issues.push(`${label} time does not exist due to a daylight-saving change; pick another time.`);
  }
  out.start = s.iso;
  out.end = e.iso;
  return out;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;
const EMAIL_RE = /[^@\s<>,;:"'()]+@[^@\s<>,;:"'()]+\.[a-z]{2,}/gi;

export function parseChecklist(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bullet = /^(?:[-*•]|\[\s?[xX ]?\]|\d+[.)])\s*/;
  let title = "";
  let items: { text: string; done: boolean }[];
  if (lines.length > 1) {
    if (!bullet.test(lines[0])) title = lines.shift()!.replace(/:$/, "");
    items = lines.map((l) => ({ text: l.replace(bullet, "").trim(), done: /^\[\s?[xX]\]/.test(l) }));
  } else {
    const [head, tail] = text.includes(":") ? [text.slice(0, text.indexOf(":")), text.slice(text.indexOf(":") + 1)] : ["", text];
    title = head.trim();
    items = tail.split(/,|;|\band\b/).map((s) => ({ text: s.trim(), done: false }));
  }
  items = items.filter((i) => i.text).map((i) => ({ ...i, text: i.text.slice(0, 500) })).slice(0, 200);
  return { title: title.slice(0, 200), items };
}

export function parseBookmark(text: string) {
  const url = text.match(URL_RE)?.[0]?.replace(/[.,;)]+$/, "") ?? "";
  const rest = text.replace(URL_RE, " ").replace(/\s{2,}/g, " ").trim();
  return { url, title: rest.slice(0, 200), note: "" };
}

export function parseEmailDraft(text: string) {
  const to = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))].slice(0, 20);
  const instruction = text.replace(EMAIL_RE, " ").replace(/\s{2,}/g, " ").trim();
  return { to, instruction };
}

export function parseNote(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[0].trim().length <= 120) {
    return { title: lines[0].trim(), text: lines.slice(1).join("\n").trim() };
  }
  return { title: "", text: text.trim() };
}

export function draftPayload(type: CardType, text: string, nowMs: number, tz: string): { payload: unknown; issues: string[] } {
  switch (type) {
    case "note":
      return { payload: parseNote(text), issues: [] };
    case "checklist":
      return { payload: parseChecklist(text), issues: [] };
    case "bookmark": {
      const b = parseBookmark(text);
      return { payload: b, issues: b.url ? [] : ["Add an http(s) URL."] };
    }
    case "event": {
      const e = parseEvent(text, nowMs, tz);
      const { issues, ...rest } = e;
      return { payload: rest, issues };
    }
    case "email": {
      const d = parseEmailDraft(text);
      return { payload: { to: d.to, subject: "", body: d.instruction }, issues: d.to.length ? [] : ["Add at least one recipient before saving to Gmail."] };
    }
  }
}

/** Keyword classifier used when Jev is unavailable or times out. */
export function keywordClassify(text: string, requestSeq: number): IntentResult {
  const t = text.trim().toLowerCase();
  const scores: Record<Intent, number> = { note: 0.3, checklist: 0, event: 0, bookmark: 0, search: 0, email: 0 };
  if (URL_RE.test(t)) scores.bookmark += 0.8;
  if (/[^@\s]+@[^@\s]+\.[a-z]{2,}/.test(t) || /^(email|e-mail|write (an )?email|draft|reply|send)\b/.test(t)) scores.email += 0.8;
  if (/^(search|find|look up|lookup|what|where|who|when|why|how|which|is|are|does|do)\b/.test(t) || t.endsWith("?")) scores.search += 0.6;
  if (/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})?\s*(am|pm)|meeting|lunch|dinner|call|appointment)\b/.test(t)) scores.event += 0.6;
  if (/\n\s*([-*•]|\[ ?\]|\d+[.)])/.test(text) || /^(todo|to-do|to do|buy|checklist|tasks?|shopping)\b/.test(t) || (t.split(",").length >= 3 && t.length < 300)) scores.checklist += 0.6;
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const probabilities = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, +(v / total).toFixed(3)])) as Record<Intent, number>;
  const [intent, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] as [Intent, number];
  return { intent: t ? intent : null, confidence, probabilities, classifier: "keyword-v1", fallback: true, request_seq: requestSeq };
}
