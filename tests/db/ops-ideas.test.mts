// /ops/ideas: every team's saved idea for organizers. Teams with nothing saved come last; withdrawn
// teams are left out; anyone below organizer is refused.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

let db: typeof import("../../src/lib/db.ts");
let ideas: typeof import("../../src/server/ideas.ts");
const tag = `oi${Date.now().toString(36)}p${process.pid.toString(36)}`;
const organizer = { id: null, name: "QA organizer", email: null, role: "organizer" as const };

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  [db, ideas] = await Promise.all([import("../../src/lib/db.ts"), import("../../src/server/ideas.ts")]);
});

after(async () => {
  if (skip || !db) return;
  await db.query(`delete from teams where slug like '${tag}-%'`).catch(() => {});
  await db.pool.end().catch(() => {});
});

async function team(n: string, state = "active") {
  const [row] = await db.query<{ id: number }>("insert into teams (slug, name, track, idea, password_hash, state) values ($1, $2, 'web', '', 'x', $3) returning id", [`${tag}-${n}`, `${tag} ${n}`, state]);
  return row.id;
}

test("organizers see each team's saved idea; blank ones come last; withdrawn teams are left out", { skip }, async () => {
  const saved = await team("saved");
  const blank = await team("blank");
  const gone = await team("gone", "withdrawn");
  await db.query("insert into ideas (team_id, title, private_description, app_type, kane_plan) values ($1, 'ShelfCheck', 'Photo a shelf, list what is missing.', 'Web App', 'Kane tests the upload flow.')", [saved]);
  await db.query("insert into ideas (team_id, title) values ($1, 'blank title')", [blank]);
  await db.query("insert into ideas (team_id, title, private_description) values ($1, 'Gone', 'withdrawn team idea')", [gone]);

  const rows = (await ideas.listIdeasForOps(organizer)).filter((r) => r.team_slug.startsWith(`${tag}-`));
  assert.deepEqual(rows.map((r) => [r.team_slug, r.saved]), [[`${tag}-saved`, true], [`${tag}-blank`, false]]);
  assert.equal(rows[0].title, "ShelfCheck");
  assert.equal(rows[0].kane_plan, "Kane tests the upload flow.");
});

test("anyone below organizer is refused", { skip }, async () => {
  const forbidden = (e: unknown) => (e as { code?: string }).code === "FORBIDDEN";
  await assert.rejects(ideas.listIdeasForOps({ ...organizer, role: "mentor" }), forbidden);
  await assert.rejects(ideas.listIdeasForOps(null), forbidden);
});
