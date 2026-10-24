// TestMu AI team sync against a *throwaway* database and a local mock of both
// TestMu AI APIs (tests/support/testmu-mock.mjs, shaped by the contract):
//   - the captain's step-2 claim on a locked team invites each teammate once with the
//     same password, waiting out a short Retry-After
//   - teammates who claimed first are moved (MEMBER_ADDED), those who claim later join
//     (JOINED_TEAM), and a non-captain's claim makes no invite calls
//   - a sync failure never blocks the claim or step 3, keeps the captain on /activate,
//     and the retry skips teammates already in
//   - a wrong password on retry stops at the first call, only the captain can retry,
//     and an unlocked team isn't synced at the claim
//   - NOT_TEAM_LEAD and an unreachable invite API leave the claim claimed
//   - a solo team makes no calls, and the stub answers outside production
//   - no password is ever written to any table, the audit log or a redirect
//
//   QA_DATABASE_URL=postgres://…throwaway… npm run test:db
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTestmuMock } from "../support/testmu-mock.mjs";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  session: typeof import("../../src/lib/session.ts");
  flow: typeof import("../../src/server/flow.ts");
  teams: typeof import("../../src/server/teams.ts");
  act: typeof import("../../src/server/event-activation.ts");
  sync: typeof import("../../src/server/testmu-team.ts");
  auth: typeof import("../../src/server/auth.ts");
  actions: typeof import("../../src/app/activate/actions.ts");
  jar: Map<string, string>;
};
let m: Mods;
// The other DB test files tag by the millisecond and run in parallel: the pid keeps this one apart.
const tag = `qa${Date.now().toString(36)}p${process.pid.toString(36)}`;
const email = (s: string) => `${tag}.${s}@example.test`;
// Every password used here is unique to this run, so the final grep can't match anything else.
const pw = (s: string) => `pw-${tag}-${s}`;
const used = new Set<string>();
const redirects: string[] = [];
const mock = createTestmuMock({ ipLimit: 10_000, emailLimit: 10_000, idBase: 1_000_000 + (Date.now() % 1_000_000) * 100 });
let server: Server;
let base = "";

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  delete process.env.HACKOS_ENV;
  delete process.env.TESTMU_KEY_REQUIRED;
  server = mock.server;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.TESTMU_TRIAL_CLAIM_URL = `${base}${mock.CLAIM}`;
  process.env.TESTMU_TEAM_INVITE_URL = `${base}${mock.INVITE}`;
  const [db, session, flow, teams, act, sync, auth, actions, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/lib/session.ts"),
    import("../../src/server/flow.ts"),
    import("../../src/server/teams.ts"),
    import("../../src/server/event-activation.ts"),
    import("../../src/server/testmu-team.ts"),
    import("../../src/server/auth.ts"),
    import("../../src/app/activate/actions.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, session, flow, teams, act, sync, auth, actions, jar: headers.jar };
  await db.query("update hack_events set team_lock_at = greatest(team_lock_at, now() + interval '2 days') where id = current_event_id()");
});

after(async () => {
  server?.close();
  if (skip || !m) return;
  const members = `(select id from members where email like '${tag}.%')`;
  await m.db.query(`delete from codex_credit_codes where code like '${tag.toUpperCase()}%'`).catch(() => {});
  await m.db.query(`delete from teams where id in (select team_id from team_memberships where member_id in ${members})`).catch(() => {});
  const c = await m.db.pool.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    await c.query(`delete from member_consents where member_id in ${members}`);
    await c.query("commit");
  } finally {
    c.release();
  }
  await m.db.query(`delete from members where email like '${tag}.%'`).catch(() => {});
  await m.db.pool.end();
});

/** The URL a server action redirected to (redirect() throws NEXT_REDIRECT), or what it returned. */
async function outcome<T>(p: Promise<T>): Promise<{ redirect: string | null; value: T | null }> {
  try {
    return { redirect: null, value: await p };
  } catch (e) {
    const d = (e as { digest?: string }).digest;
    if (!d?.startsWith("NEXT_REDIRECT;")) throw e;
    redirects.push(d.slice("NEXT_REDIRECT;".length));
    return { redirect: d.slice("NEXT_REDIRECT;".length), value: null };
  }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    f.set(k, v);
    if (k.includes("password") && v) used.add(v);
  }
  return f;
};

/** A profile on this site (its own password, never sent to TestMu AI). */
async function register(who: string) {
  m.jar.clear();
  used.add(pw(`${who}-site`));
  const r = await m.flow.submitProfile({ name: `QA ${who}`, email: email(who), linkedin: `linkedin.com/in/qa-${who.replace(/\W/g, "-")}`, x: "@qa_user", password: pw(`${who}-site`) }, null);
  assert.equal(r.kind, "ok");
  return r.kind === "ok" ? r.memberId : 0;
}

