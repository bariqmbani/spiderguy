// Shared, Deno- and Vite-compatible contracts. Mirrors private.valid_card_payload in the database.
import { z } from "zod";

export const CARD_TYPES = ["note", "checklist", "event", "bookmark", "email"] as const;
export const INTENTS = ["note", "checklist", "event", "bookmark", "search", "email"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export type Intent = (typeof INTENTS)[number];

const email = z.string().max(320).regex(/^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/, "invalid email address");
const isoTs = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/, "invalid timestamp");

export const noteSchema = z.object({ title: z.string().max(200), text: z.string().max(20000) }).strict()
  .refine((p) => (p.title + p.text).trim().length > 0, "note is empty");
export const checklistSchema = z.object({
  title: z.string().max(200),
  items: z.array(z.object({ text: z.string().min(1).max(500), done: z.boolean() }).strict()).min(1).max(200),
}).strict();
export const eventSchema = z.object({
  title: z.string().min(1).max(200),
  start: isoTs,
  end: isoTs,
  timezone: z.string().min(1).max(64),
  location: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
}).strict().refine((p) => Date.parse(p.end) > Date.parse(p.start), "end must be after start");
export const bookmarkSchema = z.object({
  url: z.string().min(1).max(2000).regex(/^https?:\/\/\S+$/i, "URL must start with http:// or https://"),
  title: z.string().max(200).optional(),
  note: z.string().max(5000).optional(),
}).strict();
export const citationSchema = z.object({
  source_id: z.string().uuid(),
  revision_id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  quote: z.string().max(1000),
  title: z.string().max(300).optional(),
}).strict();
export const emailSchema = z.object({
  to: z.array(email).max(20),
  cc: z.array(email).max(20).optional(),
  subject: z.string().max(300).regex(/^[^\r\n]*$/, "subject cannot contain line breaks"),
  body: z.string().max(50000),
  tone: z.string().max(40).optional(),
  citations: z.array(citationSchema).max(20).optional(),
}).strict();

export const payloadSchemas = {
  note: noteSchema,
  checklist: checklistSchema,
  event: eventSchema,
  bookmark: bookmarkSchema,
  email: emailSchema,
} as const;

export type NotePayload = z.infer<typeof noteSchema>;
export type ChecklistPayload = z.infer<typeof checklistSchema>;
export type EventPayload = z.infer<typeof eventSchema>;
export type BookmarkPayload = z.infer<typeof bookmarkSchema>;
export type EmailPayload = z.infer<typeof emailSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type CardPayload = NotePayload | ChecklistPayload | EventPayload | BookmarkPayload | EmailPayload;

export function validatePayload(type: CardType, payload: unknown) {
  return payloadSchemas[type].safeParse(payload);
}

export const uuid = z.string().uuid();

export const intentRequest = z.object({
  workspace_id: uuid,
  text: z.string().min(1).max(4000),
  locale: z.string().max(35).default("en"),
  request_seq: z.number().int().nonnegative(),
}).strict();

export type IntentResult = {
  intent: Intent | null;
  confidence: number;
  probabilities: Partial<Record<Intent, number>>;
  classifier: string;
  fallback: boolean;
  request_seq: number;
};

export const searchRequest = z.object({
  workspace_id: uuid,
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

export const generateRequest = z.object({
  workspace_id: uuid,
  task: z.enum(["answer", "summary", "email"]),
  instruction: z.string().max(8000).default(""),
  query: z.string().max(2000).optional(),
  source_ids: z.array(uuid).max(20).optional(),
  draft_fields: z.object({
    to: z.array(email).max(20).default([]),
    cc: z.array(email).max(20).optional(),
    tone: z.string().max(40).optional(),
  }).strict().optional(),
}).strict();

export type SearchHit = {
  chunk_id: string;
  source_id: string;
  revision_id: string;
  title: string;
  source_kind: string;
  visibility: "private" | "workspace";
  external_url: string | null;
  imported_at: string;
  snippet: string;
  score: number;
};

export const actionPrepareRequest = z.discriminatedUnion("kind", [
  z.object({ workspace_id: uuid, kind: z.literal("gmail_draft"), idempotency_key: z.string().min(8).max(128), payload: emailSchema }).strict(),
  z.object({ workspace_id: uuid, kind: z.literal("calendar_event"), idempotency_key: z.string().min(8).max(128), payload: eventSchema }).strict(),
]);

export const actionExecuteRequest = z.object({
  action_id: uuid,
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
