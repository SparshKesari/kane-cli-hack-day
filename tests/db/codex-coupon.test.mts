// The Codex coupon by email, against a QA database: the hack-os skill posts the person's email
// to /api/v1/codex/coupon; someone on the participant list gets a code from the pool by email
// (never in the response), asking again re-sends the same code, and everyone else gets nothing.
// Organizers add people to the list through /api/import/roster with their own token.
// Mail goes to tests/support/stubs/nodemailer.mjs, never to a real server.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  coupon: typeof import("../../src/app/api/v1/codex/coupon/route.ts");
  roster: typeof import("../../src/app/api/import/roster/route.ts");
  activation: typeof import("../../src/server/event-activation.ts");
  A: typeof import("../../src/server/mcp-adapters.ts");
  mcp: typeof import("../../src/server/mcp.ts");
};
type Mail = { sent: { to: string; subject: string; text: string; html: string }[]; fail: boolean };
let m: Mods;
const mail = () => (globalThis as unknown as { __mail: Mail }).__mail;
const tag = `cp${Date.now().toString(36)}p${process.pid.toString(36)}`;
const addr = (who: string) => `${tag}.${who}@example.test`;
const hash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
const TOKEN = `qa-roster-token-${tag}-0123456789`;
const SMTP = { SMTP_USER: "qa-sender@example.test", SMTP_PASS: "qa app password" };

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  process.env.ROSTER_API_TOKEN = TOKEN;
  Object.assign(process.env, SMTP);
  const [db, coupon, roster, activation, A, mcp] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/app/api/v1/codex/coupon/route.ts"),
    import("../../src/app/api/import/roster/route.ts"),
    import("../../src/server/event-activation.ts"),
    import("../../src/server/mcp-adapters.ts"),
    import("../../src/server/mcp.ts"),
  ]);
  m = { db, coupon, roster, activation, A, mcp };
  await db.query(`insert into codex_credit_codes (code, batch) select 'QA-${tag}-' || n, 'qa-${tag}' from generate_series(1, 10) n`);
});

after(async () => {
  if (skip || !m) return;
  const hashes = ["ann", "bob", "cat", "dee", "eve", "fay", "gus", "hal", "ivy", "jo", "jo.luma", "kim", "lee", "max"].map((w) => hash(addr(w)));
  await m.db.query(`delete from codex_credit_codes where code like 'QA-${tag}-%'`).catch(() => {});
  await m.db
    .query(
      `update codex_credit_codes set status = 'available', assigned_guest_id = null, assigned_member_id = null, assigned_at = null, assigned_by = null,
              revealed_at = null, emailed_at = null, email_count = 0
        where assigned_guest_id in (select id from roster_guests where email_hash = any($1::text[]))`,
      [hashes],
    )
    .catch(() => {});
  await m.db.query("delete from roster_guests where email_hash = any($1::text[])", [hashes]).catch(() => {});
  await m.db.query(`delete from members where email like '${tag}.%'`).catch(() => {});
  await m.db.pool.end().catch(() => {});
});

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const addPeople = (body: unknown, token: string | null = TOKEN) =>
  m.roster.POST(json("http://localhost/api/import/roster", body, token ? { authorization: `Bearer ${token}` } : {}));
const askCoupon = (email: string) => m.coupon.POST(json("http://localhost/api/v1/codex/coupon", { email }));

async function codeFor(email: string) {
  const rows = await m.db.query<{ id: number; code: string; status: string; email_count: number; emailed_at: Date | null; assigned_by: string | null; assigned_member_id: number | null }>(
    `select k.id, k.code, k.status, k.email_count, k.emailed_at, k.assigned_by, k.assigned_member_id
       from codex_credit_codes k join roster_guests g on g.id = k.assigned_guest_id
      where g.email_hash = $1 and k.status = 'assigned'`,
    [hash(email)],
  );
  return rows;
}
const available = async () => (await m.db.query<{ n: number }>("select count(*)::int as n from codex_credit_codes where status = 'available' and event_id = current_event_id()"))[0].n;

