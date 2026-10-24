// The event-day participant flow against a *throwaway* database (same guard as tier0):
//   - /register creates a member with a personal session and links the roster guest
//   - an email that already has an account is never taken over without its
//     password or a desk code
//   - joining a team by any route takes the person out of the matchmaking pool
//   - activation ticks persist, the TestMu AI plan claim uses the member's own
//     email, is stored once, and can be retried after a failure; the password
//     goes to TestMu AI once and is never stored, nor are the credentials it returns
//   - Codex credit codes: one per member under concurrency, re-shown, empty pool
//     message, upload dedupe
//
//   QA_DATABASE_URL=postgres://…throwaway… npm run test:db
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  session: typeof import("../../src/lib/session.ts");
  flow: typeof import("../../src/server/flow.ts");
  teams: typeof import("../../src/server/teams.ts");
  act: typeof import("../../src/server/event-activation.ts");
  auth: typeof import("../../src/server/auth.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `qa${Date.now().toString(36)}`;
const email = (s: string) => `${tag}.${s}@example.test`;
const ids = { staff: 0, codes: [] as string[] };
let organizer: { id: number; name: string; email: string | null; role: "organizer" };
let server: Server;
let port = 0;
const claimBodies: { email: string; password?: string; source: string }[] = [];
let claimStatus = 200;

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  delete process.env.HACKOS_ENV;
  // A local mock of the claim API: records what we send, answers with claimStatus.
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      claimBodies.push(JSON.parse(body));
      res.writeHead(claimStatus, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          claimStatus === 200
            ? { code: "SIGNEDUP", message: "Trial activated.", user_id: 1, username: "qa", access_token: "tok-secret-live", organization_id: 7 }
            : claimStatus === 401
              ? { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." }
              : claimStatus === 404
                ? { code: "USER_NOT_FOUND" }
                : { code: "UNAVAILABLE" },
        ),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  process.env.TESTMU_TRIAL_CLAIM_URL = `http://127.0.0.1:${port}/claim`;

  const [db, session, flow, teams, act, auth, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/lib/session.ts"),
    import("../../src/server/flow.ts"),
    import("../../src/server/teams.ts"),
    import("../../src/server/event-activation.ts"),
    import("../../src/server/auth.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, session, flow, teams, act, auth, jar: headers.jar };
  const [s] = await db.query<{ id: number }>("insert into staff_accounts (email, name, role, active) values ($1, $2, 'organizer', true) returning id", [email("org"), `QA organizer ${tag}`]);
  ids.staff = s.id;
  organizer = { id: s.id, name: `QA organizer ${tag}`, email: null, role: "organizer" };
  // Keep the team lock in the future for this run.
  await db.query("update hack_events set team_lock_at = greatest(team_lock_at, now() + interval '2 days') where id = current_event_id()");
});

after(async () => {
  server?.close();
  if (skip || !m) return;
  const members = `(select id from members where email like '${tag}.%')`;
  await m.db.query(`delete from codex_credit_codes where code like '${tag.toUpperCase()}%'`).catch(() => {});
  await m.db.query(`delete from teams where id in (select team_id from team_memberships where member_id in ${members})`).catch(() => {});
  await m.db.query(`delete from roster_guests where staff_reference = '${tag}'`).catch(() => {});
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
  await m.db.query("delete from staff_accounts where id = $1", [ids.staff]).catch(() => {});
  await m.db.pool.end();
});

const signedOut = () => m.jar.clear();
const viewer = () => m.auth.getPersonalMember();
async function register(who: string, extra: Record<string, string> = {}) {
  signedOut();
  return m.flow.submitProfile({ name: `QA ${who}`, email: email(who), skills: "react, ci", interests: "agents", linkedin: `linkedin.com/in/qa-${who}`, x: "@qa_user", password: "correct-horse-1", ...extra }, null);
}
const memberByEmail = async (e: string) => (await m.db.query<import("../../src/server/auth.ts").MemberRow & { looking_for_team: boolean | null; guest_id: number | null }>("select *, 'participant' as role from members where lower(email) = lower($1)", [e]))[0];
const acting = (mem: import("../../src/server/auth.ts").MemberRow) => ({ member: mem, actor: m.auth.memberActor(mem) });

test("register creates a personal session and links the roster guest by email hash", { skip }, async () => {
  const { emailHash } = await import("../../src/server/core.ts");
  const [g] = await m.db.query<{ id: number }>(
    `insert into roster_guests (source, luma_guest_id, name, email_hash, email_hint, approval_status, admission_status, staff_reference, checked_in_at)
     values ('luma_csv', $1, 'QA Rosa', $2, 'r***', 'approved', 'admitted', $3, now()) returning id`,
    [`${tag}-rosa`, emailHash(email("rosa")), tag],
  );
  const r = await register("rosa");
  assert.equal(r.kind, "ok");
  const me = await viewer();
  assert.ok(me, "personal session set");
  const row = await memberByEmail(email("rosa"));
  assert.equal(row.guest_id, g.id);
  assert.ok(row.checked_in_at, "desk check-in carried over");
  assert.equal((await m.flow.flowState(row.id)).stage, "photo");
});

test("an existing email is never adopted without its password or a desk code", { skip }, async () => {
  await register("owner");
  const owner = await memberByEmail(email("owner"));
  // Someone else types the same email.
  const again = await register("owner", { name: "Impostor" });
  assert.deepEqual(again, { kind: "needs_proof" });
  assert.equal(await viewer(), null, "no session for the impostor");
  await assert.rejects(register("owner", { proof_password: "wrong-password-9" }), /doesn’t match/);
  assert.equal(await viewer(), null);
  assert.equal((await memberByEmail(email("owner"))).name, "QA owner", "profile untouched");
  // A desk one-time code works.
  const { issueMemberLoginCode } = await import("../../src/server/pairing.ts");
  const code = await issueMemberLoginCode(owner.id, { type: "staff", id: ids.staff, role: "organizer" });
  const ok = await register("owner", { name: "QA Owner Again", proof_code: code, password: "" });
  assert.equal(ok.kind, "ok");
  assert.equal((await viewer())?.id, owner.id);
  // And the right password too.
  const ok2 = await register("owner", { proof_password: "correct-horse-1" });
  assert.equal(ok2.kind, "ok");
});

test("joining a team by any route leaves the matchmaking pool", { skip }, async () => {
  await register("poolA");
  const a = (await viewer())!;
  await m.flow.setTeamChoice(a, true);
  await register("poolB");
  const b = (await viewer())!;
  await m.flow.setTeamChoice(b, true);
  await register("poolC");
  const c = (await viewer())!;
  await m.flow.setTeamChoice(c, true);
  const inPool = async () => (await m.flow.listPool(null)).map((p) => p.member_id);
  assert.ok((await inPool()).includes(a.id) && (await inPool()).includes(b.id));
  assert.equal((await m.flow.flowState(a.id)).stage, "pool");

  // Route 1: a creates a team.
  const team = await m.teams.createTeam(acting(a), { name: `${tag} Pool Team`, track: "Web App", recruiting_open: "on" });
  assert.equal((await memberByEmail(email("poolA"))).looking_for_team, false);
  assert.ok(!(await inPool()).includes(a.id));
  // Route 2: b joins by invite.
  const inv = await m.teams.createInvite(acting((await m.auth.getMemberById(a.id))!), team.teamId, {});
  await m.teams.joinTeam(acting(b), { code: inv.code, confirm: "on" });
  assert.equal((await memberByEmail(email("poolB"))).looking_for_team, false);
  // Route 3: asking to join a team with open seats, accepted by a teammate.
  await register("poolE");
  const e = (await viewer())!;
  await m.flow.setTeamChoice(e, true);
  const { requestIntro } = await import("../../src/server/match.ts");
  await requestIntro(acting(e), { target_team_id: String(team.teamId), message: "hi" });
  const [intro] = await m.db.query<{ id: number }>("select id from teammate_introductions where requester_id = $1", [e.id]);
  const answered = await m.flow.answerIntro(acting((await m.auth.getMemberById(a.id))!), intro.id, true);
  assert.equal(answered.joined, `QA poolE`);
  assert.equal((await memberByEmail(email("poolE"))).team_id, team.teamId);
  assert.equal((await memberByEmail(email("poolE"))).looking_for_team, false);
  // Route 3b: the team invites someone from the pool; they accept and join.
  await register("poolF");
  const f = (await viewer())!;
  await m.flow.setTeamChoice(f, true);
  const { inviteToTeam, listIntros } = await import("../../src/server/match.ts");
  await inviteToTeam(acting((await m.auth.getMemberById(a.id))!), f.id, "join us");
  await assert.rejects(inviteToTeam(acting((await m.auth.getMemberById(a.id))!), a.id, null), /That's you/);
  const [invite] = (await listIntros(f.id)).filter((i) => i.direction === "incoming");
  assert.equal(invite.from_team, `${tag} Pool Team`);
  const took = await m.flow.answerIntro(acting(f), invite.id, true);
  assert.equal(took.joinedTeam, `${tag} Pool Team`);
  assert.equal((await memberByEmail(email("poolF"))).team_id, team.teamId);
  assert.ok(!(await inPool()).includes(f.id));
  // A team without a track is Wildcard.
  await register("poolG");
  const g = (await viewer())!;
  const noTrack = await m.teams.createTeam(acting(g), { name: `${tag} No Track`, seeking_skills: "react, go" });
  const [nt] = await m.db.query<{ track: string }>("select track from teams where id = $1", [noTrack.teamId]);
  assert.equal(nt.track, "Wildcard");
  // Route 4: an organizer forms a team at the cut-off.
  await register("poolD");
  const d = (await viewer())!;
  await m.flow.setTeamChoice(d, true);
  const formed = await m.teams.formTeamFromPool(organizer, { member_ids: [String(c.id), String(d.id)], name: `${tag} Formed`, track: "Wildcard", reason: "cut-off" });
  assert.equal(formed.members.length, 2);
  assert.ok(!(await inPool()).includes(c.id) && !(await inPool()).includes(d.id));
  // Activation waits until the captain confirms the final team (which locks it).
  assert.equal((await m.flow.flowState(c.id)).stage, "team");
  const [fc] = await m.db.query<{ captain_id: number }>("select captain_id from teams where id = $1", [formed.teamId]);
  const [capId, otherId] = Number(fc.captain_id) === c.id ? [c.id, d.id] : [d.id, c.id];
  await assert.rejects(m.teams.confirmFinalTeam(acting((await m.auth.getMemberById(otherId))!), formed.teamId), /Only the team captain/);
  const pending = await m.teams.createInvite(acting((await m.auth.getMemberById(capId))!), formed.teamId, { hours: 24 });
  await m.teams.confirmFinalTeam(acting((await m.auth.getMemberById(capId))!), formed.teamId);
  await m.teams.confirmFinalTeam(acting((await m.auth.getMemberById(capId))!), formed.teamId); // twice is fine
  const [lk] = await m.db.query<{ state: string; recruiting_open: boolean; open_invites: number }>(
    "select state, recruiting_open, (select count(*)::int from invitations where team_id = $1 and revoked_at is null and accepted_at is null) as open_invites from teams where id = $1",
    [formed.teamId],
  );
  assert.deepEqual(lk, { state: "roster_locked", recruiting_open: false, open_invites: 0 });
  const note = await m.db.query<{ member_id: number }>("select member_id from member_notifications where kind = 'team_locked' and member_id = any($1::bigint[])", [[capId, otherId]]);
  assert.deepEqual(note.map((n) => Number(n.member_id)), [otherId]); // teammates told once, the captain not
  assert.ok(pending);
  assert.equal((await m.flow.flowState(c.id)).stage, "activate");
  assert.equal((await m.flow.flowState(d.id)).stage, "activate");
  // Someone already on a team can't be formed again.
  await assert.rejects(m.teams.formTeamFromPool(organizer, { member_ids: [String(c.id), String(d.id)], name: `${tag} Again`, track: "Wildcard" }), /Already on a team/);
});

test("activation ticks persist and the plan claim uses the member's own email, once", { skip }, async () => {
  await register("act");
  let me = (await viewer())!;
  await m.teams.createTeam(acting(me), { name: `${tag} Act`, track: "Web App" });
  me = (await m.auth.getMemberById(me.id))!;
  await m.act.setTick(me, "testmu_signup", true);
  assert.ok((await m.act.getActivationView(me.id)).ticks.has("testmu_signup"));
  await assert.rejects(m.act.setTick(me, "testmu_plan", true), /ticked when your plan activates/);

  // A password the API would refuse never leaves the site.
  const PW = "correct-horse-9";
  const before = claimBodies.length;
  await assert.rejects(m.act.claimPlan(me, "short"), /at least 8 characters/);
  assert.equal(claimBodies.length, before, "no call for a short password");

  // A failure is stored and can be retried.
  claimStatus = 503;
  const fail = await m.act.claimPlan(me, PW);
  assert.equal(fail.outcome, "error");
  assert.equal(claimBodies.length, before + 1);
  const sent = claimBodies.at(-1)!;
  assert.equal(sent.email, email("act"), "email comes from the member row");
  assert.equal(sent.password, PW, "the password goes to TestMu AI as typed");
  assert.equal(sent.source, "website");
  let row = (await m.db.query<{ status: string; last_error: string; http_status: number }>("select status, last_error, http_status from testmu_plan_claims where member_id = $1", [me.id]))[0];
  assert.equal(row.status, "error");
  assert.equal(row.http_status, 503);

  // A wrong password for an existing account says so.
  claimStatus = 401;
  const wrong = await m.act.claimPlan(me, PW);
  assert.equal(wrong.outcome, "error");
  assert.match(wrong.message, /password/i);

  // Not registered (the older API's answer) un-ticks step 1.
  claimStatus = 404;
  const nr = await m.act.claimPlan(me, PW);
  assert.equal(nr.outcome, "not_registered");
  assert.match(nr.message, new RegExp(email("act").replace(/\./g, "\\.")));
  assert.ok(!(await m.act.getActivationView(me.id)).ticks.has("testmu_signup"));

  // Success is stored once and ticks steps 1 and 2; a second press never calls the API again.
  claimStatus = 200;
  assert.equal((await m.act.claimPlan(me, PW)).outcome, "claimed");
  const calls = claimBodies.length;
  assert.equal((await m.act.claimPlan(me, PW)).outcome, "claimed");
  assert.equal(claimBodies.length, calls, "no second call after success");
  row = (await m.db.query<{ status: string; last_error: string; http_status: number }>("select status, last_error, http_status from testmu_plan_claims where member_id = $1", [me.id]))[0];
  assert.equal(row.status, "claimed");
  const ticks = (await m.act.getActivationView(me.id)).ticks;
  assert.ok(ticks.has("testmu_plan"), "step 2 ticked");
  assert.ok(ticks.has("testmu_signup"), "a claim also means the TestMu AI account exists");

  // Neither the password nor the returned credentials are kept anywhere.
  const kept = await m.db.query<{ t: string }>(
    "select row_to_json(c)::text as t from testmu_plan_claims c where member_id = $1 union all select row_to_json(a)::text from audit_events a where resource_type = 'testmu_plan_claim' and resource_id::text = $2",
    [me.id, String(me.id)],
  );
  assert.ok(kept.length > 1, "the claim row and its audit entries were read");
  for (const r of kept) for (const secret of [PW, "tok-secret-live"]) assert.ok(!r.t.includes(secret), `${secret} stored: ${r.t.slice(0, 120)}`);
});

test("busy-API answers don't lock a person out after six tries, and the limit says how long to wait", { skip }, async () => {
  await register("busy");
  let me = (await viewer())!;
  await m.teams.createTeam(acting(me), { name: `${tag} Busy`, track: "Web App" });
  me = (await m.auth.getMemberById(me.id))!;
  claimStatus = 429;
  for (let i = 0; i < 12; i++) assert.equal((await m.act.claimPlan(me, "correct-horse-9")).outcome, "error", `try ${i + 1}`);
  await assert.rejects(m.act.claimPlan(me, "correct-horse-9"), /Wait about \d+s/);
});

test("the real claim API is never called outside production", { skip }, async () => {
  const saved = process.env.TESTMU_TRIAL_CLAIM_URL;
  delete process.env.TESTMU_TRIAL_CLAIM_URL;
  assert.equal(m.act.claimTarget().kind, "stub");
  process.env.TESTMU_TRIAL_CLAIM_URL = m.act.TESTMU_CLAIM_DEFAULT_URL;
  assert.equal(m.act.claimTarget().kind, "stub");
  process.env.TESTMU_TRIAL_CLAIM_URL = saved;
});

test("Codex codes: distinct under concurrency, re-shown, empty pool, upload dedupe", { skip }, async () => {
  const T = tag.toUpperCase();
  // Upload preview: dedupe in the file and against the pool.
  const text = `code,amount\n${T}-0001,250\n${T}-0002,250\n${T}-0001,250\nbad!\n`;
  const p = await m.act.previewCodexImport(text);
  assert.equal(p.fresh, 2);
  assert.equal(p.duplicatesInFile, 1);
  assert.equal(p.invalid.length, 1);
  const imp = await m.act.importCodexCodes(organizer, text, `${tag}-batch`);
  assert.equal(imp.imported, 2);
  assert.equal((await m.act.previewCodexImport(text)).duplicatesInDb, 2);
  // Only our codes are available for this test.
  await m.db.query(`update codex_credit_codes set status = 'revoked', revoked_reason = 'qa isolate' where status = 'available' and code not like '${T}%'`);

  const people = [];
  for (const who of ["cdxA", "cdxB", "cdxC"]) {
    await register(who);
    let me = (await viewer())!;
    await m.teams.createTeam(acting(me), { name: `${tag} ${who}`, track: "Web App" });
    me = (await m.auth.getMemberById(me.id))!;
    await m.act.setTick(me, "testmu_signup", true);
    people.push(me);
  }
  const [a, b, c] = people;
  const [ca, cb] = await Promise.all([m.act.assignCodexCode(a), m.act.assignCodexCode(b)]);
  assert.notEqual(ca.code, cb.code, "two members never share a code");
  const again = await m.act.assignCodexCode(a);
  assert.equal(again.code, ca.code);
  assert.equal(again.reused, true);
  // Double click by the same member never takes a second code.
  await assert.rejects(m.act.assignCodexCode(c), /out of codes/);
  const [{ n }] = await m.db.query<{ n: number }>("select count(*)::int as n from codex_credit_codes where assigned_member_id = $1 and status = 'assigned'", [a.id]);
  assert.equal(n, 1);
  // Codex tick needs the code; with it, all three done → activated_at.
  // The coupon comes by email now, so step 3 ticks without a code from the pool.
  await m.act.setTick(c, "codex_credits", true);
  assert.ok((await m.act.getActivationView(c.id)).ticks.has("codex_credits"));
  await m.act.setTick(a, "codex_credits", true);
  // Revoked codes are never handed out again.
  const [row] = await m.db.query<{ id: number }>("select id from codex_credit_codes where code = $1", [cb.code]);
  await m.act.revokeCodexCode(organizer, row.id, "qa revoke test");
  await assert.rejects(m.act.reassignCodexCode(organizer, b.id, "qa reassign"), /out of codes/);
});

test("the idea's type, Kane plan and extra info save, and a save without them keeps them", { skip }, async () => {
  const { saveIdea, getIdea } = await import("../../src/server/ideas.ts");
  await register("ideaA");
  const me = (await viewer())!;
  const { teamId } = await m.teams.createTeam(acting(me), { name: `${tag} Idea` });
  await saveIdea(acting(me), teamId, { title: "Ledger", app_type: "Web app", private_description: "Tracks shared expenses for flatmates.", kane_plan: "Kane checks sign-up and settle-up after every change.", extra_info: "" });
  let idea = (await getIdea(teamId))!;
  assert.deepEqual([idea.title, idea.app_type, idea.kane_plan, idea.extra_info], ["Ledger", "Web app", "Kane checks sign-up and settle-up after every change.", ""]);
  await saveIdea(acting(me), teamId, { title: "Ledger 2", private_description: "Tracks shared expenses.", source: "mcp" }); // an older client
  idea = (await getIdea(teamId))!;
  assert.deepEqual([idea.title, idea.app_type, idea.kane_plan], ["Ledger 2", "Web app", "Kane checks sign-up and settle-up after every change."]);
});

test("skills added on /match survive a later profile save", { skip }, async () => {
  await register("keepSkills", { skills: "", interests: "" });
  const me = (await viewer())!;
  await m.flow.updateMatchProfile(me, { skills: "rust, go", interests: "voice" });
  await m.flow.submitProfile({ name: "QA keepSkills", email: email("keepSkills"), linkedin: "linkedin.com/in/qa-keep", x: "@qa_keep", password: "" }, (await viewer())!);
  const row = await memberByEmail(email("keepSkills"));
  assert.deepEqual((row as unknown as { skills: string[] }).skills, ["rust", "go"]);
});

test("join requests, intros, invites and answers notify the right people", { skip }, async () => {
  const { requestIntro, inviteToTeam, listIntros } = await import("../../src/server/match.ts");
  const { listMyNotifications } = await import("../../src/server/member-notifications.ts");
  await register("bellCap");
  const cap = (await viewer())!;
  const team = await m.teams.createTeam(acting(cap), { name: `${tag} Bell Team`, recruiting_open: "on" });
  await register("bellMate");
  const mate = (await viewer())!;
  const inv = await m.teams.createInvite(acting((await m.auth.getMemberById(cap.id))!), team.teamId, {});
  await m.teams.joinTeam(acting(mate), { code: inv.code, confirm: "on" });
  await register("bellAsker");
  const asker = (await viewer())!;
  await m.flow.setTeamChoice(asker, true);

  // Ask to join → every team member hears about it.
  await requestIntro(acting(asker), { target_team_id: String(team.teamId), message: "I do CI" });
  for (const id of [cap.id, mate.id]) {
    const { items, unread } = await listMyNotifications(id);
    assert.ok(unread >= 1);
    assert.match(items[0].title, /QA bellAsker asked to join your team/);
  }
  // Accepting → the asker hears back.
  const [req] = (await listIntros(cap.id)).filter((i) => i.direction === "incoming" && i.via_team);
  await m.flow.answerIntro(acting((await m.auth.getMemberById(cap.id))!), req.id, true);
  assert.match((await listMyNotifications(asker.id)).items[0].title, /accepted your request/);

  // A team invite → the invited person; declining → the inviter.
  await register("bellInvitee");
  const invitee = (await viewer())!;
  await m.flow.setTeamChoice(invitee, true);
  await inviteToTeam(acting((await m.auth.getMemberById(cap.id))!), invitee.id, null);
  assert.match((await listMyNotifications(invitee.id)).items[0].title, /Bell Team invited you/);
  const [ti] = (await listIntros(invitee.id)).filter((i) => i.direction === "incoming");
  await m.flow.answerIntro(acting(invitee), ti.id, false);
  assert.match((await listMyNotifications(cap.id)).items[0].title, /declined the invite/);
});
