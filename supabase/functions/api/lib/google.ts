import { z } from "zod";
import { actionExecuteRequest, actionPrepareRequest, emailSchema, eventSchema, uuid } from "../shared/schemas.ts";
import { isValidTimeZone } from "../shared/parse.ts";
import { chunkText, decodeUtf8Strict, normalizeText } from "../shared/chunk.ts";
import { admin, type Ctx, dbError, HttpError, parseWith, rateLimit, requireMember, requireSecret, secret } from "./core.ts";

export const SCOPES = {
  drive: "https://www.googleapis.com/auth/drive.file",
  gmail: "https://www.googleapis.com/auth/gmail.compose",
  calendar: "https://www.googleapis.com/auth/calendar.events.owned",
} as const;
type Capability = keyof typeof SCOPES;
const capabilitySchema = z.object({ capability: z.enum(["drive", "gmail", "calendar"]) }).strict();

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(s: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof s === "string" ? new TextEncoder().encode(s) : s;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const byteaHex = (b: Uint8Array) => `\\x${hex(b)}`;

async function cipherKey(): Promise<CryptoKey> {
  const raw = unb64(await requireSecret("TOKEN_ENCRYPTION_KEY", "Google token encryption"));
  if (raw.length !== 32) throw new HttpError(503, "PROVIDER_UNAVAILABLE", "token encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(plain: string | undefined | null): Promise<string | null> {
  if (!plain) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cipherKey(), new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
async function open(sealed: string): Promise<string> {
  const [, iv, ct] = sealed.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await cipherKey(), unb64(ct));
  return new TextDecoder().decode(pt);
}

async function gfetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)googleapis\.com$/.test(u.hostname)) throw new HttpError(500, "INTERNAL", "blocked host");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 15000);
  try {
    return await fetch(u, { ...init, signal: ctl.signal, redirect: "error" });
  } finally {
    clearTimeout(t);
  }
}

export async function publicConfig() {
  const clientId = await secret("GOOGLE_CLIENT_ID");
  return { configured: !!clientId && !!(await secret("GOOGLE_CLIENT_SECRET")), client_id: clientId, api_key: await secret("GOOGLE_API_KEY"), app_id: await secret("GOOGLE_APP_ID") };
}

export async function connect(ctx: Ctx, body: unknown) {
  const { capability } = parseWith(capabilitySchema, body);
  await rateLimit(ctx, "google");
  const clientId = await requireSecret("GOOGLE_CLIENT_ID", "Google integration");
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await admin.rpc("svc_oauth_state_create", { p_user_id: ctx.user.id, p_capability: capability, p_state_hash: byteaHex(await sha256(state)) });
  if (error) throw dbError(error);
  return { client_id: clientId, scope: `openid email ${SCOPES[capability]}`, state, capability };
}

async function tokenRequest(params: Record<string, string>) {
  const res = await gfetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({})) as Record<string, string | number>;
  return { status: res.status, body };
}

const callbackSchema = z.object({ code: z.string().min(10).max(2048), state: z.string().min(20).max(200) }).strict();

