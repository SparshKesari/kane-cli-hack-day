// The whole participant flow from a Codex session, no browser: kanehack registers through the
// API and gets a bearer token at once; an existing account signs in with email + password; the
// TestMu AI claim runs with that token and the locally stored password; then the event tools
// read the activation steps, tick step 3, save the idea and lock the team.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  auth: typeof import("../../src/server/auth.ts");
  teams: typeof import("../../src/server/teams.ts");
  A: typeof import("../../src/server/mcp-adapters.ts");
  mcp: typeof import("../../src/server/mcp.ts");
  register: typeof import("../../src/app/api/v1/auth/register/route.ts");
  token: typeof import("../../src/app/api/v1/auth/token/route.ts");
  claim: typeof import("../../src/app/api/v1/activation/claim/route.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `cx${Date.now().toString(36)}p${process.pid.toString(36)}`;
const email = `${tag}.codex@example.test`;
const PW = `pw-${tag}-correct`;

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  delete process.env.HACKOS_ENV;
  delete process.env.VERCEL_ENV;
  delete process.env.TESTMU_TRIAL_CLAIM_URL;
  delete process.env.TESTMU_TEAM_INVITE_URL;
  delete process.env.TESTMU_CLAIM_STUB;
  const [db, auth, teams, A, mcp, register, token, claim, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/server/auth.ts"),
    import("../../src/server/teams.ts"),
    import("../../src/server/mcp-adapters.ts"),
    import("../../src/server/mcp.ts"),
    import("../../src/app/api/v1/auth/register/route.ts"),
    import("../../src/app/api/v1/auth/token/route.ts"),
    import("../../src/app/api/v1/activation/claim/route.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, auth, teams, A, mcp, register, token, claim, jar: headers.jar };
  await db.query("update hack_events set team_lock_at = greatest(team_lock_at, now() + interval '2 days') where id = current_event_id()");
});

after(async () => {
  if (skip || !m) return;
  await m.db.query(`delete from teams where id in (select team_id from members where email like '${tag}.%')`).catch(() => {});
  await m.db.pool.end().catch(() => {});
});

const post = (body: unknown, token?: string) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const read = async (res: Response) => ({ status: res.status, env: (await res.json()) as { status: string; message: string; data: Record<string, unknown> | null; error: { code: string } | null } });

let regToken = "";
let memberId = 0;

test("kanehack register: the API saves the profile and returns a bearer token, no browser pairing", { skip }, async () => {
  m.jar.clear();
  const r = await read(await m.register.POST(post({ name: "Codex Person", email, linkedin: "codex-person", x: "@codexperson", password: PW, proof_password: PW, client: "kanehack", label: "kanehack test" })));
  assert.equal(r.status, 200, JSON.stringify(r.env));
  assert.match(String(r.env.data?.token), /^khk_/);
  memberId = Number(r.env.data?.member_id);
  regToken = String(r.env.data?.token);
  // The browser form (no client) gets no token.
  m.jar.clear();
  const web = await read(await m.register.POST(post({ name: "Codex Person", email, linkedin: "codex-person", x: "@codexperson", password: PW, proof_password: PW })));
  assert.equal(web.env.data?.token, undefined);
});

test("kanehack signin: email + the stored password gives a token; a wrong password doesn't", { skip }, async () => {
  const good = await read(await m.token.POST(post({ email, password: PW, label: "kanehack test" })));
  assert.equal(good.status, 200, JSON.stringify(good.env));
  assert.match(String(good.env.data?.token), /^khk_/);
  const bad = await read(await m.token.POST(post({ email, password: "not-the-password" })));
  assert.equal(bad.status, 401);
  assert.equal(bad.env.data?.token ?? null, null);
});

test("kanehack claim: the TestMu AI plan is claimed with the token and the stored password", { skip }, async () => {
  let me = (await m.auth.getMemberById(memberId))!;
  await m.teams.createTeam({ member: me, actor: m.auth.memberActor(me) }, { name: `${tag} Codex`, track: "Web App" });
  m.jar.clear(); // no session cookie either: the CLI has only its token
  const noToken = await read(await m.claim.POST(post({ password: PW })));
  assert.equal(noToken.status, 401);
  const r = await read(await m.claim.POST(post({ password: PW }, regToken)));
  assert.equal(r.status, 200, JSON.stringify(r.env));
  assert.equal(r.env.data?.outcome, "claimed");
  me = (await m.auth.getMemberById(memberId))!;
  const s = await m.A.participantStatus(me);
  assert.equal(s.activation_steps?.testmu_plan, "claimed");
  assert.equal(s.activation_steps?.testmu_signup, true, "the claim ticks step 1");
  assert.equal(s.activation_steps?.codex_credits, false);
});

// Everyone at the venue shares one public IP: a per-IP cap of 10 locked the room out after ten
// people. Guessing one account's password is still capped, per email.
test("a shared venue IP doesn't lock people out of register or signin; guessing one email is still capped", { skip }, async () => {
  await m.db.query("delete from rate_limit_buckets where bucket like 'api-register:%' or bucket like 'api-token%'");
  for (let i = 0; i < 12; i++) {
    m.jar.clear(); // separate laptops: no shared session cookie
    const r = await read(await m.register.POST(post({ name: `Venue ${i}`, email: `${tag}.v${i}@example.test`, linkedin: `venue-${i}`, x: `@venue${i}`, password: PW, proof_password: PW, client: "kanehack" })));
    assert.equal(r.status, 200, `registration ${i + 1}: ${JSON.stringify(r.env)}`);
  }
  for (let i = 0; i < 12; i++) {
    const r = await read(await m.token.POST(post({ email: `${tag}.v${i}@example.test`, password: PW })));
    assert.equal(r.status, 200, `sign-in ${i + 1}: ${JSON.stringify(r.env)}`);
  }
  const codes: number[] = [];
  // Every try counts per email (like the sign-in form), so guess at one nobody has used yet.
  for (let i = 0; i < 11; i++) codes.push((await m.token.POST(post({ email: `${tag}.guessed@example.test`, password: `wrong-${i}-password` }))).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.equal(codes[10], 429, "the 11th guess for one email is rate limited");
});

test("event tools: tick step 3, save the idea, lock the team", { skip }, async () => {
  const me = (await m.auth.getMemberById(memberId))!;
  const ctx = { member: me, actor: m.auth.memberActor(me), requestId: "test" };
  await m.A.tickActivation(ctx, "codex_credits", true);
  assert.equal((await m.A.participantStatus(me)).activation_steps?.codex_credits, true);

  await m.A.saveTeamIdea(ctx, { title: "ShelfCheck", private_description: "Staff photograph a shelf; the app lists what is missing.", app_type: "Web App", kane_plan: "Kane tests the upload flow." });
  assert.equal((await m.A.participantStatus(me)).idea?.saved, true);

  await m.A.lockTeam(ctx);
  const [t] = await m.db.query<{ state: string }>("select state from teams where id = $1", [me.team_id]);
  assert.equal(t.state, "roster_locked");

  for (const name of ["activation_tick", "idea_save", "team_lock"]) assert.ok((m.mcp.MCP_TOOL_NAMES as readonly string[]).includes(name), name);
});
