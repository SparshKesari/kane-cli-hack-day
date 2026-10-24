// Team create / invite / join / readback against a *throwaway* database (same guard as tier0):
//   - create: explicit confirmation, one team per person, taken / project / ship-redirect slugs, empty slug, solo, idempotency
//   - invites: members only, 1 to 72 hours, dead codes all read NOT_FOUND, for_code, TEAM_FULL at the cap, revoke rights
//   - join: the 5th member gets TEAM_FULL with nothing left behind, switching teams, solo to formed, replays
//   - join race: parallel transactions for the last seat let exactly one in
//   - after the team lock time: rosters stay open (invite, join, leave) and activation opens
//   - GET /api/v1/teams/{id|slug}: members get the roster, others the public subset
//
// Lock times come from a QA hack_events row that current_event_id() points at in this process only.
//
//   QA_DATABASE_URL=postgres://…throwaway… npm run test:db
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  teams: typeof import("../../src/server/teams.ts");
  tools: typeof import("../../src/server/team-tools.ts");
  auth: typeof import("../../src/server/auth.ts");
  session: typeof import("../../src/lib/session.ts");
  route: typeof import("../../src/app/api/v1/teams/[id]/route.ts");
  showcase: typeof import("../../src/server/showcase.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `qa${Date.now().toString(36)}p${process.pid.toString(36)}`;
const schema = `qa_teams_${tag}`;
let eventId = 0;
let staffId = 0;
let pg: typeof import("pg").default;

before(async () => {
  if (skip) return;
  pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: QA });
  await c.connect();
  try {
    const { rows } = await c.query<{ id: number }>(
      `insert into hack_events (slug, name, starts_at, team_lock_at, idea_lock_at, submission_locks_at, demos_start_at)
       values ($1, 'QA teams', now(), now() + interval '2 days', now() + interval '2 days', now() + interval '2 days', now() + interval '2 days') returning id`,
      [`${tag}-event`],
    );
    eventId = Number(rows[0].id);
    await c.query(`create schema ${schema}`);
    await c.query(`create function ${schema}.current_event_id() returns bigint language sql stable as $$ select ${eventId}::bigint $$`);
  } finally {
    await c.end();
  }
  // Every connection this process opens resolves current_event_id() to the QA event first.
  const url = new URL(QA!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  const [db, teams, tools, auth, session, route, showcase, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/server/teams.ts"),
    import("../../src/server/team-tools.ts"),
    import("../../src/server/auth.ts"),
    import("../../src/lib/session.ts"),
    import("../../src/app/api/v1/teams/[id]/route.ts"),
    import("../../src/server/showcase.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, teams, tools, auth, session, route, showcase, jar: headers.jar };
  const [s] = await db.query<{ id: number }>("insert into staff_accounts (email, name, role, active) values ($1, 'QA organizer', 'organizer', true) returning id", [email("org")]);
  staffId = s.id;
});

after(async () => {
  if (skip || !m) return;
  const members = `(select id from members where email like '${tag}.%')`;
  await m.db.query(`delete from teams where event_id = $1 or id in (select team_id from team_memberships where member_id in ${members})`, [eventId]).catch(() => {});
  await m.db.query(`delete from members where email like '${tag}.%'`).catch(() => {});
  await m.db.query("delete from staff_accounts where id = $1", [staffId]).catch(() => {});
  await m.db.query("delete from hack_events where id = $1", [eventId]).catch(() => {});
  await m.db.query(`drop schema if exists ${schema} cascade`).catch(() => {});
  await m.db.pool.end();
});

test("create: explicit confirmation, one team per person, taken and empty slugs, solo", { skip }, async () => {
  const a = await person("a");
  for (const input of [{ name: `${tag} Alpha` }, { name: `${tag} Alpha`, explicit_confirmation: "true" }]) {
    assert.equal((await m.tools.teamCreateTool(a, input)).status, "needs_action");
  }
  assert.equal(await teamsWithSlug(`${tag}-alpha`), 0, "nothing created without confirmation");
  const made = await m.tools.teamCreateTool(a, { name: `${tag} Alpha`, explicit_confirmation: true });
  const alpha = made.data as { team_id: number; slug: string; state: string };
  await adopt(alpha.team_id);
  assert.equal(alpha.state, "recruiting");
  assert.equal(alpha.slug, `${tag}-alpha`);

  await rejectsWith(m.teams.createTeam(await who(a), { name: `${tag} Another` }), "CONFLICT");
  const b = await person("b");
  await rejectsWith(m.teams.createTeam(b, { name: `${tag} ALPHA!` }), "CONFLICT");
  // An organizer renames Alpha's ship page twice: its project slug and the middle redirect slug belong to no team.
  const organizer = { id: staffId, name: "QA organizer", email: null, role: "organizer" as const };
  await m.showcase.renameShipSlug(organizer, { slug: `${tag}-alpha`, new_slug: `${tag}-beta` });
  await m.showcase.renameShipSlug(organizer, { slug: `${tag}-beta`, new_slug: `${tag}-gamma` });
  await rejectsWith(m.teams.createTeam(b, { name: `${tag} Gamma` }), "CONFLICT");
  await rejectsWith(m.teams.createTeam(b, { name: `${tag} Beta` }), "CONFLICT");
  const pair = [String((await person("pool-1")).member.id), String((await person("pool-2")).member.id)];
  await rejectsWith(m.teams.formTeamFromPool(organizer, { member_ids: pair, name: `${tag} Beta`, track: "Wildcard" }), "CONFLICT");
  assert.deepEqual(await m.showcase.resolveShipSlug(`${tag}-beta`), { redirectTo: `${tag}-gamma` });
  for (const name of ["!!! ???", "日本語"]) await rejectsWith(m.teams.createTeam(b, { name }), "VALIDATION_FAILED");
  assert.equal((await currentMemberships(b.member.id)).length, 0, "refusals leave no membership");

  const solo = await create(b, { name: `${tag} Solo`, solo: "on", recruiting_open: "on" });
  const info = (await m.teams.getTeamInfo({ id: solo.teamId }))!;
  assert.equal(solo.state, "formed");
  assert.deepEqual([info.is_solo, info.recruiting_open, info.member_count, info.captain_id], [true, false, 1, b.member.id]);
});

test("create: the same idempotency_key returns the same receipt and makes one team", { skip }, async () => {
  const e = await person("e");
  const body = { name: `${tag} Echo`, idempotency_key: `${tag}-echo-key` };
  const first = await m.teams.createTeam(e, body);
  const again = await m.teams.createTeam(await who(e), body);
  assert.deepEqual(again, first);
  assert.equal(await teamsWithSlug(`${tag}-echo`), 1);
  await adopt(first.teamId);
  // Two retries in flight at once: never a second team.
  const f = await person("f");
  const both = await Promise.allSettled([0, 1].map(() => m.teams.createTeam(f, { name: `${tag} Foxtrot`, idempotency_key: `${tag}-fox-key` })));
  const ok = both.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ teamId: number }>[];
  assert.ok(ok.length >= 1);
  assert.ok(both.every((r) => r.status === "fulfilled" || errCode(r.reason) === "CONFLICT"));
  assert.equal(new Set(ok.map((r) => r.value.teamId)).size, 1);
  assert.equal(await teamsWithSlug(`${tag}-foxtrot`), 1);
  await adopt(ok[0].value.teamId);
});

test("invites: members only, 1 to 72 hours, dead codes read the same, for_code, revoke rights", { skip }, async () => {
  const cap = await person("inv-cap");
  const team = await create(cap, { name: `${tag} Invites` });
  const outsider = await person("inv-out");
  await rejectsWith(m.teams.createInvite(outsider, team.teamId, {}), "FORBIDDEN");
  for (const hours of [0, 73, 1.5, "abc", -1, ""]) await rejectsWith(m.teams.createInvite(cap, team.teamId, { hours }), "VALIDATION_FAILED");
  const lifetime = async (hours?: number | string) => {
    const inv = await m.teams.createInvite(cap, team.teamId, hours === undefined ? {} : { hours });
    return { inv, hours: Math.round((Date.parse(inv.expiresAt) - Date.parse(inv.receipt.server_time)) / 3_600_000) };
  };
  const d24 = await lifetime();
  assert.equal(d24.hours, 24);
  assert.equal((await lifetime(1)).hours, 1);
  assert.equal((await lifetime("72")).hours, 72);

  // Expired, used, revoked and unknown codes give the same NOT_FOUND, in join and in preview.
  const expired = await m.teams.createInvite(cap, team.teamId, {});
  await m.db.query("update invitations set expires_at = now() - interval '1 second' where id = $1", [expired.inviteId]);
  const mate = await person("inv-mate");
  await join(mate, d24.inv.code);
  const revoked = await m.teams.createInvite(cap, team.teamId, {});
  await m.teams.revokeInvite(cap, team.teamId, revoked.inviteId);
  const late = await person("inv-late");
  const messages = new Set<string>();
  for (const code of [expired.code, d24.inv.code, revoked.code, "ZZZZ-ZZZZ"]) {
    await assert.rejects(join(late, code), (e: { code?: string; userMessage?: string }) => {
      messages.add(e.userMessage ?? "");
      return e.code === "NOT_FOUND";
    });
    assert.equal(await m.teams.previewInvite(code, late.member), null);
  }
  assert.equal(messages.size, 1, "one message for every dead code");
  assert.equal((await currentMemberships(late.member.id)).length, 0);

  // for_code: only the P-code holder may use it, and a refusal doesn't burn it.
  const holder = await person("inv-holder");
  const personal = await m.teams.createInvite(cap, team.teamId, { for_code: holder.member.public_code!.toLowerCase() });
  await rejectsWith(join(late, personal.code), "FORBIDDEN");
  assert.equal(await accepted(personal.inviteId), false);
  await join(holder, personal.code);
  await rejectsWith(m.teams.createInvite(cap, team.teamId, { for_code: "P-12" }), "VALIDATION_FAILED");
  await rejectsWith(m.teams.createInvite(cap, team.teamId, { for_code: "P-999999" }), "NOT_FOUND");

  // Revoke: the captain any open invite, the creator their own, nobody else.
  const mates = await who(mate);
  const byMate = await m.teams.createInvite(mates, team.teamId, {});
  await rejectsWith(m.teams.revokeInvite(await who(holder), team.teamId, byMate.inviteId), "NOT_FOUND");
  await rejectsWith(m.teams.revokeInvite(outsider, team.teamId, byMate.inviteId), "FORBIDDEN");
  await m.teams.revokeInvite(mates, team.teamId, byMate.inviteId);
  const byMate2 = await m.teams.createInvite(mates, team.teamId, {});
  await m.teams.revokeInvite(await who(cap), team.teamId, byMate2.inviteId);
  await rejectsWith(m.teams.revokeInvite(await who(cap), team.teamId, byMate2.inviteId), "NOT_FOUND");
  // Someone who left can't invite any more.
  await m.teams.leaveTeam(await who(holder));
  await rejectsWith(m.teams.createInvite(await who(holder), team.teamId, {}), "FORBIDDEN");
});

test("join: the 5th member gets TEAM_FULL with nothing left behind, and a full team can't invite", { skip }, async () => {
  const cap = await person("full-cap");
  const team = await create(cap, { name: `${tag} Full`, recruiting_open: "on" });
  const codes = await Promise.all([0, 1, 2, 3].map(async () => (await m.teams.createInvite(cap, team.teamId, {})).code));
  for (const n of [1, 2, 3]) await join(await person(`full-${n}`), codes[n - 1]);
  const info = (await m.teams.getTeamInfo({ id: team.teamId }))!;
  assert.deepEqual([info.member_count, info.cap, info.state, info.recruiting_open], [4, 4, "formed", false]);
  await rejectsWith(m.teams.createInvite(await who(cap), team.teamId, {}), "TEAM_FULL");

  // The fifth person was on a solo team: refused, still there, the code still unused.
  const fifth = await person("full-5");
  const own = await create(fifth, { name: `${tag} Fifth Solo`, solo: "on" });
  await rejectsWith(join(fifth, codes[3]), "TEAM_FULL");
  assert.deepEqual((await currentMemberships(fifth.member.id)).map((r) => r.team_id), [own.teamId]);
  assert.equal((await m.auth.getMemberById(fifth.member.id))!.team_id, own.teamId);
  const [inv] = await m.db.query<{ accepted_at: Date | null }>("select accepted_at from invitations where team_id = $1 and accepted_at is null", [team.teamId]);
  assert.ok(inv, "the unused code is still open");
  assert.equal((await m.teams.getTeamInfo({ id: team.teamId }))!.member_count, 4);
});

test("join: switching teams closes the old membership, a solo team becomes formed and not solo", { skip }, async () => {
  const soloCap = await person("sw-solo");
  const solo = await create(soloCap, { name: `${tag} Switch Solo`, solo: "on" });
  const otherCap = await person("sw-other");
  const other = await create(otherCap, { name: `${tag} Switch Other` });
  const mover = await person("sw-mover");
  await join(mover, (await m.teams.createInvite(otherCap, other.teamId, {})).code);

  const moved = await join(await who(mover), (await m.teams.createInvite(await who(soloCap), solo.teamId, {})).code);
  assert.equal(moved.leftTeam, `${tag} Switch Other`);
  const rows = await m.db.query<{ team_id: number; left_at: Date | null; left_reason: string | null }>(
    "select team_id, left_at, left_reason from team_memberships where member_id = $1 order by id",
    [mover.member.id],
  );
  assert.deepEqual(rows.map((r) => [r.team_id, r.left_at !== null, r.left_reason]), [[other.teamId, true, "switched team"], [solo.teamId, false, null]]);
  assert.equal((await m.auth.getMemberById(mover.member.id))!.team_id, solo.teamId);
  const s = (await m.teams.getTeamInfo({ id: solo.teamId }))!;
  assert.deepEqual([s.state, s.is_solo, s.member_count], ["formed", false, 2]);
  assert.equal((await m.teams.getTeamInfo({ id: other.teamId }))!.member_count, 1);

  // A captain with teammates can't switch away, and joining your own team is refused.
  await rejectsWith(join(await who(soloCap), (await m.teams.createInvite(await who(otherCap), other.teamId, {})).code), "CONFLICT");
  await rejectsWith(join(await who(mover), (await m.teams.createInvite(await who(soloCap), solo.teamId, {})).code), "CONFLICT");
});

test("join: parallel transactions racing for the last seat let exactly one in", { skip }, async () => {
  const cap = await person("race-cap");
  const team = await create(cap, { name: `${tag} Race` });
  for (const n of [1, 2]) await join(await person(`race-${n}`), (await m.teams.createInvite(cap, team.teamId, {})).code);
  const [x, y] = [await person("race-x"), await person("race-y")];
  const [cx, cy] = [(await m.teams.createInvite(cap, team.teamId, {})).code, (await m.teams.createInvite(cap, team.teamId, {})).code];

  // Hold the team row so both joins are inside their transactions and waiting at once, then let go.
  const holder = await holdTeamRow(team.teamId);
  const racing = Promise.allSettled([join(x, cx), join(y, cy)]);
  await waitForLockWaiters(2);
  await holder.query("commit");
  await holder.end();
  const results = await racing;
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(errCode(lost.reason), "TEAM_FULL");
  assert.equal((await m.teams.getTeamInfo({ id: team.teamId }))!.member_count, 4);
  const loser = results[0].status === "rejected" ? x : y;
  assert.equal((await currentMemberships(loser.member.id)).length, 0, "the loser has no membership");

  // A wider burst: six people, six codes, three seats.
  const cap2 = await person("burst-cap");
  const t2 = await create(cap2, { name: `${tag} Burst` });
  const crowd = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => person(`burst-${n}`)));
  const crowdCodes: string[] = [];
  for (let i = 0; i < crowd.length; i++) crowdCodes.push((await m.teams.createInvite(cap2, t2.teamId, {})).code);
  const burst = await Promise.allSettled(crowd.map((p, i) => join(p, crowdCodes[i])));
  assert.equal(burst.filter((r) => r.status === "fulfilled").length, 3);
  assert.ok(burst.filter((r) => r.status === "rejected").every((r) => errCode((r as PromiseRejectedResult).reason) === "TEAM_FULL"));
  assert.equal((await m.teams.getTeamInfo({ id: t2.teamId }))!.member_count, 4);

  // Two people with the same code: one joins, the other finds it used.
  const cap3 = await person("same-cap");
  const t3 = await create(cap3, { name: `${tag} Same Code` });
  const shared = (await m.teams.createInvite(cap3, t3.teamId, {})).code;
  const same = await Promise.allSettled([join(await person("same-1"), shared), join(await person("same-2"), shared)]);
  assert.equal(same.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(errCode((same.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), "NOT_FOUND");
});

test("join: a replayed idempotency key returns the same result", { skip }, async () => {
  const cap = await person("idem-cap");
  const team = await create(cap, { name: `${tag} Replay` });
  const joiner = await person("idem-joiner");
  const code = (await m.teams.createInvite(cap, team.teamId, {})).code;
  const body = { code, confirm: "on", idempotency_key: `${tag}-join-key` };
  const first = await m.teams.joinTeam(joiner, body);
  const again = await m.teams.joinTeam(await who(joiner), body);
  assert.deepEqual(again, first);
  await rejectsWith(m.teams.joinTeam(await who(joiner), { ...body, idempotency_key: `${tag}-join-key-2` }), "NOT_FOUND");
  assert.equal((await currentMemberships(joiner.member.id)).length, 1);
  assert.equal((await m.teams.getTeamInfo({ id: team.teamId }))!.member_count, 2);
});

test("GET /api/v1/teams/{id|slug}: members get the roster, others the public subset, unknown is NOT_FOUND", { skip }, async () => {
  const cap = await person("read-cap");
  const team = await create(cap, { name: `${tag} Readback`, summary_public: "We test things", recruiting_open: "on" });
  const mate = await person("read-mate");
  await join(mate, (await m.teams.createInvite(cap, team.teamId, {})).code);
  const stranger = await person("read-stranger");

  await signIn(mate.member.id);
  for (const id of [String(team.teamId), team.slug]) {
    const r = await readback(id);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.view, "member");
    assert.equal(r.body.data.team.id, team.teamId);
    assert.equal(r.body.data.team.captain_id, cap.member.id);
    assert.deepEqual(r.body.data.roster.map((x: { member_id: number; role: string }) => [x.member_id, x.role]), [[cap.member.id, "captain"], [mate.member.id, "member"]]);
  }
  const publicKeys = ["cap", "id", "locked", "member_count", "name", "recruiting_open", "slug", "summary_public", "track"];
  await signIn(stranger.member.id);
  const outside = await readback(team.slug);
  assert.equal(outside.status, 200);
  assert.equal(outside.body.data.view, "public");
  assert.deepEqual(Object.keys(outside.body.data.team).sort(), publicKeys);
  assert.equal("roster" in outside.body.data, false);
  assert.deepEqual([outside.body.data.team.member_count, outside.body.data.team.summary_public], [2, "We test things"]);

  m.jar.clear();
  await m.session.setStaffSession(staffId, "organizer");
  assert.equal((await readback(String(team.teamId))).body.data.view, "public");

  await signIn(stranger.member.id);
  for (const id of ["999999999", `${tag}-no-such-team`]) {
    const r = await readback(id);
    assert.deepEqual([r.status, r.body.error.code], [404, "NOT_FOUND"]);
  }
  m.jar.clear();
  const anon = await readback(team.slug);
  assert.deepEqual([anon.status, anon.body.error.code], [401, "UNAUTHENTICATED"]);
});

