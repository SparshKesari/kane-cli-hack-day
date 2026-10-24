// Help desk privacy and paper-slip reconciliation against a *throwaway*
// database (same guard as tier0.test.mts):
//   - mentors never read a ticket's secrets, private-repo excerpts or face
//     data (queue, ticket detail, participant URL); the author still does
//   - a late paper slip needs a reason, keeps its real time, and re-entering
//     it writes no second ticket or audit row
//
//   QA_DATABASE_URL=postgres://…throwaway… npm run test:db
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = { db: typeof import("../../src/lib/db.ts"); help: typeof import("../../src/server/help.ts") };
let m: Mods;
const tag = `qp${Date.now().toString(36)}p${process.pid.toString(36)}`;
const ids = { team: 0, author: 0, mate: 0, staff: 0 };
const slip = `H-${tag.slice(-6).toUpperCase()}`;

const SECRET = "QPSECRET-77Z";
const REPO = "PRIVATE-QP-91";
const FACE = "FACE-QP-3K";

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  const [db, help] = await Promise.all([import("../../src/lib/db.ts"), import("../../src/server/help.ts")]);
  m = { db, help };
  const [team] = await db.query<{ id: number }>("insert into teams (slug, name, track, idea, password_hash) values ($1, $2, 'web', 'qa', 'x') returning id", [tag, `${tag} team`]);
  ids.team = team.id;
  for (const k of ["author", "mate"] as const) {
    const [mem] = await db.query<{ id: number }>("insert into members (team_id, name, email) values ($1, $2, $3) returning id", [team.id, `QA ${k}`, `${tag}.${k}@example.test`]);
    ids[k] = mem.id;
  }
  const [p] = await db.query<{ id: number }>("insert into projects (team_id, name, slug) values ($1, $2, $3) on conflict (team_id) do update set name = excluded.name returning id", [team.id, tag, `${tag}-p`]);
  await db.query("insert into repository_links (project_id, repo_full_name, permission_scope) values ($1, $2, '[\"private\"]'::jsonb)", [p.id, `qa-org/${tag}-core`]);
  const [s] = await db.query<{ id: number }>("insert into staff_accounts (email, name, role, active) values ($1, 'QA Mentor', 'mentor', true) returning id", [`${tag}.mentor@example.test`]);
  ids.staff = s.id;
});

after(async () => {
  if (skip || !m) return;
  await m.db.query("delete from help_tickets where member_id = any($1::bigint[]) or upper(code) = $2", [[ids.author, ids.mate], slip]).catch(() => {});
  await m.db.query("delete from teams where id = $1", [ids.team]).catch(() => {});
  await m.db.query("delete from staff_accounts where id = $1", [ids.staff]).catch(() => {});
  await m.db.pool.end();
});

const memberRow = async (id: number) => (await m.db.query<import("../../src/server/auth.ts").MemberRow>("select id, team_id, name, display_name, email, 'participant' as role, public_code, checked_in_at, activated_at, deleted_at from members where id = $1", [id]))[0];
const mentor = () => ({ id: ids.staff, name: "QA Mentor", email: null, role: "mentor" as const });
const markers = (s: string) => [SECRET, REPO, FACE].filter((x) => s.includes(x));

test("mentors see a redacted ticket; the author sees their own text", { skip }, async () => {
  const author = await memberRow(ids.author);
  const created = await m.help.createHelpTicket(
    { member: author, actor: { type: "member", id: author.id, label: author.name }, source: "web" },
    {
      category: "kane_cli",
      summary: "QA privacy ticket for the mentor view",
      details: `api_key=${SECRET}\nFrom our repo qa-org/${tag}-core: ${REPO} const k = 1;\nmy face embedding: ${FACE} [0.1, 0.2, 0.3]`,
      tried: `Uploaded selfies/qa/${FACE}.jpg`,
      priority: "high",
    },
  );
  const code = created.ticket.code;
  await m.help.replyToTicket(code, { requester: { member: author, actor: { type: "member", id: author.id, label: author.name }, source: "web" } }, { body: `Here's more from qa-org/${tag}-core: ${REPO} return k;` });

  const staffView = await m.help.getHelpTicketForStaff(code, mentor());
  assert.deepEqual(markers(JSON.stringify(staffView)), []);
  assert.deepEqual([...staffView.redacted].sort(), ["biometric", "private_repo", "selfie"]);
  assert.match(staffView.details ?? "", /\[redacted: private repository excerpt \(qa-org\//);

  const queue = await m.help.listHelpQueue(mentor());
  const row = queue.open.find((t) => t.code === code);
  assert.ok(row);
  assert.deepEqual(markers(JSON.stringify(row)), []);

  const viaParticipantUrl = await m.help.getHelpTicket(code, { staff: mentor() });
  assert.deepEqual(markers(JSON.stringify(viaParticipantUrl)), []);

  const own = await m.help.getHelpTicket(code, { member: author });
  assert.deepEqual(markers(JSON.stringify(own)), [REPO, FACE]); // the secret was scrubbed at intake
  assert.deepEqual(own.redacted, []);

  const mate = await m.help.getHelpTicket(code, { member: await memberRow(ids.mate) });
  assert.deepEqual(markers(JSON.stringify(mate)), [REPO]);
});

test("a late paper slip needs a reason, keeps its time, and replays without a duplicate", { skip }, async () => {
  // Two hours ago, as the event-zone wall time staff would copy off the slip.
  const [w] = await m.db.query<{ d: string; t: string; at: Date }>(
    "select to_char(x at time zone tz, 'YYYY-MM-DD') as d, to_char(x at time zone tz, 'HH24:MI') as t, date_trunc('minute', x) as at from (select now() - interval '2 hours' as x, (select timezone from hack_events where id = current_event_id()) as tz) s",
  );
  const input = { code: slip, opened_date: w.d, opened_time: w.t, category: "other", summary: "QA paper slip" };
  await assert.rejects(m.help.addPaperTicket(mentor(), input), /entered late/);

  const reason = "Venue Wi-Fi outage; slip typed in after recovery";
  const first = await m.help.addPaperTicket(mentor(), { ...input, late_reason: reason });
  assert.equal(first.status, "created");
  const again = await m.help.addPaperTicket(mentor(), { ...input, opened_date: undefined, opened_time: `${w.d}T${w.t}` });
  assert.equal(again.status, "already_entered");
  assert.equal(again.opened_at_local, first.opened_at_local);

  const rows = await m.db.query<{ id: number; paper_original_at: Date; created_at: Date }>("select id, paper_original_at, created_at from help_tickets where upper(code) = $1", [slip]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].paper_original_at.getTime(), new Date(w.at).getTime());
  assert.ok(rows[0].created_at.getTime() > rows[0].paper_original_at.getTime());
  const audits = await m.db.query<{ reason: string }>("select reason from audit_events where action = 'help.paper_entry' and resource_type = 'help_ticket' and resource_id = $1", [String(rows[0].id)]);
  assert.deepEqual(audits.map((a) => a.reason), [reason]);
});

test("an AM/PM-ambiguous slip time is refused", { skip }, async () => {
  await assert.rejects(m.help.addPaperTicket(mentor(), { code: slip, opened_time: "1:05", category: "other", summary: "QA paper slip" }), /AM or PM/);
});