export async function callback(ctx: Ctx, body: unknown) {
  const req = parseWith(callbackSchema, body);
  const { data: capability, error } = await admin.rpc("svc_oauth_state_consume", { p_user_id: ctx.user.id, p_state_hash: byteaHex(await sha256(req.state)) });
  if (error) throw dbError(error);
  if (!capability) throw new HttpError(400, "INVALID_STATE", "authorization request expired or was already used; start again");
  const clientId = await requireSecret("GOOGLE_CLIENT_ID", "Google integration");
  const tok = await tokenRequest({
    code: req.code, client_id: clientId, client_secret: await requireSecret("GOOGLE_CLIENT_SECRET", "Google integration"),
    redirect_uri: "postmessage", grant_type: "authorization_code",
  });
  if (tok.status !== 200 || !tok.body.access_token) throw new HttpError(400, "GOOGLE_DENIED", "Google did not grant access");
  const granted = String(tok.body.scope ?? "").split(" ");
  if (!granted.includes(SCOPES[capability as Capability])) {
    throw new HttpError(403, "SCOPE_DENIED", `the ${capability} permission was not granted; that feature stays disabled`);
  }
  const info = await gfetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(tok.body.id_token ?? ""))}`);
  const claims = await info.json().catch(() => ({})) as Record<string, string>;
  if (info.status !== 200 || claims.aud !== clientId || !claims.sub || claims.email_verified !== "true") {
    throw new HttpError(400, "GOOGLE_DENIED", "could not verify the Google account");
  }
  const { data: connectionId, error: e2 } = await admin.rpc("svc_google_store", {
    p_user_id: ctx.user.id, p_subject: claims.sub, p_email: claims.email, p_scopes: granted.filter((s) => s.startsWith("https://")),
    p_refresh_ct: await seal(tok.body.refresh_token as string | undefined), p_access_ct: await seal(String(tok.body.access_token)),
    p_access_expires_at: new Date(Date.now() + Number(tok.body.expires_in ?? 3000) * 1000).toISOString(), p_key_version: 1,
  });
  if (e2) {
    if (e2.message?.includes("ACCOUNT_MISMATCH")) throw new HttpError(409, "ACCOUNT_MISMATCH", "disconnect the current Google account before connecting a different one");
    throw dbError(e2);
  }
  return { connection_id: connectionId, email: claims.email, capability };
}

type Creds = { connection_id: string; email: string; scopes: string[]; status: string; version: number; refresh_ct: string | null; access_ct: string | null; access_expires_at: string | null };

/** Returns a valid access token; refreshes with version-serialized writes; invalid_grant requires reconnect. */
export async function accessToken(userId: string, capability: Capability): Promise<{ token: string; creds: Creds }> {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await admin.rpc("svc_google_credentials", { p_user_id: userId });
    if (error) throw dbError(error);
    const creds = (data as Creds[])[0];
    if (!creds || creds.status !== "active") throw new HttpError(409, "RECONNECT_REQUIRED", "connect your Google account");
    if (!creds.scopes.includes(SCOPES[capability])) throw new HttpError(403, "SCOPE_REQUIRED", `connect Google ${capability} access first`);
    if (creds.access_ct && creds.access_expires_at && Date.parse(creds.access_expires_at) > Date.now() + 60_000) {
      return { token: await open(creds.access_ct), creds };
    }
    if (!creds.refresh_ct) {
      await admin.rpc("svc_google_set_status", { p_user_id: userId, p_status: "reconnect_required" });
      throw new HttpError(409, "RECONNECT_REQUIRED", "reconnect your Google account");
    }
    const tok = await tokenRequest({
      client_id: await requireSecret("GOOGLE_CLIENT_ID", "Google integration"),
      client_secret: await requireSecret("GOOGLE_CLIENT_SECRET", "Google integration"),
      refresh_token: await open(creds.refresh_ct), grant_type: "refresh_token",
    });
    if (tok.body.error === "invalid_grant") {
      await admin.rpc("svc_google_set_status", { p_user_id: userId, p_status: "reconnect_required" });
      throw new HttpError(409, "RECONNECT_REQUIRED", "Google access was revoked or expired; reconnect");
    }
    if (tok.status !== 200 || !tok.body.access_token) throw new HttpError(503, "PROVIDER_UNAVAILABLE", "Google token refresh failed", true);
    const { data: won } = await admin.rpc("svc_google_update_access", {
      p_connection_id: creds.connection_id, p_expected_version: creds.version, p_access_ct: await seal(String(tok.body.access_token)),
      p_expires_at: new Date(Date.now() + Number(tok.body.expires_in ?? 3000) * 1000).toISOString(),
    });
    if (won) return { token: String(tok.body.access_token), creds };
  }
  throw new HttpError(503, "PROVIDER_UNAVAILABLE", "Google token refresh contention; retry", true);
}

export async function pickerToken(ctx: Ctx) {
  await rateLimit(ctx, "google");
  const { token } = await accessToken(ctx.user.id, "drive");
  return { access_token: token, expires_in: 300 };
}

export async function disconnect(ctx: Ctx) {
  const { data } = await admin.rpc("svc_google_credentials", { p_user_id: ctx.user.id });
  const creds = (data as Creds[] | null)?.[0];
  if (creds?.refresh_ct) {
    try {
      await gfetch("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: await open(creds.refresh_ct) }),
      });
    } catch { /* local disconnect still proceeds */ }
  }
  const { error } = await admin.rpc("svc_google_set_status", { p_user_id: ctx.user.id, p_status: "disconnected" });
  if (error) throw dbError(error);
  return { status: "disconnected" };
}

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const SUPPORTED = new Set(["application/vnd.google-apps.document", "text/plain", "text/markdown", "text/x-markdown"]);
const importSchema = z.object({ workspace_id: uuid, file_id: z.string().regex(FILE_ID) }).strict();

export async function driveFetchText(token: string, fileId: string) {
  if (!FILE_ID.test(fileId)) throw new HttpError(422, "INVALID_INPUT", "invalid file id");
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await gfetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,webViewLink,shared,trashed`, { headers: auth });
  if (meta.status === 403 || meta.status === 404) {
    await meta.body?.cancel();
    throw new HttpError(404, "SOURCE_ACCESS_LOST", "the file is not accessible with your Google connection");
  }
  if (!meta.ok) throw new HttpError(503, "PROVIDER_UNAVAILABLE", "Google Drive is unavailable", true);
  const m = await meta.json() as { name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string; shared?: boolean; trashed?: boolean };
  if (m.trashed) throw new HttpError(404, "SOURCE_ACCESS_LOST", "the file is in the trash");
  if (!SUPPORTED.has(m.mimeType)) throw new HttpError(422, "UNSUPPORTED_TYPE", "only Google Docs and TXT/Markdown files are supported");
  if (m.size && Number(m.size) > 5 * 1024 * 1024) throw new HttpError(422, "TOO_LARGE", "maximum size is 5 MiB");
  const url = m.mimeType === "application/vnd.google-apps.document"
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await gfetch(url, { headers: auth, timeoutMs: 20000 });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status === 403 || res.status === 404 ? 404 : 503, res.status === 403 || res.status === 404 ? "SOURCE_ACCESS_LOST" : "PROVIDER_UNAVAILABLE", "could not download the file");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw new HttpError(422, "TOO_LARGE", "maximum size is 5 MiB");
  const text = decodeUtf8Strict(bytes);
  if (text === null) throw new HttpError(422, "INVALID_UTF8", "file is not valid UTF-8 text");
  const norm = normalizeText(text.replace(/^\uFEFF/, ""));
  if (!norm || !chunkText(norm).length) throw new HttpError(422, "EMPTY_CONTENT", "file has no text");
  if (norm.length > 100_000) throw new HttpError(422, "TOO_MANY_CHARACTERS", "file exceeds 100,000 characters");
  const link = m.webViewLink && m.webViewLink.startsWith("https://") ? m.webViewLink : `https://drive.google.com/file/d/${fileId}/view`;
  return { title: m.name, mime: m.mimeType, text: norm, modified: m.modifiedTime ?? null, link, shared: !!m.shared };
}