// The team lock time no longer closes rosters (event day, 2026-10-24: people had to move between
// teams after 11:00). Passing it only opens activation; a captain's own lock still closes a roster.
test("after the team lock time: rosters stay open, and activation opens without a captain lock", { skip }, async () => {
  const cap = await person("lock-cap");
  const team = await create(cap, { name: `${tag} Lock` });
  const mate = await person("lock-mate");
  await join(mate, (await m.teams.createInvite(cap, team.teamId, {})).code);
  const joiner = await person("lock-joiner");
  const walkIn = await person("lock-walkin");

  await m.db.query("update hack_events set team_lock_at = now() - interval '1 minute' where id = $1", [eventId]);
  try {
    const lateTeam = await create(walkIn, { name: `${tag} Walk In` });
    assert.notEqual(lateTeam.state, "roster_locked");
    const late = (await m.teams.getTeamInfo({ id: lateTeam.teamId }))!;
    assert.equal(late.locked, false);
    assert.ok(late.roster_locked_at, "stamped, so the team can go straight to activation");

    await join(joiner, (await m.teams.createInvite(await who(cap), team.teamId, {})).code);
    await m.teams.leaveTeam(await who(mate));
    const info = (await m.teams.getTeamInfo({ id: team.teamId }))!;
    assert.deepEqual([info.locked, info.state, info.member_count], [false, "formed", 2]);
    assert.ok(info.roster_locked_at, "an existing team is stamped too");
  } finally {
    await m.db.query("update hack_events set team_lock_at = now() + interval '2 days' where id = $1", [eventId]);
  }
});

