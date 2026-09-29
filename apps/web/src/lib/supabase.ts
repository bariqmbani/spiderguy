import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
export const FUNCTIONS_URL = `${url}/functions/v1/api`;
export const GOOGLE_AUTH = import.meta.env.VITE_ENABLE_GOOGLE_AUTH !== "false";
export const PASSWORD_AUTH = import.meta.env.VITE_ENABLE_PASSWORD_AUTH === "true";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Calls the api Edge Function with the current session. Aborted requests reject with AbortError. */
export async function api<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${FUNCTIONS_URL}/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? "NETWORK", e.message ?? `request failed (${res.status})`, e.details);
  }
  return json.data as T;
}

/** Maps PostgREST RPC errors (PTxxx) to readable messages. */
export function rpcMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "";
  if (error.code === "PT409" && error.message?.startsWith("revision conflict")) return "Someone else changed this card. Reload to see the latest version; your edits are kept below.";
  if (error.code === "PT404") return "Not found or you no longer have access.";
  if (error.code === "PT403") return "You don't have permission to do that.";
  return error.message ?? "Request failed";
}
