import { describe, expect, it } from "vitest";
import { applyIntent, initialPreview } from "./stabilizer.ts";
import type { IntentResult } from "@shared/schemas.ts";

const r = (seq: number, intent: IntentResult["intent"], confidence: number, probabilities: IntentResult["probabilities"] = {}): IntentResult =>
  ({ intent, confidence, probabilities: intent ? { [intent]: confidence, ...probabilities } : probabilities, classifier: "t", fallback: false, request_seq: seq });

describe("intent stabilizer (UI-01, T05)", () => {
  it("stays neutral below .40 and is tentative between .40 and .70", () => {
    expect(applyIntent(initialPreview, r(1, "note", 0.3)).mode).toBe("neutral");
    expect(applyIntent(initialPreview, r(1, "note", 0.55)).mode).toBe("tentative");
    expect(applyIntent(initialPreview, r(1, "note", 0.9)).mode).toBe("selected");
  });

  it("ignores stale responses (latest request wins)", () => {
    const s = applyIntent(initialPreview, r(5, "event", 0.9));
    const late = applyIntent(s, r(3, "email", 0.99));
    expect(late).toBe(s);
  });

  it("offers two explicit choices when the top two are within .15", () => {
    const s = applyIntent(initialPreview, r(1, "event", 0.5, { note: 0.42 }));
    expect(s.mode).toBe("choice");
    expect(s.alternatives).toEqual(["event", "note"]);
  });

  it("requires two consecutive wins or >= .85 to replace a settled preview", () => {
    let s = applyIntent(initialPreview, r(1, "note", 0.8));
    s = applyIntent(s, r(2, "checklist", 0.75));
    expect(s.intent).toBe("note");
    s = applyIntent(s, r(3, "checklist", 0.75));
    expect(s.intent).toBe("checklist");
    s = applyIntent(s, r(4, "event", 0.9));
    expect(s.intent).toBe("event");
  });

  it("an interrupted challenger restarts its count; low confidence keeps the settled card", () => {
    let s = applyIntent(initialPreview, r(1, "note", 0.8));
    s = applyIntent(s, r(2, "checklist", 0.75));
    s = applyIntent(s, r(3, "note", 0.8));
    s = applyIntent(s, r(4, "checklist", 0.75));
    expect(s.intent).toBe("note");
    s = applyIntent(s, r(5, null, 0.1));
    expect(s.mode).toBe("selected");
  });
});
