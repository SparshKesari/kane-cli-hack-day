// Check-in exceptions against a *throwaway* database (same guard as tier0):
//   - a walk-in's admission is recorded as the staff exception (who, when, why),
//     and its check-in is a separate audited fact
//   - a signed paper check-in ledger checks an approved guest in at the slip
//     time, keeps the entry time and reason, audits by slip id, and a replay
//     changes nothing
//   - the ledger never admits anyone and refuses a reused slip id
//
//   QA_DATABASE_URL=postgres://…throwaway… npm run test:db
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  roster: typeof import("../../src/server/roster.ts");
  recovery: typeof import("../../src/server/recovery.ts");
};
let m: Mods;
const tag = `qa${Date.now().toString(36)}p${process.pid.toString(36)}`;
const ids = { staff: 0, guests: [] as number[] };
let organizer: { id: number; name: string; email: string | null; role: "organizer" };

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  const [db, roster, recovery] = await Promise.all([import("../../src/lib/db.ts"), import("../../src/server/roster.ts"), import("../../src/server/recovery.ts")]);
  m = { db, roster, recovery };
  const [s] = await db.query<{ id: number }>("insert into staff_accounts (email, name, role, active) values ($1, $2, 'organizer', true) returning id", [`${tag}.org@example.test`, `QA organizer ${tag}`]);
  ids.staff = s.id;
  organizer = { id: s.id, name: `QA organizer ${tag}`, email: null, role: "organizer" };
  for (const [suffix, approval, admission] of [
    ["ok", "approved", "admitted"],
    ["no", "declined", "not_admitted"],
  ] as const) {
    const [g] = await db.query<{ id: number }>(
      "insert into roster_guests (source, luma_guest_id, name, approval_status, admission_status) values ('luma_csv', $1, $2, $3, $4) returning id",
      [`${tag}-${suffix}`, `QA guest ${suffix}`, approval, admission],
    );
    ids.guests.push(g.id);
  }
});

after(async () => {
  if (skip || !m) return;
  await m.db.query("delete from checkin_reconciliations where receipt_id like $1", [`${tag.toUpperCase()}%`]).catch(() => {});
  await m.db.query("delete from members where email like $1", [`${tag}.%`]).catch(() => {});
  await m.db.query("delete from roster_guests where luma_guest_id like $1 or email_hash = $2", [`${tag}-%`, (await import("../../src/server/core.ts")).emailHash(`${tag}.walkin@example.test`)]).catch(() => {});
  await m.db.query("delete from staff_accounts where id = $1", [ids.staff]).catch(() => {});
  await m.db.pool.end();
});

const audits = (resourceType: string, resourceId: string | number) =>
  m.db.query<{ action: string; reason: string | null; payload: Record<string, unknown> }>(
    "select action, reason, payload from audit_events where resource_type = $1 and resource_id = $2 order by id",
    [resourceType, String(resourceId)],
  );

test("a walk-in is admitted as the staff exception, with check-in as its own audited fact", { skip }, async () => {
  const r = await m.roster.admitWalkIn({ name: "QA Walker", email: `${tag}.walkin@example.test`, note: "ID checked at the desk" }, organizer);
  assert.equal(r.createdGuest, true);
  const [g] = await m.db.query<{ source: string; admission_basis: string; admitted_by: number; admitted_at: Date; admission_reason: string; checked_in_at: Date; checkin_source: string }>(
    "select source, admission_basis, admitted_by, admitted_at, admission_reason, checked_in_at, checkin_source from roster_guests where id = $1",
    [r.guestId],
  );
  assert.equal(g.source, "walk_in");
  assert.equal(g.admission_basis, "walk_in_exception");
  assert.equal(Number(g.admitted_by), organizer.id);
  assert.ok(g.admitted_at);
  assert.equal(g.admission_reason, "ID checked at the desk");
  assert.ok(g.checked_in_at);
  assert.equal(g.checkin_source, "desk");
  const actions = (await audits("roster_guest", r.guestId)).map((a) => a.action);
  assert.ok(actions.includes("checkin.walk_in"), "admission audited");
  assert.ok(actions.includes("checkin.guest"), "check-in audited separately");
  const hit = (await m.roster.searchCheckin(`${tag}.walkin@example.test`))[0];
  assert.equal(hit.admissionBasis, "walk_in_exception");
  assert.equal(hit.admittedByName, organizer.name);
  assert.equal(hit.checkinSource, "desk");
});

