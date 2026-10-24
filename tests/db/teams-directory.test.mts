// The public /teams page: every team that hasn't withdrawn (no member names), and how many
// participants still have no team. Only people who said yes to teammate matching count as
// "in matching"; staff never count. Counts are compared before and after, so other rows don't matter.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

let db: typeof import("../../src/lib/db.ts");
let teams: typeof import("../../src/server/teams.ts");
const tag = `td${Date.now().toString(36)}p${process.pid.toString(36)}`;
const addr = (n: string) => `${tag}.${n}@example.test`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  [db, teams] = await Promise.all([import("../../src/lib/db.ts"), import("../../src/server/teams.ts")]);
});

after(async () => {
  if (skip || !db) return;
  await db.query(`delete from teams where slug like '${tag}-%'`).catch(() => {});
  await db.query(`delete from members where email like '${tag}.%'`).catch(() => {});
  await db.pool.end().catch(() => {});
});

async function member(name: string, opts: { teamId?: number; role?: string; looking?: boolean; discoverable?: boolean } = {}) {
  const [row] = await db.query<{ id: number }>(
    "insert into members (team_id, name, email, email_hash, role, looking_for_team) values ($1, $2, $3, $4, $5, $6) returning id",
    [opts.teamId ?? null, name, addr(name), hash(addr(name)), opts.role ?? "participant", opts.looking ?? null],
  );
  if (opts.teamId) await db.query("insert into team_memberships (team_id, member_id, role) values ($1, $2, 'member')", [opts.teamId, row.id]);
  if (opts.discoverable !== undefined) await db.query("insert into member_consents (member_id, category, granted, source) values ($1, 'teammate_discovery', $2, 'web')", [row.id, opts.discoverable]);
  return row.id;
}

async function team(n: string, state: string | null = null) {
  const [row] = await db.query<{ id: number }>("insert into teams (slug, name, track, idea, password_hash, state) values ($1, $2, 'web', 'qa', 'x', coalesce($3, 'formed')) returning id", [`${tag}-${n}`, `${tag} ${n}`, state]);
  return row.id;
}

test("the directory lists teams with their size and leaves out withdrawn ones", { skip }, async () => {
  const live = await team("live");
  const gone = await team("gone", "withdrawn");
  await member("ana", { teamId: live });
  await member("bo", { teamId: live });
  await member("cy", { teamId: gone });
  const list = await teams.listTeamDirectory();
  const mine = list.filter((t) => t.slug.startsWith(`${tag}-`));
  assert.deepEqual(mine.map((t) => [t.slug, t.member_count]), [[`${tag}-live`, 2]]);
});

test("teamless counts: participants without a team; in matching only with the teammate_discovery yes", { skip }, async () => {
  const before = await teams.teamlessCounts();
  const t = await team("counted");
  await member("on-team", { teamId: t });
  await member("quiet");
  await member("looking-no-consent", { looking: true, discoverable: false });
  await member("looking", { looking: true, discoverable: true });
  await member("judge", { role: "judge" });
  const now = await teams.teamlessCounts();
  assert.equal(now.total - before.total, 3);
  assert.equal(now.matching - before.matching, 1);
});
