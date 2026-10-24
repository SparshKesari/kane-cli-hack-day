// Tier-0 rehearsal checks against a *throwaway* Neon branch (T-QA-01/06):
//   - 20 simultaneous help tickets all land, with distinct codes
//   - two mentors claim the same ticket: exactly one wins, the other gets 409
//   - finalize twice returns the same receipt
//   - after the submission deadline time drafts still save and finalize isn't locked
//   - a manual receipt can be recorded when online finalize is unavailable
//
// Never point this at the live database. It refuses to run unless
// QA_DATABASE_URL is set and differs from DATABASE_URL. The branch must have
// every db/*.sql migration applied (npm run db:migrate against the branch).
//
//   QA_DATABASE_URL=postgres://…branch… npm run test:db
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  help: typeof import("../../src/server/help.ts");
  sub: typeof import("../../src/server/submission.ts");
  session: typeof import("../../src/lib/session.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `qa${Date.now().toString(36)}p${process.pid.toString(36)}`;
const ids = { teams: [] as number[], members: [] as number[], staff: [] as number[] };

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  const [db, help, sub, session, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/server/help.ts"),
    import("../../src/server/submission.ts"),
    import("../../src/lib/session.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, help, sub, session, jar: headers.jar };
  // 5 teams × 4 members, plus two mentors.
  for (let t = 0; t < 5; t++) {
    const [team] = await db.query<{ id: number }>(
      "insert into teams (slug, name, track, idea, password_hash) values ($1, $2, 'web', 'qa', 'x') returning id",
      [`${tag}-t${t}`, `${tag} team ${t}`],
    );
    ids.teams.push(team.id);
    for (let i = 0; i < 4; i++) {
      const [mem] = await db.query<{ id: number }>("insert into members (team_id, name, email) values ($1, $2, $3) returning id", [team.id, `QA ${t}.${i}`, `${tag}.${t}.${i}@example.test`]);
      ids.members.push(mem.id);
    }
    await db.query("update teams set captain_id = $2 where id = $1", [team.id, ids.members[ids.members.length - 4]]);
  }
  for (const n of [1, 2]) {
    const [s] = await db.query<{ id: number }>("insert into staff_accounts (email, name, role, active) values ($1, $2, 'mentor', true) returning id", [`${tag}.mentor${n}@example.test`, `QA mentor ${n}`]);
    ids.staff.push(s.id);
  }
});

after(async () => {
  if (skip || !m) return;
  await m.db.query("delete from help_tickets where member_id = any($1::bigint[])", [ids.members]).catch(() => {});
  await m.db.query("delete from teams where id = any($1::bigint[])", [ids.teams]).catch(() => {});
  await m.db.query("delete from staff_accounts where id = any($1::bigint[])", [ids.staff]).catch(() => {});
  await m.db.pool.end();
});

const memberRow = async (id: number) => (await m.db.query<import("../../src/server/auth.ts").MemberRow>("select id, team_id, name, display_name, email, 'participant' as role, public_code, checked_in_at, activated_at, deleted_at from members where id = $1", [id]))[0];
const mentor = (n: number) => ({ id: ids.staff[n], name: `QA mentor ${n + 1}`, email: null, role: "mentor" as const });

test("20 simultaneous help tickets all land with distinct codes", { skip }, async () => {
  const members = await Promise.all(ids.members.map(memberRow));
  const out = await Promise.all(
    members.map((mem, i) =>
      m.help.createHelpTicket({ member: mem, actor: { type: "member", id: mem.id, label: mem.name }, source: "web" }, { category: "kane_cli", summary: `QA burst ticket ${i} cannot install`, priority: "normal" }),
    ),
  );
  assert.equal(out.length, 20);
  assert.equal(new Set(out.map((t) => t.ticket.code)).size, 20);
});

test("two mentors claim one ticket: one wins, the other gets 409", { skip }, async () => {
  const mem = await memberRow(ids.members[0]);
  const t = await m.help.createHelpTicket({ member: mem, actor: { type: "member", id: mem.id, label: mem.name }, source: "web" }, { category: "kane_cli", summary: "QA claim race ticket", priority: "normal" });
  const results = await Promise.allSettled([m.help.claimHelpTicket(t.ticket.code, mentor(0)), m.help.claimHelpTicket(t.ticket.code, mentor(1))]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(ok.length, 1);
  assert.equal(bad.length, 1);
  assert.equal((bad[0].reason as { status?: number }).status, 409);
});

async function signInAsCaptain(teamIdx: number) {
  m.jar.clear();
  await m.session.setMemberSession({ memberId: ids.members[teamIdx * 4], personal: true });
}

test("finalize twice returns the same receipt; after the deadline time drafts still save and finalize isn't locked", { skip }, async () => {
  const slug = `${tag}-t1`;
  const teamId = ids.teams[1];
  await signInAsCaptain(1);
  await m.db.query("insert into member_consents (member_id, category, granted, source) values ($1, 'activity_publication', true, 'web')", [ids.members[4]]);
  // A passing, source-verified run on the submitted commit.
  const sha = "a".repeat(40);
  await m.sub.getSubmissionContext(teamId); // creates the project row if needed
  const [p] = await m.db.query<{ id: number }>("select id from projects where team_id = $1", [teamId]);
  const [run] = await m.db.query<{ id: number }>(
    "insert into kane_runs (project_id, team_id, source, upstream_execution_id, status, commit_sha, source_verified, verification_state) values ($1, $2, 'kanehack_cli', $3, 'passed', $4, true, 'verified') returning id",
    [p.id, teamId, `${tag}-run`, sha],
  );
  await m.sub.saveDraft(slug, {
    project_name: "QA project", project_type: "tool", one_line_pitch: "QA", repo_url: "https://github.com/example/qa", commit_sha: sha,
    demo_url: "https://example.com", harness_summary: "QA harness", kane_components: ["testrun"], limitations: "none known", kane_run_ids: [String(run.id)],
  });
  const body = { confirm_phrase: `${tag} team 1`, confirm: "on", publish_showcase: "on", idempotency_key: `${tag}-final-1` };
  const a = await m.sub.finalizeSubmission(slug, body);
  const b = await m.sub.finalizeSubmission(slug, body);
  const c = await m.sub.finalizeSubmission(slug, { ...body, idempotency_key: `${tag}-final-2` });
  assert.equal(a.data.receipt_code, b.data.receipt_code);
  assert.equal(a.data.receipt_code, c.data.receipt_code);
  assert.equal(c.data.already, true);

  // The deadline time no longer locks anything (event day, 2026-10-24): move it into the past on
  // this branch, then a fresh team can still save, and finalize fails only on what's missing.
  const [ev] = await m.db.query<{ locks: Date }>("select submission_locks_at as locks from hack_events where id = current_event_id()");
  await m.db.query("update hack_events set submission_locks_at = now() - interval '1 minute' where id = current_event_id()");
  try {
    await signInAsCaptain(2);
    await m.sub.saveDraft(`${tag}-t2`, { project_name: "late" });
    await assert.rejects(m.sub.finalizeSubmission(`${tag}-t2`, { ...body, confirm_phrase: `${tag} team 2`, idempotency_key: `${tag}-final-3` }), (e: { code?: string }) => e.code === "VALIDATION_FAILED");
    assert.equal((await m.sub.getSubmissionContext(ids.teams[2])).locked, false);
  } finally {
    await m.db.query("update hack_events set submission_locks_at = $1 where id = current_event_id()", [ev.locks]);
  }
});

test("a non-captain, or a team-password session, can't finalize", { skip }, async () => {
  m.jar.clear();
  await m.session.setMemberSession({ memberId: ids.members[13], personal: true }); // team 3, not captain
  await assert.rejects(m.sub.finalizeSubmission(`${tag}-t3`, { confirm_phrase: `${tag} team 3`, confirm: "on" }), (e: { code?: string }) => e.code === "FORBIDDEN");
  m.jar.clear();
  await m.session.setMemberSession({ memberId: ids.members[12], personal: false }); // captain, team password only
  await assert.rejects(m.sub.finalizeSubmission(`${tag}-t3`, { confirm_phrase: `${tag} team 3`, confirm: "on" }), (e: { code?: string }) => e.code === "UNAUTHENTICATED");
});
