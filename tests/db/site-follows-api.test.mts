// The site and the API told people different things: the Codex status never asked the captain
// to lock the team (the site does, before activation), /setup held the Idea tab back until a Kane
// run existed (the API puts the idea first), and the live "Passports active" tile only counted
// the old activation ceremony. Tracks are Web App, Mobile App and Other everywhere.
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
  act: typeof import("../../src/server/event-activation.ts");
  pairing: typeof import("../../src/server/pairing.ts");
  metrics: typeof import("../../src/server/metrics.ts");
  register: typeof import("../../src/app/api/v1/auth/register/route.ts");
  flow: typeof import("../../src/app/api/v1/me/flow/route.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `sf${Date.now().toString(36)}p${process.pid.toString(36)}`;
const PW = `pw-${tag}-site`;

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  for (const k of ["HACKOS_ENV", "VERCEL_ENV", "TESTMU_TRIAL_CLAIM_URL", "TESTMU_TEAM_INVITE_URL", "TESTMU_CLAIM_STUB"]) delete process.env[k];
  const [db, auth, teams, A, act, pairing, metrics, register, flow, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/server/auth.ts"),
    import("../../src/server/teams.ts"),
    import("../../src/server/mcp-adapters.ts"),
    import("../../src/server/event-activation.ts"),
    import("../../src/server/pairing.ts"),
    import("../../src/server/metrics.ts"),
    import("../../src/app/api/v1/auth/register/route.ts"),
    import("../../src/app/api/v1/me/flow/route.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, auth, teams, A, act, pairing, metrics, register, flow, jar: headers.jar };
  await db.query("update hack_events set team_lock_at = greatest(team_lock_at, now() + interval '2 days') where id = current_event_id()");
});

after(async () => {
  if (skip || !m) return;
  await m.db.query(`delete from teams where id in (select team_id from members where email like '${tag}.%')`).catch(() => {});
  await m.db.pool.end().catch(() => {});
});

/** A new participant, signed in on the web (the register route sets the session cookie). */
async function newMember(n: string) {
  m.jar.clear();
  const res = await m.register.POST(
    new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Site ${n}`, email: `${tag}.${n}@example.test`, linkedin: `site-${n}`, x: `@site${n}`, password: PW }) }),
  );
  const env = (await res.json()) as { data: { member_id: number } };
  assert.equal(res.status, 200, JSON.stringify(env));
  return (await m.auth.getMemberById(env.data.member_id))!;
}
const who = (me: Awaited<ReturnType<typeof newMember>>) => ({ member: me, actor: m.auth.memberActor(me) });
const reload = async (id: number) => (await m.auth.getMemberById(id))!;

test("participant_get_status asks the captain to lock the team before activation, like /team does", { skip }, async () => {
  let me = await newMember("lock");
  const t = await m.teams.createTeam(who(me), { name: `${tag} Lock` });
  me = await reload(me.id);
  assert.equal((await m.A.participantStatus(me)).next_action.id, "lock_team");
  await m.teams.confirmFinalTeam(who(me), t.teamId);
  assert.equal((await m.A.participantStatus(me)).next_action.id, "activate");
});

test("/api/v1/me/flow: setup is done once a machine is signed in; the idea comes before any Kane run", { skip }, async () => {
  const me = await newMember("setup");
  let j = (await (await m.flow.GET()).json()) as { setupDone?: boolean };
  assert.equal(j.setupDone, false);
  await m.pairing.issueBearerToken(me.id, "test", "password");
  j = (await (await m.flow.GET()).json()) as { setupDone?: boolean };
  assert.equal(j.setupDone, true, "no Kane run needed");
});

test("the live 'Passports active' metric counts the three-step activation", { skip }, async () => {
  const count = async () => {
    await m.metrics.projectLive();
    const [r] = await m.db.query<{ value: string }>("select value from live_metrics where event_id = current_event_id() and name = 'participants_activated'");
    return Number(r?.value ?? 0);
  };
  let me = await newMember("act");
  await m.teams.createTeam(who(me), { name: `${tag} Act` });
  me = await reload(me.id);
  const before = await count();
  assert.equal((await m.act.claimPlan(me, PW)).outcome, "claimed");
  await m.act.setTick(me, "codex_credits", true);
  assert.ok((await reload(me.id)).activated_at, "all three steps stamp activated_at");
  assert.equal(await count(), before + 1);
});

test("tracks: a team made without one is Other, and old track names are stored as Other", { skip }, async () => {
  const a = await newMember("trk1");
  const t1 = await m.teams.createTeam(who(a), { name: `${tag} Trk1` });
  const b = await newMember("trk2");
  const t2 = await m.teams.createTeam(who(b), { name: `${tag} Trk2`, track: "Wildcard" });
  const rows = await m.db.query<{ id: number; track: string }>("select id, track from teams where id = any($1)", [[t1.teamId, t2.teamId]]);
  assert.deepEqual(rows.map((r) => r.track), ["Other", "Other"]);
});