test("the roster API refuses a missing or wrong token", { skip }, async () => {
  assert.equal((await addPeople({ email: addr("ann") }, null)).status, 401);
  assert.equal((await addPeople({ email: addr("ann") }, `${TOKEN}-wrong`)).status, 401);
  const rows = await m.db.query("select 1 from roster_guests where email_hash = $1", [hash(addr("ann"))]);
  assert.equal(rows.length, 0, "nothing added without the token");
});

test("the roster API adds people once and says who was already on the list", { skip }, async () => {
  const r1 = await addPeople({ people: [{ email: addr("ann"), name: "Ann QA" }, { email: addr("bob") }] });
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.data.added, 2);
  assert.equal(b1.data.already_on_list, 0);

  const r2 = await addPeople({ people: [{ email: addr("ann").toUpperCase() }, { email: addr("cat"), name: "Cat QA" }] });
  const b2 = await r2.json();
  assert.equal(b2.data.added, 1);
  assert.equal(b2.data.already_on_list, 1);
  const rows = await m.db.query<{ source: string; name: string; email_hint: string; admission_status: string }>(
    "select source, name, email_hint, admission_status from roster_guests where email_hash = any($1::text[]) order by id",
    [[hash(addr("ann")), hash(addr("bob"))]],
  );
  assert.deepEqual(
    rows.map((r) => [r.source, r.name, r.admission_status]),
    [
      ["api", "Ann QA", "admitted"],
      ["api", `${tag}.bob`, "admitted"],
    ],
  );
  assert.doesNotMatch(rows[0].email_hint, new RegExp(tag), "the roster keeps a masked hint, never the address");
});

