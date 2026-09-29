import type { Intent, IntentResult } from "@shared/schemas.ts";

export const THRESHOLDS = { neutral: 0.4, select: 0.7, close: 0.15, override: 0.85, wins: 2 } as const;

export type PreviewState = {
  mode: "neutral" | "tentative" | "selected" | "choice";
  intent: Intent | null;
  alternatives: Intent[];
  challenger: Intent | null;
  challengerWins: number;
  lastSeq: number;
};

export const initialPreview: PreviewState = { mode: "neutral", intent: null, alternatives: [], challenger: null, challengerWins: 0, lastSeq: -1 };

/** Applies a classifier result. Stale sequences are ignored; a settled preview needs a strong or repeated challenger. */
export function applyIntent(s: PreviewState, r: IntentResult): PreviewState {
  if (r.request_seq <= s.lastSeq) return s;
  const next = { ...s, lastSeq: r.request_seq };
  const ranked = (Object.entries(r.probabilities) as [Intent, number][]).sort((a, b) => b[1] - a[1]);
  const conf = r.confidence || ranked[0]?.[1] || 0;
  const intent = r.intent;
  if (!intent || conf < THRESHOLDS.neutral) {
    return s.mode === "selected" ? next : { ...next, mode: "neutral", intent: null, alternatives: [] };
  }
  if (s.mode === "selected" && s.intent) {
    if (intent === s.intent) return { ...next, challenger: null, challengerWins: 0 };
    if (conf >= THRESHOLDS.override) return { ...next, intent, challenger: null, challengerWins: 0, alternatives: [] };
    const wins = s.challenger === intent ? s.challengerWins + 1 : 1;
    if (wins >= THRESHOLDS.wins && conf > THRESHOLDS.neutral) return { ...next, intent, challenger: null, challengerWins: 0, alternatives: [] };
    return { ...next, challenger: intent, challengerWins: wins };
  }
  if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < THRESHOLDS.close && conf < THRESHOLDS.override) {
    return { ...next, mode: "choice", intent, alternatives: [ranked[0][0], ranked[1][0]] };
  }
  if (conf > THRESHOLDS.select) return { ...next, mode: "selected", intent, alternatives: [], challenger: null, challengerWins: 0 };
  return { ...next, mode: "tentative", intent, alternatives: [] };
}