export async function driveImport(ctx: Ctx, body: unknown) {
  const req = parseWith(importSchema, body);
  await rateLimit(ctx, "google");
  await requireMember(ctx, req.workspace_id);
  const { token, creds } = await accessToken(ctx.user.id, "drive");
  const f = await driveFetchText(token, req.file_id);
  const { data, error } = await admin.rpc("svc_drive_snapshot", {
    p_user_id: ctx.user.id, p_workspace_id: req.workspace_id, p_connection_id: creds.connection_id, p_file_id: req.file_id,
    p_title: f.title, p_mime: f.mime, p_url: f.link, p_text: f.text, p_modified_at: f.modified,
  });
  if (error) throw dbError(error);
  return { ...(data as Record<string, unknown>), snapshot: true, google_shared: f.shared, imported_at: new Date().toISOString() };
}

export async function sourceRefresh(ctx: Ctx, body: unknown) {
  const { source_id } = parseWith(z.object({ source_id: uuid }).strict(), body);
  await rateLimit(ctx, "google");
  const { data: src, error } = await ctx.db.from("sources").select("id, workspace_id, owner_id, kind, external_file_id").eq("id", source_id).maybeSingle();
  if (error) throw dbError(error);
  if (!src || src.owner_id !== ctx.user.id || src.kind !== "drive_snapshot") throw new HttpError(404, "NOT_FOUND", "not found");
  let token: string, creds: Creds;
  try {
    ({ token, creds } = await accessToken(ctx.user.id, "drive"));
  } catch (e) {
    if ((e as HttpError).code === "RECONNECT_REQUIRED") await admin.rpc("svc_source_unavailable", { p_source_id: source_id, p_error: "RECONNECT_REQUIRED" });
    throw e;
  }
  try {
    const f = await driveFetchText(token, src.external_file_id);
    const { data, error: e2 } = await admin.rpc("svc_drive_snapshot", {
      p_user_id: ctx.user.id, p_workspace_id: src.workspace_id, p_connection_id: creds.connection_id, p_file_id: src.external_file_id,
      p_title: f.title, p_mime: f.mime, p_url: f.link, p_text: f.text, p_modified_at: f.modified,
    });
    if (e2) throw dbError(e2);
    return data;
  } catch (e) {
    if ((e as HttpError).code === "SOURCE_ACCESS_LOST") await admin.rpc("svc_source_unavailable", { p_source_id: source_id, p_error: "SOURCE_ACCESS_LOST" });
    throw e;
  }
}