test("an email that isn't on the list gets no code and no email", { skip }, async () => {
  const before = mail().sent.length;
  const res = await askCoupon(addr("zed"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "needs_action");
  assert.equal(body.data.outcome, "not_on_list");
  assert.equal(mail().sent.length, before);
});

test("someone on the list gets a code by email, and the response never carries it", { skip }, async () => {
  const pool = await available();
  const res = await askCoupon(`  ${addr("ann").toUpperCase()} `);
  assert.equal(res.status, 200);
  const raw = await res.text();
  const body = JSON.parse(raw);
  assert.equal(body.status, "ok");
  assert.equal(body.data.outcome, "sent");
  assert.equal(body.data.resent, false);

  const [k] = await codeFor(addr("ann"));
  assert.ok(k, "a code is mapped to Ann's roster row");
  assert.equal(k.assigned_by, "email");
  assert.equal(k.email_count, 1);
  assert.ok(k.emailed_at);
  assert.equal(await available(), pool - 1);
  assert.ok(!raw.includes(k.code), "the code only goes to the inbox");

  const last = mail().sent.at(-1)!;
  assert.equal(last.to, addr("ann"));
  assert.match(last.text, new RegExp(k.code));
  assert.match(last.text, /^Hi Ann QA,/);
});

test("asking again re-sends the same code instead of taking another", { skip }, async () => {
  const pool = await available();
  const [first] = await codeFor(addr("ann"));
  const body = await (await askCoupon(addr("ann"))).json();
  assert.equal(body.data.outcome, "sent");
  assert.equal(body.data.resent, true);
  const rows = await codeFor(addr("ann"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, first.code);
  assert.equal(rows[0].email_count, 2);
  assert.equal(await available(), pool);
  assert.match(mail().sent.at(-1)!.text, new RegExp(first.code));
});

test("more than three requests an hour for one address are refused", { skip }, async () => {
  assert.equal((await askCoupon(addr("ann"))).status, 200);
  const res = await askCoupon(addr("ann"));
  assert.equal(res.status, 429);
  assert.equal((await codeFor(addr("ann")))[0].email_count, 3);
});

test("a member who already had a code from the old flow is sent that same code", { skip }, async () => {
  const [mem] = await m.db.query<{ id: number }>("insert into members (team_id, name, email, email_hash) values (null, 'Dee QA', $1, $2) returning id", [addr("dee"), hash(addr("dee"))]);
  const [old] = await m.db.query<{ code: string }>(
    `update codex_credit_codes set status = 'assigned', assigned_member_id = $1, assigned_at = now(), assigned_by = 'system'
      where id = (select id from codex_credit_codes where code like 'QA-${tag}-%' and status = 'available' order by id limit 1) returning code`,
    [mem.id],
  );
  await addPeople({ email: addr("dee"), name: "Dee QA" });
  const pool = await available();
  const body = await (await askCoupon(addr("dee"))).json();
  assert.equal(body.data.outcome, "sent");
  assert.equal(await available(), pool, "no second code");
  const [k] = await codeFor(addr("dee"));
  assert.equal(k.code, old.code);
  assert.equal(k.assigned_member_id, mem.id);
  assert.match(mail().sent.at(-1)!.text, new RegExp(old.code));
});

test("a new code is linked to the member with that email, so /ops/activation shows it", { skip }, async () => {
  const [mem] = await m.db.query<{ id: number }>("insert into members (team_id, name, email, email_hash) values (null, 'Hal QA', $1, $2) returning id", [addr("hal"), hash(addr("hal"))]);
  await addPeople({ email: addr("hal") });
  assert.equal((await (await askCoupon(addr("hal"))).json()).data.outcome, "sent");
  assert.equal((await codeFor(addr("hal")))[0].assigned_member_id, mem.id);
});

test("someone an organizer revoked gets nothing", { skip }, async () => {
  await addPeople({ email: addr("eve") });
  await m.db.query("update roster_guests set admission_status = 'revoked' where email_hash = $1", [hash(addr("eve"))]);
  const before = mail().sent.length;
  const body = await (await askCoupon(addr("eve"))).json();
  assert.equal(body.data.outcome, "not_on_list");
  assert.equal(mail().sent.length, before);
  assert.equal((await codeFor(addr("eve"))).length, 0);
});

test("an empty pool says so and sends nothing", { skip }, async () => {
  await addPeople({ email: addr("fay") });
  const held = await m.db.query<{ id: number }>(
    `update codex_credit_codes set status = 'revoked', revoked_reason = 'qa hold ${tag}' where status = 'available' and event_id = current_event_id() returning id`,
  );
  try {
    const before = mail().sent.length;
    const body = await (await askCoupon(addr("fay"))).json();
    assert.equal(body.status, "needs_action");
    assert.equal(body.data.outcome, "out_of_codes");
    assert.equal(mail().sent.length, before);
  } finally {
    await m.db.query("update codex_credit_codes set status = 'available', revoked_reason = null, revoked_at = null where id = any($1::bigint[])", [held.map((h) => h.id)]);
  }
});

test("without SMTP settings nothing is taken from the pool", { skip }, async () => {
  await addPeople({ email: addr("gus") });
  delete process.env.SMTP_USER;
  try {
    const res = await askCoupon(addr("gus"));
    assert.equal(res.status, 503);
    assert.equal((await codeFor(addr("gus"))).length, 0);
  } finally {
    Object.assign(process.env, SMTP);
  }
});

test("a failed send keeps the code for that person and a retry sends it", { skip }, async () => {
  await addPeople({ email: addr("ivy") });
  mail().fail = true;
  try {
    const res = await askCoupon(addr("ivy"));
    assert.equal(res.status, 503);
  } finally {
    mail().fail = false;
  }
  const [k] = await codeFor(addr("ivy"));
  assert.equal(k.email_count, 0);
  const body = await (await askCoupon(addr("ivy"))).json();
  assert.equal(body.data.outcome, "sent");
  assert.equal(body.data.resent, false, "the first email never went out");
  const rows = await codeFor(addr("ivy"));
  assert.equal(rows[0].code, k.code);
  assert.equal(rows[0].email_count, 1);
});

test("the organizer export names who each emailed code went to", { skip }, async () => {
  const rows = await m.activation.exportCodexCodes({ id: null, name: "QA", email: null, role: "admin" } as never);
  const [k] = await codeFor(addr("ann"));
  const row = rows.find((r) => r.code === k.code)!;
  assert.equal(row.name, "Ann QA");
  assert.ok(row.email, "an email (or its hint) for the person");
  assert.equal(row.email_count, 3);
});

test("the event tool emails the signed-in member's address by default, or the one they registered with", { skip }, async () => {
  assert.ok((m.mcp.MCP_TOOL_NAMES as readonly string[]).includes("codex_coupon_send"));
  const [row] = await m.db.query("insert into members (team_id, name, email, email_hash) values (null, 'Jo QA', $1, $2) returning *", [addr("jo"), hash(addr("jo"))]);
  const ctx = { member: row as never, actor: { type: "member" as const, id: (row as { id: number }).id }, requestId: "qa" };
  // Signed in as jo@, but registered for the event as jo.luma@.
  await addPeople({ email: addr("jo.luma"), name: "Jo QA" });
  assert.equal((await m.A.sendCodexCoupon(ctx)).outcome, "not_on_list");
  const r = await m.A.sendCodexCoupon(ctx, addr("jo.luma"));
  assert.equal(r.outcome, "sent");
  assert.equal(mail().sent.at(-1)!.to, addr("jo.luma"));
});

test("when the roster row and the member each hold a code, the roster row's code is the one re-sent", { skip }, async () => {
  await addPeople({ email: addr("kim"), name: "Kim QA" });
  const [g] = await m.db.query<{ id: number }>("select id from roster_guests where email_hash = $1", [hash(addr("kim"))]);
  const [mem] = await m.db.query<{ id: number }>("insert into members (team_id, name, email, email_hash) values (null, 'Kim QA', $1, $2) returning id", [addr("kim"), hash(addr("kim"))]);
  const take = async (set: string, params: unknown[]) =>
    (await m.db.query<{ code: string }>(
      `update codex_credit_codes set status = 'assigned', ${set} where id = (select id from codex_credit_codes where code like 'QA-${tag}-%' and status = 'available' order by id limit 1) returning code`,
      params,
    ))[0];
  // The member's (older) code from a staff reassignment, and a newer one already emailed to the roster row.
  await take("assigned_member_id = $1, assigned_at = now() - interval '1 hour', assigned_by = 'staff:1'", [mem.id]);
  const mine = await take("assigned_guest_id = $1, assigned_at = now(), assigned_by = 'email', email_count = 1", [g.id]);
  const res = await askCoupon(addr("kim"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.outcome, "sent");
  assert.match(mail().sent.at(-1)!.text, new RegExp(mine.code));
});

test("asking for an address that isn't on the list doesn't use up its hourly limit", { skip }, async () => {
  for (let i = 0; i < 4; i++) assert.equal((await (await askCoupon(addr("lee"))).json()).data.outcome, "not_on_list");
  // Added at the help desk after a few tries: the next request goes through.
  await addPeople({ email: addr("lee") });
  const res = await askCoupon(addr("lee"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.outcome, "sent");
});

test("the event tool takes at most 10 requests an hour from one member", { skip }, async () => {
  const [row] = await m.db.query("insert into members (team_id, name, email, email_hash) values (null, 'Max QA', $1, $2) returning *", [addr("max"), hash(addr("max"))]);
  const ctx = { member: row as never, actor: { type: "member" as const, id: (row as { id: number }).id }, requestId: "qa" };
  for (let i = 0; i < 10; i++) assert.equal((await m.A.sendCodexCoupon(ctx, `${tag}.probe${i}@example.test`)).outcome, "not_on_list");
  await assert.rejects(m.A.sendCodexCoupon(ctx, `${tag}.probe10@example.test`), (e: { code?: string }) => e.code === "RATE_LIMITED");
});
