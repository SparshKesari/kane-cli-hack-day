// Kane CLI runs on LT_USERNAME / LT_ACCESS_KEY, and kanehack sends whatever TestMu AI key it
// finds (kanehack login, TESTMU_*, LT_*). In production there is no TestMu verifier and the
// site only knows keys it stored at activation, so most keys can't be checked at all. While
// the key switch (TESTMU_KEY_REQUIRED) is off, such a key must be ignored, not answered with
// TESTMU_KEY_REQUIRED: that locked every Kane CLI user out of `kanehack pair`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const QA = process.env.QA_DATABASE_URL;
const LIVE = process.env.DATABASE_URL;
const skip = !QA ? "QA_DATABASE_URL not set" : QA === LIVE ? "QA_DATABASE_URL equals DATABASE_URL: refusing to touch the live database" : false;

const saved = { ...process.env };
let proxy: typeof import("../../src/proxy.ts").proxy;
let PRINCIPAL_HEADER: string;

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = QA;
  process.env.SESSION_SECRET ||= "qa-session-secret-not-for-production";
  process.env.HACKOS_ENV = "production";
  delete process.env.TESTMU_VERIFY_URL;
  delete process.env.TESTMU_KEY_REQUIRED;
  ({ proxy } = await import("../../src/proxy.ts"));
  ({ PRINCIPAL_HEADER } = await import("../../src/lib/testmu-gate.ts"));
});

after(() => {
  process.env = saved;
});

// A fresh key every time, so the proxy's per-key cache can't answer from an earlier test.
const pairStart = () =>
  new NextRequest("http://localhost/api/v1/pair/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-testmu-username": "kane-user", "x-testmu-access-key": `LT_${randomUUID()}` },
    body: "{}",
  });

test("keys off: a key nobody can check is ignored, so pairing goes through with no TestMu principal", { skip }, async () => {
  const res = await proxy(pairStart());
  assert.notEqual(res.status, 401);
  assert.equal(res.headers.get("x-middleware-next"), "1", "the request continues to the route");
  assert.equal(res.headers.get(`x-middleware-request-${PRINCIPAL_HEADER.toLowerCase()}`), null, "nobody is signed in by that key");
});

test("keys on: a key nobody can check is still refused", { skip }, async () => {
  process.env.TESTMU_KEY_REQUIRED = "true";
  try {
    const res = await proxy(pairStart());
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "TESTMU_KEY_REQUIRED");
  } finally {
    delete process.env.TESTMU_KEY_REQUIRED;
  }
});