const member = async (id: number) => (await m.auth.getMemberById(id))!;
const acting = async (id: number) => {
  const mem = await member(id);
  return { member: mem, actor: m.auth.memberActor(mem) };
};

async function signInAs(id: number) {
  m.jar.clear();
  await m.session.setMemberSession({ memberId: id, personal: true });
}

/** Step 2 for `id` with its TestMu AI password: claimPlan, which holds the team sync hook. */
async function claim(id: number, password = pw(`tm-${id}`)) {
  used.add(password);
  return m.act.claimPlan(await member(id), password);
}

/** Captain `cap` creates a team, each of `others` joins with a code, and the captain confirms (locks) it unless told not to. */
async function teamOf(cap: number, others: number[], name: string, lock = true) {
  const t = await m.teams.createTeam(await acting(cap), { name: `${tag} ${name}` });
  for (const id of others) {
    const inv = await m.teams.createInvite(await acting(cap), t.teamId, { hours: 24 });
    await m.teams.joinTeam(await acting(id), { code: inv.code, confirm: "on" });
  }
  if (lock) await m.teams.confirmFinalTeam(await acting(cap), t.teamId);
  return t;
}

/** Steps 1 and 3 done, so a successful claim would finish activation and redirect to /setup. */
async function stepsOneAndThreeDone(id: number) {
  const mem = await member(id);
  await m.act.setTick(mem, "testmu_signup", true);
  await m.db.query("insert into codex_credit_codes (code, status, assigned_member_id, assigned_at) values ($1, 'assigned', $2, now())", [`${tag.toUpperCase()}-CDX-${id}`, id]);
  await m.act.setTick(mem, "codex_credits", true);
}

const invites = () => (mock.state.calls as { path: string; body: Record<string, string> }[]).filter((c) => c.path === mock.INVITE).map((c) => c.body);
const codes = async (teamId: number) => Object.fromEntries((await m.teams.getRoster(teamId)).length ? (await m.sync.teamSyncStatus(teamId)).map((s) => [s.member_id, s.code]) : []);
const orgOf = (who: string) => mock.state.accounts.get(email(who))?.org;

test("the captain's claim invites each teammate once with the same password, and later claims join the team", { skip }, async () => {
  const [cap, ann, ben, dan] = [await register("cap1"), await register("ann"), await register("ben"), await register("dan")];
  const t = await teamOf(cap, [ann, ben, dan], "Sync One");
  // Ann and Dan claim first, each into their own org. A non-captain's claim invites nobody.
  const n0 = invites().length;
  assert.equal((await claim(ann)).outcome, "claimed");
  assert.equal((await claim(dan)).outcome, "claimed");
  assert.equal(invites().length, n0, "a non-captain makes no invite calls");
  mock.force({ api: "invite", email: email("dan"), status: 429, retry_after: 1 });
  const started = Date.now();
  const r = await claim(cap, pw("cap1-tm"));
  assert.equal(r.outcome, "claimed");
  assert.ok(Date.now() - started >= 1000, "waited out Retry-After: 1");
  assert.deepEqual(
    invites().slice(n0),
    [email("ann"), email("ben"), email("dan"), email("dan")].map((member_email) => ({ email: email("cap1"), password: pw("cap1-tm"), member_email })),
  );
  assert.deepEqual(await codes(t.teamId), { [ann]: "MEMBER_ADDED", [ben]: "MEMBER_INVITED", [dan]: "MEMBER_ADDED" });
  assert.equal(orgOf("ann"), orgOf("cap1"));
  assert.equal(orgOf("dan"), orgOf("cap1"));
  assert.equal(await m.sync.teamInvitesPending(await member(cap)), false);
  // Ben claims later and lands in the captain's org (JOINED_TEAM is a claim in #5's mapping).
  const n1 = invites().length;
  assert.equal((await claim(ben)).outcome, "claimed");
  assert.equal(orgOf("ben"), orgOf("cap1"));
  assert.equal(invites().length, n1);
  // Claiming again never calls TestMu AI.
  assert.equal((await claim(cap, pw("cap1-tm"))).outcome, "claimed");
  assert.equal(invites().length, n1);
});

