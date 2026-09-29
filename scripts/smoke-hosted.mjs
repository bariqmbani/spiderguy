// Smoke test against a deployed project using two pre-provisioned synthetic users (no service key needed).
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_PASSWORD; users smoke.alice@example.test and smoke.bob@example.test.
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SMOKE_PASSWORD: PW } = process.env;
const FN = `${URL_}/functions/v1/api`;
const run = Date.now().toString(36);

async function login(email) {
  const db = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  await db.rpc("ensure_bootstrap");
  return { db, token: data.session.access_token, id: data.user.id, email };
}
async function api(u, route, body, token) {
  const res = await fetch(`${FN}/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, ...(u || token ? { Authorization: `Bearer ${token ?? u.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json()) };
}
const t0 = Date.now();
const step = (name) => console.log(`ok   ${name} (${Date.now() - t0} ms)`);

const alice = await login("smoke.alice@example.test");
const bob = await login("smoke.bob@example.test");
const { data: team, error: te } = await alice.db.rpc("create_workspace", { p_name: `Smoke ${run}` });
assert.ifError(te);
const { data: inv } = await alice.db.rpc("create_invite", { p_workspace_id: team, p_email: bob.email });
assert.equal((await bob.db.rpc("accept_invite", { p_token: inv.token })).data, team);
step("team + invite + accept");

assert.equal((await api(null, "intent", { workspace_id: team, text: "x", request_seq: 1 })).status, 401);
assert.equal((await api(null, "ingest-worker", {}, "wrong")).status, 401);
const cfg = await api(null, "google-config");
assert.equal(cfg.status, 200);
step(`auth boundaries (google configured=${cfg.data.configured})`);

const intent = await api(alice, "intent", { workspace_id: team, text: "standup tomorrow at 9:30am", request_seq: 3 });
assert.equal(intent.status, 200);
assert.equal(intent.data.intent, "event");
step(`intent via ${intent.data.classifier} fallback=${intent.data.fallback}`);

const secret = (await alice.db.rpc("create_card", { p_workspace_id: team, p_type: "note", p_payload: { title: "Vault code", text: `The smoke vault code is ${run}-PRIVATE.` } })).data;
const shared = (await alice.db.rpc("create_card", { p_workspace_id: team, p_type: "note", p_payload: { title: "Parking", text: "Visitor parking is on level B2; register plates at reception." } })).data;
await alice.db.rpc("set_card_visibility", { p_card_id: shared.id, p_expected_revision: 1, p_visibility: "workspace" });
for (let i = 0; i < 30; i++) {
  await api(alice, "index-now", {});
  const { data } = await alice.db.from("sources").select("state").eq("workspace_id", team);
  if (data.length === 2 && data.every((s) => s.state === "ready")) break;
  await new Promise((r) => setTimeout(r, 1500));
}
step("cards indexed (embeddings)");

const a = await api(alice, "search", { workspace_id: team, query: "vault code" });
assert.equal(a.data.mode, "hybrid");
assert.ok(a.data.results.some((r) => r.chunk_id && r.title === "Vault code"));
const b = await api(bob, "search", { workspace_id: team, query: "vault code" });
assert.ok(!JSON.stringify(b.data).includes("PRIVATE"), "private text leaked to teammate");
step("hybrid search; no private leakage");

const ask = await api(bob, "generate", { workspace_id: team, task: "answer", query: "Where do visitors park?" });
assert.equal(ask.status, 200, JSON.stringify(ask.error));
assert.equal(ask.data.abstained, false);
assert.ok(ask.data.citations.length > 0);
step(`grounded answer via ${ask.data.model}: ${ask.data.answer.slice(0, 80)}`);

await alice.db.rpc("remove_member", { p_workspace_id: team, p_user_id: bob.id });
assert.equal((await api(bob, "search", { workspace_id: team, query: "parking" })).status, 404);
await alice.db.rpc("delete_card", { p_card_id: secret.id, p_expected_revision: 1 });
await alice.db.rpc("delete_card", { p_card_id: shared.id, p_expected_revision: 2 });
await alice.db.rpc("delete_workspace", { p_workspace_id: team });
step("removal enforced; cleanup done");
console.log("SMOKE PASSED");
