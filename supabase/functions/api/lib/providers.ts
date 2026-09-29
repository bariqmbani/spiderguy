import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { INTENTS, type Intent, type IntentResult } from "../shared/schemas.ts";
import { HttpError, requireSecret, secret } from "./core.ts";

const CRITERIA: Record<Intent, string> = {
  note: "a free-form note, idea, or piece of information to remember",
  checklist: "a list of tasks, items, or to-dos",
  event: "a meeting, appointment, or activity at a specific date or time",
  bookmark: "a web link (URL) to save",
  search: "a question or request to find existing knowledge in the workspace",
  email: "a request to write or draft an email to someone",
};

let jev: TypeSafeClient | null = null;

export async function classifyWithJev(text: string, requestSeq: number): Promise<IntentResult> {
  const apiKey = await requireSecret("TYPESAFE_API_KEY", "Jev classifier");
  const model = (await secret("JEV_MODEL")) ?? "jev-latest";
  jev ??= new TypeSafeClient({ apiKey, defaultModel: model, timeout: 2000, retry: { maxRetries: 0 }, logLevel: "off" });
  const res = await jev.systemOne({
    state: text,
    questions: { intent: choice("Which kind of workspace card best fits this input?", CRITERIA) },
  }, { timeout: 2000, retry: { maxRetries: 0 } });
  const a = res.answers.intent as { choice: string; confidence?: number; probabilities?: Record<string, number> };
  const intent = (INTENTS as readonly string[]).includes(a.choice) ? (a.choice as Intent) : null;
  const probabilities: Partial<Record<Intent, number>> = {};
  for (const k of INTENTS) {
    const p = a.probabilities?.[k];
    if (typeof p === "number" && Number.isFinite(p)) probabilities[k] = Math.min(1, Math.max(0, p));
  }
  const confidence = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? Math.min(1, Math.max(0, a.confidence)) : 0;
  return { intent, confidence, probabilities, classifier: res.model, fallback: false, request_seq: requestSeq };
}

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", (e as Error).name === "AbortError" ? "provider timed out" : "provider unreachable", true);
  } finally {
    clearTimeout(t);
  }
}

export const EMBEDDING_DIMENSIONS = 1536;

export async function embed(texts: string[]): Promise<number[][]> {
  const base = await requireSecret("EMBEDDING_BASE_URL", "Embedding provider");
  const key = await requireSecret("EMBEDDING_API_KEY", "Embedding provider");
  const model = (await secret("EMBEDDING_MODEL")) ?? "text-embedding-3-small";
  const res = await withTimeout(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts }),
  }, 20000);
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", `embedding provider returned ${res.status}`, res.status === 429 || res.status >= 500);
  }
  const body = await res.json() as { data?: { index: number; embedding: number[] }[] };
  const rows = (body.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  if (rows.length !== texts.length) throw new HttpError(502, "PROVIDER_INVALID", "embedding count mismatch", true);
  return rows.map((v) => {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS || !v.every(Number.isFinite)) {
      throw new HttpError(502, "PROVIDER_INVALID", "embedding has wrong dimensions or non-finite values", false);
    }
    const n = Math.hypot(...v);
    if (!(n > 0)) throw new HttpError(502, "PROVIDER_INVALID", "zero embedding", false);
    return v.map((x) => x / n);
  });
}

export const toVectorLiteral = (v: number[]) => `[${v.map((x) => x.toFixed(7)).join(",")}]`;

export type ChatResult<T> = { value: T; model: string; usage: unknown };

/** Strict JSON-schema chat completion; output is parsed but still untrusted. */
export async function chatJson<T>(system: string, user: string, name: string, schema: Record<string, unknown>, maxTokens = 2000): Promise<ChatResult<T>> {
  const base = await requireSecret("LLM_BASE_URL", "Language model");
  const key = await requireSecret("LLM_API_KEY", "Language model");
  const model = (await secret("LLM_MODEL")) ?? "gpt-4.1-mini";
  const res = await withTimeout(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  }, 45000);
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", `language model returned ${res.status}`, res.status === 429 || res.status >= 500);
  }
  const body = await res.json() as { model?: string; usage?: unknown; choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[] };
  const choiceMsg = body.choices?.[0];
  if (!choiceMsg?.message?.content || choiceMsg.finish_reason === "length") {
    throw new HttpError(502, "PROVIDER_INVALID", "language model returned no complete output", true);
  }
  try {
    return { value: JSON.parse(choiceMsg.message.content) as T, model: body.model ?? model, usage: body.usage };
  } catch {
    throw new HttpError(502, "PROVIDER_INVALID", "language model returned malformed JSON", true);
  }
}
