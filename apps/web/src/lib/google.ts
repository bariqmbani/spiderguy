// Google access goes through Supabase Auth's Google provider; provider tokens are handed to the server once, then dropped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "./supabase.ts";

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

export const SCOPES = {
  drive: "https://www.googleapis.com/auth/drive.file",
  gmail: "https://www.googleapis.com/auth/gmail.compose",
  calendar: "https://www.googleapis.com/auth/calendar.events.owned",
} as const;
export type Capability = keyof typeof SCOPES;
const PENDING = "google_connect_pending";

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname + location.search, queryParams: { prompt: "select_account" } },
  });
}

/** Incremental consent for one capability. Links Google to the current user when it is not linked yet. */
export async function connectGoogle(capability: Capability, userId: string) {
  sessionStorage.setItem(PENDING, JSON.stringify({ capability, userId }));
  const options = {
    scopes: SCOPES[capability],
    redirectTo: `${location.origin}${location.pathname}?google_connect=${capability}`,
    queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  };
  const { data } = await supabase.auth.getUser();
  const linked = data.user?.identities?.some((i) => i.provider === "google");
  if (!linked) {
    const { error } = await supabase.auth.linkIdentity({ provider: "google", options });
    if (!error) return;
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options });
  if (error) throw error;
}

/** After the OAuth redirect: returns the pending capability and provider tokens, or null. */
export async function takeGoogleConnectResult(): Promise<
  { capability: Capability; accessToken: string; refreshToken: string | null } | { error: string } | null
> {
  const params = new URLSearchParams(location.search);
  const cap = params.get("google_connect") as Capability | null;
  if (!cap) return null;
  history.replaceState(null, "", location.pathname);
  const pending = JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as { capability: string; userId: string } | null;
  sessionStorage.removeItem(PENDING);
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!pending || pending.capability !== cap || !(cap in SCOPES)) return { error: "Unexpected Google connection response; try again." };
  if (!s?.provider_token) return { error: "Google did not return access; try connecting again." };
  if (s.user.id !== pending.userId) return { error: "You chose a Google account that belongs to a different app user. Sign out and back in, then retry." };
  return { capability: cap, accessToken: s.provider_token, refreshToken: s.provider_refresh_token ?? null };
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(el);
    }));
  }
  return loaded.get(src)!;
}

/** Opens Google Picker restricted to Docs/TXT/Markdown; resolves with the chosen file ID or null. */
export async function pickDriveFile(accessToken: string, apiKey: string | null, appId: string | null): Promise<string | null> {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise<void>((r) => window.gapi.load("picker", () => r()));
  const g = window.google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS)
      .setMimeTypes("application/vnd.google-apps.document,text/plain,text/markdown")
      .setIncludeFolders(false);
    const builder = new g.picker.PickerBuilder().addView(view).setOAuthToken(accessToken)
      .setCallback((d: any) => {
        if (d.action === g.picker.Action.PICKED) resolve(d.docs?.[0]?.id ?? null);
        else if (d.action === g.picker.Action.CANCEL) resolve(null);
      });
    if (apiKey) builder.setDeveloperKey(apiKey);
    if (appId) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}
