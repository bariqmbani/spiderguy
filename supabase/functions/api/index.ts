// Single Edge Function router: /functions/v1/api/<route>. Each route authenticates independently.
import { intentRequest } from "./shared/schemas.ts";
import { keywordClassify } from "./shared/parse.ts";
import { CORS, fail, HttpError, ok, parseWith, rateLimit, readJson, requireMember, requireUser, secret, timingSafeEqual } from "./lib/core.ts";
import { classifyWithJev } from "./lib/providers.ts";
import { runWorker } from "./lib/worker.ts";
import { generate, search } from "./lib/knowledge.ts";
import * as google from "./lib/google.ts";

type Handler = (req: Request) => Promise<unknown>;

const userRoute = (fn: (ctx: Awaited<ReturnType<typeof requireUser>>, body: unknown) => Promise<unknown>): Handler => async (req) => {
  const ctx = await requireUser(req);
  const body = req.method === "POST" ? await readJson(req) : {};
  return fn(ctx, body);
};

const routes: Record<string, Handler> = {
  "health": async () => ({ ok: true }),
  "intent": userRoute(async (ctx, body) => {
    const r = parseWith(intentRequest, body);
    await requireMember(ctx, r.workspace_id);
    await rateLimit(ctx, "intent");
    try {
      return await classifyWithJev(r.text, r.request_seq);
    } catch {
      return keywordClassify(r.text, r.request_seq);
    }
  }),
  "search": userRoute(search),
  "generate": userRoute(generate),
  "index-now": userRoute(async (ctx) => {
    await rateLimit(ctx, "search");
    return runWorker(4, 25_000);
  }),
  "ingest-worker": async (req) => {
    const expected = await secret("WORKER_TOKEN");
    const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expected || !timingSafeEqual(got, expected)) throw new HttpError(401, "UNAUTHENTICATED", "worker credential required");
    return runWorker(16, 40_000);
  },
  "google-config": async () => google.publicConfig(),
  "google-connect": userRoute(google.connect),
  "google-callback": userRoute(google.callback),
  "google-picker-token": userRoute((ctx) => google.pickerToken(ctx)),
  "google-import": userRoute(google.driveImport),
  "google-disconnect": userRoute((ctx) => google.disconnect(ctx)),
  "source-refresh": userRoute(google.sourceRefresh),
  "action-prepare": userRoute(google.actionPrepare),
  "action-execute": userRoute(google.actionExecute),
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.replace(/^.*\/api\/?/, "").replace(/\/$/, "");
  const handler = routes[route];
  try {
    if (!handler) throw new HttpError(404, "NOT_FOUND", "unknown route");
    if (req.method !== "POST" && !["health", "google-config"].includes(route)) throw new HttpError(405, "INVALID_INPUT", "use POST");
    return ok(await handler(req), requestId);
  } catch (e) {
    if (e instanceof HttpError) return fail(e, requestId);
    console.error(JSON.stringify({ request_id: requestId, route, error: (e as Error).name }));
    return fail(new HttpError(500, "INTERNAL", "unexpected error", true), requestId);
  }
});
