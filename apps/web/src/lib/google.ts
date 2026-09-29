// Google Identity Services and Picker helpers. Access tokens stay in memory only.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src)!;
}

export const loadGis = () => loadScript("https://accounts.google.com/gsi/client");

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Renders the GIS sign-in button; the callback receives the ID token and the raw nonce for Supabase. */
export async function renderGoogleButton(el: HTMLElement, clientId: string, onToken: (idToken: string, nonce: string) => void) {
  await loadGis();
  const nonce = crypto.randomUUID() + crypto.randomUUID();
  window.google.accounts.id.initialize({
    client_id: clientId,
    nonce: await sha256Hex(nonce),
    use_fedcm_for_prompt: true,
    callback: (r: { credential: string }) => onToken(r.credential, nonce),
  });
  window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with" });
}

/** Incremental-consent authorization code flow (popup). Resolves with the one-time code. */
export async function requestCode(clientId: string, scope: string, state: string): Promise<{ code: string; state: string }> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope,
      state,
      ux_mode: "popup",
      include_granted_scopes: true,
      callback: (r: { code?: string; state?: string; error?: string }) => {
        if (r.error || !r.code) reject(new Error(r.error ?? "authorization canceled"));
        else resolve({ code: r.code, state: r.state ?? "" });
      },
      error_callback: (e: { type?: string }) => reject(new Error(e?.type ?? "authorization canceled")),
    });
    client.requestCode();
  });
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