const ledger = (rows: string[][]) =>
  ["receipt_id,attendee_id,checked_in_at,timezone,delay_reason,staff_id,staff_signature,witness_id", ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n") + "\n";
const reason = "Venue Wi-Fi outage; slip entered after recovery";

test("a signed paper slip checks an approved guest in at the slip time, audited by slip id, and replays are no-ops", { skip }, async () => {
  const slip = `${tag.toUpperCase()}-1`;
  const csv = ledger([[slip, `${tag}-ok`, "2026-10-23 00:15", "America/Los_Angeles", reason, "Sam Ortiz", "S.O.", "Morgan Reyes"]]);
  const first = await m.recovery.importLedger("checkin_ledger", csv, organizer);
  assert.equal(first.imported, 1, JSON.stringify(first.lines));

  const [g] = await m.db.query<{ checked_in_at: Date; checkin_source: string; checkin_ref: string; checkin_entered_at: Date }>(
    "select checked_in_at, checkin_source, checkin_ref, checkin_entered_at from roster_guests where id = $1",
    [ids.guests[0]],
  );
  assert.equal(new Date(g.checked_in_at).toISOString(), "2026-10-23T07:15:00.000Z", "paper time kept as the attendance time");
  assert.equal(g.checkin_source, "offline_ledger");
  assert.equal(g.checkin_ref, slip);
  assert.ok(new Date(g.checkin_entered_at).getTime() > new Date(g.checked_in_at).getTime(), "entry time recorded beside it");

  const rec = await m.db.query<{ guest_id: number; paper_at: Date; entered_at: Date; delay_reason: string; outcome: string }>(
    "select guest_id, paper_at, entered_at, delay_reason, outcome from checkin_reconciliations where receipt_id = $1",
    [slip],
  );
  assert.equal(rec.length, 1);
  assert.equal(Number(rec[0].guest_id), ids.guests[0]);
  assert.equal(rec[0].delay_reason, reason);
  assert.equal(rec[0].outcome, "checked_in");
  const a = await audits("checkin_reconciliation", slip);
  assert.equal(a.length, 1);
  assert.equal(a[0].action, "checkin.offline_ledger");
  assert.equal(a[0].reason, reason);
  assert.ok((await audits("roster_guest", ids.guests[0])).some((x) => x.action === "checkin.guest" && x.reason === reason));

  // Same file again: nothing new.
  const again = await m.recovery.importLedger("checkin_ledger", csv, organizer);
  assert.match(again.lines[0].message, /Already reconciled/);
  assert.equal((await m.db.query("select 1 from checkin_reconciliations where receipt_id = $1", [slip])).length, 1);
  assert.equal((await audits("checkin_reconciliation", slip)).length, 1);
  const [g2] = await m.db.query<{ checked_in_at: Date }>("select checked_in_at from roster_guests where id = $1", [ids.guests[0]]);
  assert.equal(new Date(g2.checked_in_at).toISOString(), new Date(g.checked_in_at).toISOString());

  // The same slip id for someone else is a conflict, not a second check-in.
  const clash = await m.recovery.importLedger("checkin_ledger", ledger([[slip, `${tag}-no`, "2026-10-23 00:20", "", reason, "Sam Ortiz", "S.O.", ""]]), organizer);
  assert.equal(clash.lines[0].ok, false);

  const view = await m.recovery.reconciliationView();
  const row = view.rows.find((r) => r.kind === "checkin" && r.ref === slip);
  assert.ok(row, "shown in the reconciliation view");
  assert.ok(row.links?.some((l) => l.href.includes(`${tag}-ok`)), "links to the attendee");
});

test("the ledger never admits anyone and refuses paper times in the future", { skip }, async () => {
  const out = await m.recovery.importLedger(
    "checkin_ledger",
    ledger([
      [`${tag.toUpperCase()}-2`, `${tag}-no`, "2026-10-23 00:15", "America/Los_Angeles", reason, "Sam Ortiz", "S.O.", ""],
      [`${tag.toUpperCase()}-3`, `${tag}-ok`, "2099-01-01 09:00", "America/Los_Angeles", reason, "Sam Ortiz", "S.O.", ""],
      [`${tag.toUpperCase()}-4`, `${tag}-nobody`, "2026-10-23 00:15", "America/Los_Angeles", reason, "Sam Ortiz", "S.O.", ""],
    ]),
    organizer,
  );
  assert.deepEqual(
    out.lines.map((l) => l.ok),
    [false, false, false],
  );
  const [g] = await m.db.query<{ admission_status: string; checked_in_at: Date | null }>("select admission_status, checked_in_at from roster_guests where id = $1", [ids.guests[1]]);
  assert.equal(g.admission_status, "not_admitted");
  assert.equal(g.checked_in_at, null);
  assert.equal((await m.db.query("select 1 from checkin_reconciliations where receipt_id like $1", [`${tag.toUpperCase()}-_`])).length, 1, "only the first test's slip");
});
