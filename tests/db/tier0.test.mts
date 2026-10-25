// Tier-0 rehearsal checks against a *throwaway* Neon branch (T-QA-01/06):
//   - 20 simultaneous help tickets all land, with distinct codes
//   - two mentors claim the same ticket: exactly one wins, the other gets 409
//   - finalize twice returns the same receipt
//   - after the submission deadline time drafts still save and finalize isn't locked
//   - a manual receipt can be recorded when online finalize is unavailable
//   - finalize keeps a story published in the Ship Studio, adding the submission's video
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
  auth: typeof import("../../src/server/auth.ts");
  A: typeof import("../../src/server/mcp-adapters.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `qa${Date.now().toString(36)}p${process.pid.toString(36)}`;
const ids = { teams: [] as number[], members: [] as number[], staff: [] as number[] };

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  const [db, help, sub, session, auth, A, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/server/help.ts"),
    import("../../src/server/submission.ts"),
    import("../../src/lib/session.ts"),
    import("../../src/server/auth.ts"),
    import("../../src/server/mcp-adapters.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, help, sub, session, auth, A, jar: headers.jar };
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

test("the final submission form (2026-10-24): saving it keeps a draft's older fields, and the four required fields finalize", { skip }, async () => {
  const slug = `${tag}-t0`;
  await signInAsCaptain(0);
  // A draft saved with the earlier form: commit SHA, harness, limitations.
  await m.sub.saveDraft(slug, { project_name: "Old form", repo_url: "https://github.com/example/old", commit_sha: "b".repeat(40), harness_summary: "Old harness", limitations: "one gap" });
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    project_name: "New form", project_description: "What it does, in full.", one_line_pitch: "One line.", repo_url: "https://github.com/example/new",
    showcase_url: "", linkedin_posts: "https://www.linkedin.com/posts/a, https://www.linkedin.com/posts/b", x_posts: "https://x.com/a/status/1\nhttps://x.com/a/status/2",
    blog_links: "https://blog.example/post", deck_url: "", video_url: "https://youtu.be/x", hn_url: "https://news.ycombinator.com/item?id=1",
  })) fd.set(k, v);
  await m.sub.saveDraft(slug, m.sub.draftInputFromForm(fd));

  const ctx = await m.sub.getSubmissionContext(ids.teams[0]);
  const d = ctx.draft;
  assert.equal(d.project_name, "New form");
  assert.equal(d.repo_url, "https://github.com/example/new");
  assert.deepEqual(d.linkedin_posts, ["https://www.linkedin.com/posts/a", "https://www.linkedin.com/posts/b"]);
  assert.deepEqual(d.x_posts, ["https://x.com/a/status/1", "https://x.com/a/status/2"]);
  assert.equal(d.deck_url, null);
  // Not on the new form, so not wiped by its save.
  assert.equal(d.commit_sha, "b".repeat(40));
  assert.equal(d.harness_summary, "Old harness");
  assert.deepEqual(d.limitations, ["one gap"]);
  assert.deepEqual(ctx.preflight.missing, []);

  const fin = await m.sub.finalizeSubmission(slug, { confirm_phrase: `${tag} team 0`, confirm: "on", publish_showcase: "on", idempotency_key: `${tag}-final-0` });
  const [row] = await m.db.query<{ snap: { submission?: { linkedin_posts?: string[]; hn_url?: string } } }>("select immutable_snapshot as snap from submissions where receipt_code = $1", [fin.data.receipt_code]);
  assert.deepEqual(row.snap.submission?.linkedin_posts, ["https://www.linkedin.com/posts/a", "https://www.linkedin.com/posts/b"]);
  assert.equal(row.snap.submission?.hn_url, "https://news.ycombinator.com/item?id=1");
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
    project_description: "What it does.", project_name: "QA project", project_type: "tool", one_line_pitch: "QA", repo_url: "https://github.com/example/qa", commit_sha: sha,
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

test("finalize keeps the story the team published in the Ship Studio and adds the submission's video", { skip }, async () => {
  const slug = `${tag}-t4`;
  const teamId = ids.teams[4];
  await signInAsCaptain(4);
  await m.db.query("insert into member_consents (member_id, category, granted, source) values ($1, 'activity_publication', true, 'web')", [ids.members[16]]);
  const sha = "b".repeat(40);
  await m.sub.getSubmissionContext(teamId);
  const [p] = await m.db.query<{ id: number }>("select id from projects where team_id = $1", [teamId]);
  const [run] = await m.db.query<{ id: number }>(
    "insert into kane_runs (project_id, team_id, source, upstream_execution_id, status, commit_sha, source_verified, verification_state) values ($1, $2, 'kanehack_cli', $3, 'passed', $4, true, 'verified') returning id",
    [p.id, teamId, `${tag}-run4`, sha],
  );
  // What a Studio publish leaves behind: a reviewed story version and a ship_page row whose consent receipt names the approver.
  const shot = "https://cdn.example/qa-board.png";
  const studio = {
    schema_version: 1, project_id: String(p.id), slug, project_name: "QA Studio name", one_line_pitch: "The pitch the team reviewed.", creation_type: "tool",
    problem: "", what_we_built: "", how_it_works: [], harness: { summary: "Studio harness", components: ["kane-cli run"], stages: ["Studio stage"] },
    proof: [{ claim: "The claim the team reviewed.", confidence: "verified", source: "", run_id: String(run.id), evidence_id: null, commit_sha: sha }],
    impact: [], limitations: ["Studio limitation"], links: { github: "https://github.com/example/qa-studio", demo: "", repo_commit: "", ship_page: `/ship/${slug}` },
    team: [], visuals: [{ kind: "screenshot", approved: true, source: shot, alt_text: "Board" }], consent_reviewed: true, status: "approved",
  };
  const [sv] = await m.db.query<{ id: number }>("insert into project_stories (project_id, version, content, created_by) values ($1, 1, $2, $3) returning id", [p.id, JSON.stringify(studio), ids.members[16]]);
  await m.db.query(
    "insert into published_assets (project_id, kind, version, source_story_id, state, consent_receipt, published_by) values ($1, 'ship_page', 1, $2, 'public', $3, $4)",
    [p.id, sv.id, JSON.stringify({ story_version: 1, approved_by: { member_id: ids.members[16], name: "QA 4.0" }, credited: [] }), ids.members[16]],
  );
  const video = "https://cdn.example/qa-demo.mp4";
  await m.sub.saveDraft(slug, {
    project_description: "What it does.", project_name: "QA submission name", project_type: "tool", one_line_pitch: "The submission pitch.", repo_url: "https://github.com/example/qa", commit_sha: sha,
    demo_url: "https://example.com/qa", harness_summary: "Submission harness", kane_components: ["testrun"], limitations: "none known", kane_run_ids: [String(run.id)], video_url: video,
  });
  const fin = await m.sub.finalizeSubmission(slug, { confirm_phrase: `${tag} team 4`, confirm: "on", publish_showcase: "on", idempotency_key: `${tag}-final-4` });
  assert.ok(fin.data.receipt_code);

  const [live] = await m.db.query<{ content: typeof studio; basis: string | null }>(
    `select s.content, a.consent_receipt->>'basis' as basis from published_assets a join project_stories s on s.id = a.source_story_id
      where a.project_id = $1 and a.kind = 'ship_page' order by a.version desc limit 1`,
    [p.id],
  );
  assert.equal(live.basis, "finalize_confirmation");
  assert.equal(live.content.project_name, "QA Studio name");
  assert.equal(live.content.one_line_pitch, "The pitch the team reviewed.");
  assert.deepEqual(live.content.proof.map((x) => x.claim), ["The claim the team reviewed."]);
  assert.deepEqual(live.content.harness.stages, ["Studio stage"]);
  assert.deepEqual(live.content.visuals.map((v) => [v.kind, v.source]), [["screenshot", shot], ["video", video]]);
  assert.equal(live.content.links.github, "https://github.com/example/qa-studio");
  assert.equal(live.content.links.demo, "https://example.com/qa");

  // Control: team 1 finalized above without a Studio story, so its page is still built from its submission.
  const [t1] = await m.db.query<{ name: string }>(
    `select s.content->>'project_name' as name from published_assets a join project_stories s on s.id = a.source_story_id
      join projects p on p.id = a.project_id where p.team_id = $1 and a.kind = 'ship_page' order by a.version desc limit 1`,
    [ids.teams[1]],
  );
  assert.equal(t1.name, "QA project");
});

test("the Codex session submits (submission_save / submission_finalize): anyone saves, only the captain finalizes, with the team name", { skip }, async () => {
  const ctxOf = (mem: import("../../src/server/auth.ts").MemberRow) => ({ member: mem, actor: m.auth.memberActor(mem), requestId: "test" });
  const cap = (await m.auth.getMemberById(ids.members[12]))!; // team 3's captain
  const mate = (await m.auth.getMemberById(ids.members[13]))!;
  const saved = await m.A.submissionSave(ctxOf(mate), {
    project_name: "Agent project", project_description: "Saved from a Codex session.", one_line_pitch: "From the session.", repo_url: "https://github.com/example/agent",
    x_posts: "https://x.com/a/status/1, https://x.com/a/status/2", deck_url: undefined,
  });
  assert.deepEqual(saved.saved_fields, ["project_name", "project_description", "one_line_pitch", "repo_url", "x_posts"]);
  assert.equal(saved.ready, true, JSON.stringify(saved.missing));

  await assert.rejects(m.A.finalizeSubmissionAsCaptain(ctxOf(mate), { confirm_phrase: `${tag} team 3` }), (e: { code?: string }) => e.code === "FORBIDDEN");
  await assert.rejects(m.A.finalizeSubmissionAsCaptain(ctxOf(cap), { confirm_phrase: "not the team" }), (e: { code?: string }) => e.code === "VALIDATION_FAILED");
  const f = await m.A.finalizeSubmissionAsCaptain(ctxOf(cap), { confirm_phrase: `${tag} team 3`, idempotency_key: `${tag}-agent-final` });
  assert.ok(f.receipt_code);
  assert.equal(f.already_finalized, false);
  const [row] = await m.db.query<{ source: string; status: string; x: string[] }>(
    "select source, status, immutable_snapshot->'submission'->'x_posts' as x from submissions where receipt_code = $1",
    [f.receipt_code],
  );
  assert.equal(row.status, "finalized");
  assert.deepEqual(row.x, ["https://x.com/a/status/1", "https://x.com/a/status/2"]);
  // Listed publicly by default, like the Submit tab's toggle: the skill never sends publish_showcase.
  const [shown] = await m.db.query<{ showcase_state: string }>("select p.showcase_state from submissions s join projects p on p.id = s.project_id where s.receipt_code = $1", [f.receipt_code]);
  assert.equal(shown.showcase_state, "public");
  const again = await m.A.finalizeSubmissionAsCaptain(ctxOf(cap), { confirm_phrase: `${tag} team 3` });
  assert.equal(again.receipt_code, f.receipt_code);
  assert.equal(again.already_finalized, true);
  assert.equal((await m.A.finalizeSubmission(ctxOf(mate))).already_finalized, true);

  // The receipt link the session hands out opens in full for anyone, signed in or not.
  m.jar.clear();
  const pub = await m.sub.getReceipt(f.receipt_code);
  assert.equal(pub.team.name, `${tag} team 3`);
  assert.deepEqual((pub.snapshot as { submission?: { x_posts?: string[] } }).submission?.x_posts, ["https://x.com/a/status/1", "https://x.com/a/status/2"]);
  assert.equal((await m.sub.verifyReceipt(f.receipt_code)).hash, "match");
});
