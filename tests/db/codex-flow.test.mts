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

test("register without an X handle: saved with none (X is optional)", { skip }, async () => {
  m.jar.clear();
  const e = `${tag}.nox@example.test`;
  const r = await read(await m.register.POST(post({ name: "No X Person", email: e, linkedin: "no-x-person", password: PW, proof_password: PW, client: "kanehack", label: "kanehack test" })));
  assert.equal(r.status, 200, JSON.stringify(r.env));
  const [row] = await m.db.query<{ x_handle: string | null }>("select x_handle from members where lower(email) = $1", [e]);
  assert.equal(row.x_handle, null);
  // A malformed handle is still refused.
  m.jar.clear();
  const bad = await read(await m.register.POST(post({ name: "Bad X Person", email: `${tag}.badx@example.test`, linkedin: "bad-x", x: "not a handle!", password: PW, proof_password: PW, client: "kanehack" })));
  assert.equal(bad.status, 400, JSON.stringify(bad.env));
});

test("kanehack signin: email + the stored password gives a token; a wrong password doesn't", { skip }, async () => {
  const good = await read(await m.token.POST(post({ email, password: PW, label: "kanehack test" })));
  assert.equal(good.status, 200, JSON.stringify(good.env));
  assert.match(String(good.env.data?.token), /^khk_/);
  const bad = await read(await m.token.POST(post({ email, password: "not-the-password" })));
  assert.equal(bad.status, 401);
  assert.equal(bad.env.data?.token ?? null, null);
});

// Desk check-in makes the account with no password. The first password kanehack register sends
// claims it (no desk code); once it has one, a different password doesn't take it over.
const passwordless = async (e: string, teamId: number | null = null) => {
  const { emailHash } = await import("../../src/server/core.ts");
  const [row] = await m.db.query<{ id: number }>(
    "insert into members (team_id, name, email, email_hash, display_name, admission_state, checked_in_at) values ($1, 'Desk Person', $2, $3, 'Desk Person', 'admitted', now()) returning id",
    [teamId, e, emailHash(e)],
  );
  return row.id;
};
const profile = (e: string, pw: string, name = "Desk Person") => ({ name, email: e, linkedin: "desk-person", x: "@deskperson", password: pw, proof_password: pw, client: "kanehack" });

test("an account made at desk check-in (no password yet) takes the password kanehack register sends; signin then works", { skip }, async () => {
  const desk = `${tag}.desk@example.test`;
  const id = await passwordless(desk);
  m.jar.clear();
  const r = await read(await m.register.POST(post(profile(desk, PW))));
  assert.equal(r.status, 200, JSON.stringify(r.env));
  assert.equal(Number(r.env.data?.member_id), id, "the desk's account, not a new one");
  assert.match(String(r.env.data?.token), /^khk_/);
  const s = await read(await m.token.POST(post({ email: desk, password: PW })));
  assert.equal(s.status, 200, JSON.stringify(s.env));
  m.jar.clear();
  const other = await read(await m.register.POST(post(profile(desk, "another-pass-99", "Someone Else"))));
  assert.equal(other.status, 401, "it has a password now");
  assert.equal((await m.auth.getMemberById(id))?.name, "Desk Person");
});

test("two first passwords for one account at once: only one claims it", { skip }, async () => {
  const twin = `${tag}.twin@example.test`;
  await passwordless(twin);
  const flow = await import("../../src/server/flow.ts");
  const out = await Promise.allSettled([flow.submitProfile(profile(twin, "first-pass-111"), null), flow.submitProfile(profile(twin, "second-pass-222"), null)]);
  assert.deepEqual(out.map((o) => o.status).sort(), ["fulfilled", "rejected"]);
  const winner = out[0].status === "fulfilled" ? "first-pass-111" : "second-pass-222";
  assert.equal((await read(await m.token.POST(post({ email: twin, password: winner })))).status, 200, "the winner's password is the one kept");
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

test("a teammate the captain added by email (no password yet) claims their account and stays on the team", { skip }, async () => {
  const [{ team_id }] = await m.db.query<{ team_id: number }>("select team_id from members where id = $1", [memberId]);
  const { addMember } = await import("../../src/lib/teams.ts");
  const mate = `${tag}.mate@example.test`;
  const id = await addMember(team_id, "Mate", mate);
  m.jar.clear();
  const r = await read(await m.register.POST(post(profile(mate, PW, "Mate"))));
  assert.equal(r.status, 200, JSON.stringify(r.env));
  assert.equal(Number(r.env.data?.member_id), id);
  assert.equal((await m.auth.getMemberById(id))?.team_id, team_id);
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

// The captain gets a join code in Codex (team_invite_create), not on the /team page; a new
// participant joins with it through team_join. No team, or a locked roster, gets no code.
test("team_invite_create: a join code in Codex that team_join accepts", { skip }, async () => {
  const ctxOf = (mem: import("../../src/server/auth.ts").MemberRow) => ({ member: mem, actor: m.auth.memberActor(mem), requestId: "test" });
  const cap = (await m.auth.getMemberById(memberId))!;
  const inv = await m.A.createTeamInvite(ctxOf(cap));
  assert.match(inv.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(inv.team?.slug && Date.parse(inv.expires_at) > Date.now(), JSON.stringify(inv));
  m.jar.clear();
  const reg = await read(await m.register.POST(post(profile(`${tag}.joiner@example.test`, PW, "Joiner"))));
  const joiner = (await m.auth.getMemberById(Number(reg.env.data?.member_id)))!;
  await m.A.joinTeam(ctxOf(joiner), inv.code);
  assert.equal((await m.auth.getMemberById(joiner.id))?.team_id, cap.team_id, "joined the captain's team");
  m.jar.clear();
  const reg2 = await read(await m.register.POST(post(profile(`${tag}.teamless@example.test`, PW, "Teamless"))));
  const teamless = (await m.auth.getMemberById(Number(reg2.env.data?.member_id)))!;
  await assert.rejects(m.A.createTeamInvite(ctxOf(teamless)), /team first/);
  assert.ok((m.mcp.MCP_TOOL_NAMES as readonly string[]).includes("team_invite_create"));
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
  await assert.rejects(m.A.createTeamInvite({ ...ctx, member: (await m.auth.getMemberById(memberId))! }), /locked/);

  for (const name of ["activation_tick", "idea_save", "team_lock"]) assert.ok((m.mcp.MCP_TOOL_NAMES as readonly string[]).includes(name), name);
});
