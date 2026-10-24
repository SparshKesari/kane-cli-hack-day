// Everyone at the venue shares one public IP. The sign-in form and /register's proof step were
// capped at 10 tries per IP per 5 minutes, so the 11th person in the room got "Too many tries".
// Guessing one account's password stays capped, per email.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

type Mods = {
  db: typeof import("../../src/lib/db.ts");
  login: typeof import("../../src/app/passport/login/actions.ts");
  register: typeof import("../../src/app/register/actions.ts");
  jar: Map<string, string>;
};
let m: Mods;
const tag = `vn${Date.now().toString(36)}p${process.pid.toString(36)}`;
const PW = `pw-${tag}-venue`;
const TOO_MANY = /Too many tries/;

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  const [db, login, register, headers] = await Promise.all([
    import("../../src/lib/db.ts"),
    import("../../src/app/passport/login/actions.ts"),
    import("../../src/app/register/actions.ts"),
    import("../support/stubs/next-headers.mjs"),
  ]);
  m = { db, login, register, jar: headers.jar };
  await db.query("delete from rate_limit_buckets where bucket like 'member-login%' or bucket like 'register-proof%'");
});

after(async () => {
  if (skip || !m) return;
  await m.db.pool.end().catch(() => {});
});

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
/** Run a server action; a redirect (success) comes back as null. */
const act = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (String((e as { digest?: string }).digest ?? "").startsWith("NEXT_REDIRECT")) return null;
    throw e;
  }
};

test("twelve people registering from one IP with a proof password all get through", { skip }, async () => {
  for (let i = 0; i < 12; i++) {
    m.jar.clear(); // separate laptops
    const r = await act(() =>
      m.register.profileAction(null, form({ name: `Venue ${i}`, email: `${tag}.r${i}@example.test`, linkedin: `venue-${i}`, x: `@venue${i}`, password: PW, proof_password: PW })),
    );
    assert.doesNotMatch(r?.error ?? "", TOO_MANY, `registration ${i + 1}`);
  }
});

test("twelve people signing in from one IP all get through", { skip }, async () => {
  for (let i = 0; i < 12; i++) {
    m.jar.clear();
    const r = await act(() => m.login.personalLogin(null, form({ email: `${tag}.r${i}@example.test`, password: PW })));
    assert.equal(r, null, `sign-in ${i + 1}: ${JSON.stringify(r)}`);
  }
});

test("guessing one account's password is still capped at 10 tries", { skip }, async () => {
  const errors: string[] = [];
  for (let i = 0; i < 11; i++) {
    m.jar.clear();
    const r = await act(() => m.login.personalLogin(null, form({ email: `${tag}.guessed@example.test`, password: `wrong-${i}-password` })));
    errors.push(r?.error ?? "");
  }
  assert.ok(errors.slice(0, 10).every((e) => !TOO_MANY.test(e)), JSON.stringify(errors));
  assert.match(errors[10], TOO_MANY);
});