// ---- Confirmed external actions ----

function encodeHeader(v: string): string {
  if (/[\r\n]/.test(v)) throw new HttpError(422, "INVALID_INPUT", "header values cannot contain line breaks");
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(new TextEncoder().encode(v))}?=`;
}

export function buildMime(p: z.infer<typeof emailSchema>): string {
  const body = b64(new TextEncoder().encode(p.body)).replace(/.{76}/g, "$&\r\n");
  const lines = [
    `To: ${p.to.map(encodeHeader).join(", ")}`,
    ...(p.cc?.length ? [`Cc: ${p.cc.map(encodeHeader).join(", ")}`] : []),
    `Subject: ${encodeHeader(p.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  return lines.join("\r\n");
}

function canonical(kind: string, payload: Record<string, unknown>) {
  if (kind === "gmail_draft") {
    const p = parseWith(emailSchema, payload);
    if (!p.to.length) throw new HttpError(422, "INVALID_INPUT", "add at least one recipient");
    return { to: p.to, ...(p.cc?.length ? { cc: p.cc } : {}), subject: p.subject, body: p.body };
  }
  const p = parseWith(eventSchema, payload);
  if (!isValidTimeZone(p.timezone)) throw new HttpError(422, "INVALID_INPUT", "unknown time zone");
  return { title: p.title, start: p.start, end: p.end, timezone: p.timezone, ...(p.location ? { location: p.location } : {}), ...(p.notes ? { notes: p.notes } : {}) };
}

export async function actionPrepare(ctx: Ctx, body: unknown) {
  const req = parseWith(actionPrepareRequest, body);
  await rateLimit(ctx, "action");
  const payload = canonical(req.kind, req.payload as Record<string, unknown>);
  const { data, error } = await ctx.db.rpc("action_prepare", {
    p_workspace_id: req.workspace_id, p_kind: req.kind, p_payload: payload, p_idempotency_key: req.idempotency_key,
  });
  if (error) throw dbError(error);
  const a = data as { id: string; payload: unknown; payload_hash: string; expires_at: string; state: string };
  const { data: conn } = await ctx.db.from("google_connections").select("email").maybeSingle();
  return {
    action_id: a.id, payload_hash: a.payload_hash, expires_at: a.expires_at, state: a.state, preview: a.payload,
    account_email: conn?.email ?? null, destination: req.kind === "gmail_draft" ? "Gmail drafts (not sent)" : "Primary Google Calendar (no attendees)",
  };
}

type Action = { id: string; kind: string; state: string; payload: Record<string, unknown>; provider_resource_id: string | null; provider_link: string | null; error_code: string | null };

function eventId(actionId: string) {
  return sha256(actionId).then((h) => `a${hex(h).slice(0, 40)}`);
}

async function record(id: string, state: string, resource: string | null, link: string | null, err: string | null) {
  await admin.rpc("svc_action_record", { p_action_id: id, p_state: state, p_resource_id: resource, p_link: link, p_error: err });
  return { action_id: id, state, provider_resource_id: resource, provider_link: link, error_code: err };
}

async function findEvent(token: string, id: string): Promise<{ id: string; htmlLink?: string } | null | "unknown"> {
  try {
    const r = await gfetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 404 || r.status === 410) {
      await r.body?.cancel();
      return null;
    }
    if (!r.ok) {
      await r.body?.cancel();
      return "unknown";
    }
    return await r.json();
  } catch {
    return "unknown";
  }
}