test("a sync failure never blocks the claim, keeps the captain on /activate, and the retry skips teammates already in", { skip }, async () => {
  const [cap, fay, gus, hal] = [await register("cap2"), await register("fay"), await register("gus"), await register("hal")];
  const t = await teamOf(cap, [fay, gus, hal], "Sync Two");
  await claim(fay);
  await claim(hal);
  // Gus has a TestMu AI account but never joined Hack Day there.
  mock.addAccount({ email: email("gus"), password: pw(`tm-${gus}`) });
  mock.force({ api: "invite", email: email("hal"), status: 429, retry_after: 60 });
  await stepsOneAndThreeDone(cap);
  await signInAs(cap);
  const n0 = invites().length;
  const out = await outcome(m.actions.claimPlanAction(form({ password: pw("cap2-tm") })));
  assert.equal(out.redirect, null, "stays on /activate while invites need attention");
  assert.equal(out.value?.ok, true);
  assert.equal(out.value?.outcome, "claimed");
  const view = await m.act.getActivationView(cap);
  assert.ok(view.done, "the claim and step 3 are untouched by the failed sync");
  assert.deepEqual(await codes(t.teamId), { [fay]: "MEMBER_ADDED", [gus]: "NOT_HACK_DAY_ORG", [hal]: "RATE_LIMITED" });
  assert.deepEqual(invites().slice(n0).map((b) => b.member_email), [email("fay"), email("gus"), email("hal")], "the long Retry-After stops the sync instead of waiting");
  assert.equal(await m.sync.teamInvitesPending(await member(cap)), true);
  const [lk] = await m.db.query<{ state: string }>("select state from teams where id = $1", [t.teamId]);
  assert.equal(lk.state, "roster_locked");
  // Gus activates, then the captain retries: only Gus and Hal are called.
  assert.equal((await claim(gus)).outcome, "claimed");
  await signInAs(cap);
  const n1 = invites().length;
  const retry = await outcome(m.actions.retryTeamInvitesAction(form({ password: pw("cap2-tm") })));
  assert.deepEqual(retry.value, { ok: true });
  assert.deepEqual(invites().slice(n1).map((b) => b.member_email), [email("gus"), email("hal")]);
  assert.deepEqual(await codes(t.teamId), { [fay]: "MEMBER_ADDED", [gus]: "MEMBER_ADDED", [hal]: "MEMBER_ADDED" });
  // Nothing left: a claim press now goes straight on to /setup, with no call.
  assert.equal(await m.sync.teamInvitesPending(await member(cap)), false);
  const n2 = invites().length;
  assert.equal((await outcome(m.actions.claimPlanAction(form({ password: pw("cap2-tm") })))).redirect, "/setup");
  assert.equal(invites().length, n2);
});

test("an unlocked team isn't synced at the claim, a wrong password stops at the first call, and only the captain can retry", { skip }, async () => {
  const [cap, ivy, jon] = [await register("cap3"), await register("ivy"), await register("jon")];
  const t = await teamOf(cap, [ivy, jon], "Sync Three", false);
  await claim(ivy);
  await claim(jon);
  const n0 = invites().length;
  assert.equal((await claim(cap, pw("cap3-tm"))).outcome, "claimed");
  assert.equal(invites().length, n0, "no sync before the roster is final");
  await m.teams.confirmFinalTeam(await acting(cap), t.teamId);
  assert.deepEqual(await codes(t.teamId), { [ivy]: null, [jon]: null });
  await signInAs(cap);
  const typo = await outcome(m.actions.retryTeamInvitesAction(form({ password: pw("cap3-typo") })));
  assert.equal(typo.value?.ok, false);
  assert.equal(invites().length, n0 + 1, "stops after the first INVALID_CREDENTIALS");
  assert.deepEqual(await codes(t.teamId), { [ivy]: "INVALID_CREDENTIALS", [jon]: null });
  await signInAs(ivy);
  const notCaptain = await outcome(m.actions.retryTeamInvitesAction(form({ password: pw(`tm-${ivy}`) })));
  assert.deepEqual(notCaptain.value, { ok: false, message: "Only the team captain can do that." });
  await signInAs(cap);
  const short = await outcome(m.actions.retryTeamInvitesAction(form({ password: "short" })));
  assert.equal(short.value?.ok, false);
  assert.equal(invites().length, n0 + 1, "no calls for a non-captain or a short password");
  assert.deepEqual((await outcome(m.actions.retryTeamInvitesAction(form({ password: pw("cap3-tm") })))).value, { ok: true });
  assert.deepEqual(await codes(t.teamId), { [ivy]: "MEMBER_ADDED", [jon]: "MEMBER_ADDED" });
});