// ── helpers ────────────────────────────────────────────────────────────────

type Acting = import("../../src/server/teams.ts").ActingMember;

function email(s: string) {
  return `${tag}.${s}@example.test`;
}

async function person(s: string): Promise<Acting> {
  const [row] = await m.db.query<{ id: number }>("insert into members (name, email) values ($1, $2) returning id", [`QA ${s}`, email(s)]);
  return who({ member: { id: row.id } as Acting["member"], actor: { type: "member", id: row.id } });
}

/** The member as the database has them now (team_id moves as they join and leave). */
async function who(a: Acting): Promise<Acting> {
  const member = (await m.auth.getMemberById(a.member.id))!;
  return { member, actor: m.auth.memberActor(member) };
}

/** createTeam, with the team moved onto the QA event so lock tests only touch this file's teams. */
async function create(a: Acting, input: Record<string, unknown>) {
  const t = await m.teams.createTeam(await who(a), input);
  await adopt(t.teamId);
  return t;
}

async function adopt(teamId: number) {
  await m.db.query("update teams set event_id = $2 where id = $1", [teamId, eventId]);
}

async function join(a: Acting, code: string) {
  return m.teams.joinTeam(await who(a), { code, confirm: "on" });
}

const errCode = (e: unknown) => (e as { code?: string } | null)?.code;

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(errCode(e), code, `expected ${code}, got ${errCode(e)}: ${(e as Error)?.message}`);
    return true;
  });
}