export async function actionExecute(ctx: Ctx, body: unknown) {
  const req = parseWith(actionExecuteRequest, body);
  await rateLimit(ctx, "action");
  const { data, error } = await ctx.db.rpc("action_begin_execute", { p_action_id: req.action_id, p_payload_hash: req.payload_hash });
  if (error) throw dbError(error);
  const a = data as Action;
  if (a.state === "outcome_unknown" && a.kind === "calendar_event") {
    const { token } = await accessToken(ctx.user.id, "calendar");
    const found = await findEvent(token, await eventId(a.id));
    if (found && found !== "unknown") return record(a.id, "succeeded", found.id, found.htmlLink ?? null, null);
    if (found === null) return record(a.id, "failed", null, null, "NOT_CREATED");
  }
  if (a.state !== "executing") {
    return { action_id: a.id, state: a.state, provider_resource_id: a.provider_resource_id, provider_link: a.provider_link, error_code: a.error_code };
  }
  const payload = canonical(a.kind, a.payload);
  if (a.kind === "gmail_draft") {
    let token: string;
    try {
      ({ token } = await accessToken(ctx.user.id, "gmail"));
    } catch (e) {
      await record(a.id, "failed", null, null, (e as HttpError).code);
      throw e;
    }
    const raw = b64url(new TextEncoder().encode(buildMime(payload as z.infer<typeof emailSchema>)));
    let res: Response;
    try {
      res = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { raw } }), timeoutMs: 20000,
      });
    } catch {
      // The draft may or may not exist; never retry automatically.
      return record(a.id, "outcome_unknown", null, null, "TIMEOUT");
    }
    if (res.status >= 500) {
      await res.body?.cancel();
      return record(a.id, "outcome_unknown", null, null, `HTTP_${res.status}`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      return record(a.id, "failed", null, null, res.status === 403 ? "SCOPE_DENIED" : `HTTP_${res.status}`);
    }
    const d = await res.json() as { id: string; message?: { id?: string } };
    return record(a.id, "succeeded", d.id, `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(d.message?.id ?? d.id)}`, null);
  }
  const ev = payload as z.infer<typeof eventSchema>;
  let token: string;
  try {
    ({ token } = await accessToken(ctx.user.id, "calendar"));
  } catch (e) {
    await record(a.id, "failed", null, null, (e as HttpError).code);
    throw e;
  }
  const id = await eventId(a.id);
  let res: Response;
  try {
    res = await gfetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        id, summary: ev.title, location: ev.location, description: ev.notes,
        start: { dateTime: ev.start, timeZone: ev.timezone }, end: { dateTime: ev.end, timeZone: ev.timezone },
      }),
      timeoutMs: 20000,
    });
  } catch {
    const found = await findEvent(token, id);
    if (found && found !== "unknown") return record(a.id, "succeeded", found.id, found.htmlLink ?? null, null);
    return record(a.id, "outcome_unknown", null, null, "TIMEOUT");
  }
  if (res.status === 409) {
    await res.body?.cancel();
    const found = await findEvent(token, id);
    if (found && found !== "unknown") return record(a.id, "succeeded", found.id, found.htmlLink ?? null, null);
    return record(a.id, "outcome_unknown", null, null, "CONFLICT");
  }
  if (!res.ok) {
    await res.body?.cancel();
    return record(a.id, res.status >= 500 ? "outcome_unknown" : "failed", null, null, `HTTP_${res.status}`);
  }
  const e = await res.json() as { id: string; htmlLink?: string };
  return record(a.id, "succeeded", e.id, e.htmlLink && e.htmlLink.startsWith("https://") ? e.htmlLink : null, null);
}
