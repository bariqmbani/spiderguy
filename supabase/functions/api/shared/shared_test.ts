import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { draftPayload, keywordClassify, parseChecklist, parseEvent, zonedToIso } from "./parse.ts";
import { chunkText, decodeUtf8Strict } from "./chunk.ts";
import { validateCitations } from "./grounding.ts";
import { buildMime } from "./mime.ts";
import { emailSchema, eventSchema, validatePayload } from "./schemas.ts";

// Fixed "now": Tuesday 2026-09-29 10:00 UTC.
const NOW = Date.parse("2026-09-29T10:00:00Z");

Deno.test("event: tomorrow at 1pm in Asia/Jakarta has +07:00 offset and 1h default", () => {
  const e = parseEvent("lunch with Sara tomorrow at 1pm", NOW, "Asia/Jakarta");
  assertEquals(e.start, "2026-09-30T13:00:00+07:00");
  assertEquals(e.end, "2026-09-30T14:00:00+07:00");
  assertEquals(e.title, "lunch with Sara");
  assertEquals(e.issues, []);
});

Deno.test("event: ranges, weekdays, ISO dates, durations", () => {
  assertEquals(parseEvent("standup friday 9:30-9:45am", NOW, "UTC").start, "2026-10-02T09:30:00+00:00");
  assertEquals(parseEvent("standup friday 9:30-9:45am", NOW, "UTC").end, "2026-10-02T09:45:00+00:00");
  const d = parseEvent("review 2026-10-05 15:00 for 30 minutes", NOW, "Europe/Berlin");
  assertEquals(d.start, "2026-10-05T15:00:00+02:00");
  assertEquals(d.end, "2026-10-05T15:30:00+02:00");
});

Deno.test("event: missing time and ambiguous hour are surfaced, not guessed silently", () => {
  assert(parseEvent("dentist tomorrow", NOW, "UTC").issues.length > 0);
  assertEquals(parseEvent("dentist tomorrow", NOW, "UTC").start, undefined);
  assert(parseEvent("call Bob at 3", NOW, "UTC").issues.some((i) => i.includes("am/pm")));
});

Deno.test("DST: New York fall-back 01:30 is ambiguous; spring-forward 02:30 does not exist", () => {
  assertEquals(zonedToIso({ y: 2026, mo: 11, d: 1, h: 1, mi: 30 }, "America/New_York").status, "ambiguous");
  assertEquals(zonedToIso({ y: 2026, mo: 3, d: 8, h: 2, mi: 30 }, "America/New_York").status, "nonexistent");
  assertEquals(zonedToIso({ y: 2026, mo: 7, d: 1, h: 9, mi: 0 }, "America/New_York").iso, "2026-07-01T09:00:00-04:00");
  const e = parseEvent("party 2026-11-01 1:30am", NOW, "America/New_York");
  assert(e.issues.some((i) => i.includes("occurs twice")));
});

Deno.test("checklist parsing: bullets, done markers, and inline lists", () => {
  assertEquals(parseChecklist("Trip\n- passport\n[x] tickets\n* charger").items, [
    { text: "passport", done: false }, { text: "tickets", done: true }, { text: "charger", done: false },
  ]);
  const inline = parseChecklist("groceries: milk, eggs and bread");
  assertEquals(inline.title, "groceries");
  assertEquals(inline.items.map((i) => i.text), ["milk", "eggs", "bread"]);
});

Deno.test("draft payloads validate against the shared card schemas", () => {
  for (const [type, text] of [["note", "Idea\nship it"], ["checklist", "a, b, c"], ["bookmark", "docs https://example.com/x"], ["event", "sync tomorrow 2pm"]] as const) {
    const { payload } = draftPayload(type, text, NOW, "UTC");
    assert(validatePayload(type, payload).success, `${type} should validate`);
  }
  assert(!validatePayload("bookmark", { url: "javascript:alert(1)" }).success);
  assert(!eventSchema.safeParse({ title: "x", start: "2026-10-01T10:00:00Z", end: "2026-10-01T09:00:00Z", timezone: "UTC" }).success);
  assert(!emailSchema.safeParse({ to: ["a@b.co"], subject: "x\r\nBcc: e@evil.test", body: "" }).success);
  assert(!emailSchema.safeParse({ to: ["bad address"], subject: "x", body: "" }).success);
});

Deno.test("keyword fallback classifier covers each intent", () => {
  assertEquals(keywordClassify("https://deno.land", 1).intent, "bookmark");
  assertEquals(keywordClassify("email bob@example.com about the launch", 1).intent, "email");
  assertEquals(keywordClassify("what is our expense policy?", 1).intent, "search");
  assertEquals(keywordClassify("dinner tomorrow at 7pm", 1).intent, "event");
  assertEquals(keywordClassify("todo: milk, eggs, bread", 1).intent, "checklist");
  assertEquals(keywordClassify("the blue whale is large", 1).intent, "note");
  assertEquals(keywordClassify("x", 9).fallback, true);
  assertEquals(keywordClassify("x", 9).request_seq, 9);
});

Deno.test("chunker: bounded chunks with overlap, headings split, oversize paragraphs split", () => {
  const para = "word ".repeat(700).trim();
  const chunks = chunkText(`# A\n\n${para}\n\n# B\n\n${para}\n\n${"x".repeat(9000)}`);
  assert(chunks.length >= 3);
  assert(chunks.every((c) => c.length <= 3200 + 400));
  assertEquals(chunkText("   \n\n  "), []);
  assertEquals(decodeUtf8Strict(new Uint8Array([0xff, 0xfe])), null);
  assertEquals(decodeUtf8Strict(new TextEncoder().encode("héllo")), "héllo");
});

Deno.test("citations: must reference provided chunks with exact substrings", () => {
  const ev = [{ chunk_id: "c1", source_id: "s1", revision_id: "r1", title: "T", content: "The badge  is issued by Facilities.", visibility: "private" }];
  const r = validateCitations([
    { chunk_id: "c1", quote: "badge is issued by Facilities" },
    { chunk_id: "c2", quote: "invented" },
    { chunk_id: "c1", quote: "issued by HR" },
  ], ev);
  assertEquals(r.ok.length, 1);
  assertEquals(r.errors.length, 2);
});

Deno.test("MIME: Unicode subject is encoded, header injection rejected", () => {
  const m = buildMime({ to: ["a@example.test"], subject: "Résumé ✓", body: "héllo" });
  assert(m.includes("Subject: =?UTF-8?B?"));
  assert(m.includes("Content-Transfer-Encoding: base64"));
  assertThrows(() => buildMime({ to: ["a@example.test"], subject: "x\r\nBcc: e@evil.test", body: "" }));
});
