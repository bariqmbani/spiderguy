import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { GOOGLE_SIGNIN_CLIENT_ID, PASSWORD_AUTH, supabase } from "./lib/supabase.ts";
import { renderGoogleButton } from "./lib/google.ts";
import { Shell } from "./components/Shell.tsx";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <p className="center muted">Loading…</p>;
  if (!session) return <SignIn />;
  return <Shell key={session.user.id} session={session} />;
}

function SignIn() {
  const btn = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"in" | "up">("in");

  useEffect(() => {
    if (!GOOGLE_SIGNIN_CLIENT_ID || !btn.current) return;
    renderGoogleButton(btn.current, GOOGLE_SIGNIN_CLIENT_ID, async (token, nonce) => {
      const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token, nonce });
      if (error) setError("Google sign-in failed. Try again.");
    }).catch(() => setError("Google sign-in is unavailable."));
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    setError("");
    const { error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else if (mode === "up") setError("Check your inbox to confirm your email, then sign in.");
  }

  return (
    <main className="signin">
      <h1>ShapeShift Workspace</h1>
      <p className="muted">Type anything. Get the right card. Search what your team knows.</p>
      {GOOGLE_SIGNIN_CLIENT_ID && <div ref={btn} aria-label="Sign in with Google" />}
      {PASSWORD_AUTH && (
        <form onSubmit={submit} className="stack">
          <label>Email <input name="email" type="email" required autoComplete="email" /></label>
          <label>Password <input name="password" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
          <button disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>
          <button type="button" className="link" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </form>
      )}
      {!GOOGLE_SIGNIN_CLIENT_ID && !PASSWORD_AUTH && <p>No sign-in method is configured. Set VITE_GOOGLE_CLIENT_ID.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
