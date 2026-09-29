import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false, public extra?: unknown) {
    super(message);
  }
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function ok(data: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify({ data, request_id: requestId }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function fail(e: HttpError, requestId: string): Response {
  const body = { error: { code: e.code, message: e.message, retryable: e.retryable, ...(e.extra ? { details: e.extra } : {}) }, request_id: requestId };
  return new Response(JSON.stringify(body), { status: e.status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function readJson(req: Request, maxBytes = 65536): Promise<unknown> {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new HttpError(413, "INVALID_INPUT", "request body too large");
  try {
    return buf.byteLength ? JSON.parse(new TextDecoder().decode(buf)) : {};
  } catch {
    throw new HttpError(422, "INVALID_INPUT", "body must be JSON");
  }
}

export function parseWith<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) {
    const field_errors = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new HttpError(422, "INVALID_INPUT", "invalid request", false, field_errors);
  }
  return r.data;
}

const env = (k: string) => Deno.env.get(k) ?? "";
export const SUPABASE_URL = env("SUPABASE_URL");
const ANON = env("SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

export type Ctx = { user: User; jwt: string; db: SupabaseClient };

/** Verifies the Supabase session with Auth (rejects expired/revoked tokens) and returns a user-JWT client. */
export async function requireUser(req: Request): Promise<Ctx> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "UNAUTHENTICATED", "sign in required");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED", "session is invalid or expired");
  const db = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  return { user: data.user, jwt, db };
}

/** Maps PostgREST errors (PTxxx SQLSTATEs) to the API envelope. */
export function dbError(error: { code?: string; message?: string } | null): HttpError {
  const code = error?.code ?? "";
  const msg = error?.message ?? "database error";
  if (code === "PT401") return new HttpError(401, "UNAUTHENTICATED", "sign in required");
  if (code === "PT404" || code === "PT403") return new HttpError(404, "NOT_FOUND", "not found");
  if (code === "PT409") {
    if (msg.startsWith("RECONNECT_REQUIRED")) return new HttpError(409, "RECONNECT_REQUIRED", "reconnect your Google account");
    return new HttpError(409, "CONFLICT", msg);
  }
  if (code === "PT422" || code === "22023" || code === "23514") return new HttpError(422, "INVALID_INPUT", msg);
  return new HttpError(500, "DATABASE_ERROR", "database request failed", true);
}

export async function rateLimit(ctx: Ctx, kind: string) {
  const { data, error } = await ctx.db.rpc("consume_rate_limit", { p_kind: kind });
  if (error) throw dbError(error);
  if (data !== true) throw new HttpError(429, "RATE_LIMITED", "too many requests; try again shortly", true);
}

export async function requireMember(ctx: Ctx, workspaceId: string) {
  const { data, error } = await ctx.db.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new HttpError(404, "NOT_FOUND", "not found");
}

const cache = new Map<string, { v: string | null; at: number }>();
/** Operator secrets: environment first, then Vault (service-role RPC). Cached briefly per isolate. */
export async function secret(name: string): Promise<string | null> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 300_000) return hit.v;
  const { data, error } = await admin.rpc("svc_secret", { p_name: name });
  const v = error ? null : ((data as string | null) ?? null);
  cache.set(name, { v, at: Date.now() });
  return v;
}

export async function requireSecret(name: string, feature: string): Promise<string> {
  const v = await secret(name);
  if (!v) throw new HttpError(503, "PROVIDER_UNAVAILABLE", `${feature} is not configured`, false);
  return v;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