async function teamsWithSlug(slug: string) {
  const [{ n }] = await m.db.query<{ n: number }>("select count(*)::int as n from teams where slug = $1", [slug]);
  return n;
}

async function currentMemberships(memberId: number) {
  return m.db.query<{ team_id: number }>("select team_id from team_memberships where member_id = $1 and left_at is null", [memberId]);
}

async function accepted(inviteId: number) {
  const [r] = await m.db.query<{ accepted_at: Date | null }>("select accepted_at from invitations where id = $1", [inviteId]);
  return r.accepted_at !== null;
}

function signIn(memberId: number) {
  m.jar.clear();
  return m.session.setMemberSession({ memberId, personal: true });
}

async function readback(id: string) {
  const res = await m.route.GET(new Request(`http://localhost/api/v1/teams/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

/** A separate connection holding the team row lock until the caller commits. */
async function holdTeamRow(teamId: number): Promise<Client> {
  const c = new pg.Client({ connectionString: QA });
  await c.connect();
  await c.query("begin");
  await c.query("select id from teams where id = $1 for update", [teamId]);
  return c;
}

async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const [{ waiting }] = await m.db.query<{ waiting: number }>(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'select id from teams where id = $1 for update%'",
    );
    if (waiting >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`fewer than ${n} joins reached the team row lock`);
}