test("NOT_TEAM_LEAD and an unreachable invite API leave the claim claimed", { skip }, async () => {
  const [cap, kai] = [await register("cap4"), await register("kai")];
  const t = await teamOf(cap, [kai], "Sync Four");
  mock.force({ api: "invite", email: email("kai"), status: 403, body: { code: "NOT_TEAM_LEAD", message: "Only the admin of a Hack Day 2026 account can add team members." } });
  assert.equal((await claim(cap)).outcome, "claimed");
  const [s] = await m.sync.teamSyncStatus(t.teamId);
  assert.equal(s.code, "NOT_TEAM_LEAD");
  const [cap5, lee] = [await register("cap5"), await register("lee")];
  const t5 = await teamOf(cap5, [lee], "Sync Five");
  const url = process.env.TESTMU_TEAM_INVITE_URL;
  process.env.TESTMU_TEAM_INVITE_URL = "http://127.0.0.1:9/api/trials/hack-day/team/invite";
  try {
    assert.equal((await claim(cap5)).outcome, "claimed");
  } finally {
    process.env.TESTMU_TEAM_INVITE_URL = url;
  }
  assert.equal((await m.sync.teamSyncStatus(t5.teamId))[0].code, "UNAVAILABLE");
  assert.ok((await m.act.getActivationView(cap5)).ticks.has("testmu_plan"));
});

test("a solo team makes no calls, and outside production with no invite URL the stub answers", { skip }, async () => {
  const solo = await register("solo");
  const st = await m.teams.createTeam(await acting(solo), { name: `${tag} Solo`, solo: "on" });
  await m.teams.confirmFinalTeam(await acting(solo), st.teamId);
  const n0 = invites().length;
  assert.equal((await claim(solo)).outcome, "claimed");
  assert.equal(invites().length, n0);
  assert.deepEqual(await m.sync.teamSyncStatus(st.teamId), []);
  // The stub: a +testmu-<code> email picks the answer, and nothing reaches the mock.
  const [cap, mo] = [await register("cap6"), await register("mo+testmu-team-full")];
  const t = await teamOf(cap, [mo], "Sync Six");
  const url = process.env.TESTMU_TEAM_INVITE_URL;
  delete process.env.TESTMU_TEAM_INVITE_URL;
  try {
    assert.equal((await claim(cap)).outcome, "claimed");
  } finally {
    process.env.TESTMU_TEAM_INVITE_URL = url;
  }
  assert.equal(invites().length, n0);
  assert.equal((await m.sync.teamSyncStatus(t.teamId))[0].code, "TEAM_FULL");
  // A stub's done answer, written by a preview on the shared database, never counts in production.
  const [cap7, mo7] = [await register("cap7"), await register("mo7")];
  const t7 = await teamOf(cap7, [mo7], "Sync Seven");
  delete process.env.TESTMU_TEAM_INVITE_URL;
  try {
    assert.equal((await claim(cap7)).outcome, "claimed");
  } finally {
    process.env.TESTMU_TEAM_INVITE_URL = url;
  }
  assert.equal((await m.sync.teamSyncStatus(t7.teamId))[0].done, true);
  process.env.HACKOS_ENV = "production";
  try {
    const [s] = await m.sync.teamSyncStatus(t7.teamId);
    assert.equal(s.code, null);
    assert.equal(s.done, false);
  } finally {
    delete process.env.HACKOS_ENV;
  }
});

test("no password is in any table, the audit log or a redirect", { skip }, async () => {
  assert.ok(used.size >= 25, `checked ${used.size} passwords`);
  const tables = await m.db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
  assert.ok(tables.some((t) => t.table_name === "audit_events") && tables.some((t) => t.table_name === "testmu_team_sync"));
  const hits: string[] = [];
  for (const { table_name } of tables) {
    const [row] = await m.db.query<{ n: number }>(`select count(*)::int as n from "${table_name}" x where x::text like any($1::text[])`, [[...used].map((p) => `%${p}%`)]);
    if (row.n) hits.push(`${table_name}: ${row.n}`);
  }
  assert.deepEqual(hits, []);
  const [sync] = await m.db.query<{ n: number }>("select count(*)::int as n from audit_events where action = 'testmu.team_sync' and payload->>'trigger' is not null");
  assert.ok(sync.n >= 6, "the sync audit rows were among those checked");
  // The passwords did reach TestMu AI (the mock), and only in the password field.
  const bodies = (mock.state.calls as { body: Record<string, string> }[]).map((c) => c.body);
  assert.ok(bodies.some((b) => b.password === pw("cap1-tm")));
  for (const b of bodies) for (const [k, v] of Object.entries(b)) if (k !== "password") assert.ok(![...used].some((p) => String(v).includes(p)), k);
  for (const r of redirects) assert.ok(![...used].some((p) => r.includes(p)), r);
  for (const v of m.jar.values()) assert.ok(![...used].some((p) => v.includes(p)));
});
