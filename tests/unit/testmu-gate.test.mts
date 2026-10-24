// The TestMu AI access-key gate rules that need no database or network: which
// paths it covers, how credentials are read from headers, and the signed
// cookie / principal that stand in for the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  classifyPath,
  credentialsFrom,
  hasStaffCookie,
  keyFingerprint,
  keyRequired,
  publicApiPrefixes,
  signValue,
  unsignValue,
} from "../../src/lib/testmu-gate.ts";
import { emailFrom } from "../../src/lib/testmu-verify.ts";

const KEY = "test-secret";

test("the switch reads TESTMU_KEY_REQUIRED and defaults to off", () => {
  assert.equal(keyRequired({}), false);
  assert.equal(keyRequired({ TESTMU_KEY_REQUIRED: "false" }), false);
  for (const v of ["true", "1", "on", "YES"]) assert.equal(keyRequired({ TESTMU_KEY_REQUIRED: v }), true);
});

test("the handshake, docs, cron and webhooks are never gated", () => {
  for (const p of ["/api/v1/auth/testmu/start", "/api/v1/auth/testmu/callback", "/api/v1/openapi.json", "/api/docs", "/api/cron/outbox", "/webhooks/github", "/api/import/photo"]) {
    assert.equal(classifyPath(p, {}), "open", p);
  }
});

test("API routes and /mcp are gated; public aggregates are not unless configured", () => {
  assert.equal(classifyPath("/api/v1/teams/join", {}), "api");
  assert.equal(classifyPath("/mcp", {}), "api");
  assert.equal(classifyPath("/api/upload", {}), "api");
  assert.equal(classifyPath("/api/v1/live/metrics", {}), "public_api");
  assert.equal(classifyPath("/api/v1/dashboard", {}), "public_api");
  assert.equal(classifyPath("/api/v1/live/metrics", { TESTMU_KEY_PUBLIC_PATHS: "none" }), "api");
  assert.deepEqual(publicApiPrefixes({ TESTMU_KEY_PUBLIC_PATHS: "/api/v1/live/, nope" }), ["/api/v1/live/"]);
});

test("participant pages are gated; the landing page, Ship Pages, TV and ops are not", () => {
  for (const p of ["/register", "/team", "/t/orbit/idea", "/studio/orbit", "/passport", "/activate", "/setup"]) assert.equal(classifyPath(p, {}), "page", p);
  for (const p of ["/", "/ship/orbit", "/live", "/dashboard", "/ops/checkin", "/judge", "/privacy", "/teams-list"]) assert.equal(classifyPath(p, {}), "other", p);
});

test("credentials come from X-TestMu headers or Basic auth, never from a bearer token", () => {
  assert.deepEqual(credentialsFrom(new Headers({ "x-testmu-username": "alex", "x-testmu-access-key": "k1" })), { username: "alex", accessKey: "k1" });
  const basic = Buffer.from("alex@example.com:k:2").toString("base64");
  assert.deepEqual(credentialsFrom(new Headers({ authorization: `Basic ${basic}` })), { username: "alex@example.com", accessKey: "k:2" });
  assert.equal(credentialsFrom(new Headers({ authorization: "Bearer khk_abc" })), null);
  assert.equal(credentialsFrom(new Headers({ "x-testmu-username": "alex" })), null);
  assert.equal(credentialsFrom(new Headers({ authorization: `Basic ${Buffer.from("nokey:").toString("base64")}` })), null);
});

test("the fingerprint changes with the key and never contains it", () => {
  const a = keyFingerprint({ username: "alex", accessKey: "secret-key" });
  assert.notEqual(a, keyFingerprint({ username: "alex", accessKey: "rotated" }));
  assert.ok(!a.includes("secret-key"));
});

test("signed values round-trip, expire, and reject tampering or another secret", () => {
  const now = Date.now();
  const tok = signValue({ u: "alex", e: null, exp: now + 1000 }, KEY);
  assert.deepEqual(unsignValue(tok, now, KEY), { u: "alex", e: null, exp: now + 1000 });
  assert.equal(unsignValue(tok, now + 2000, KEY), null);
  assert.equal(unsignValue(tok, now, "other"), null);
  const [body, mac] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "mallory", e: null, exp: now + 1000 })).toString("base64url");
  assert.equal(unsignValue(`${forged}.${mac}`, now, KEY), null);
  assert.equal(unsignValue(`${body}`, now, KEY), null);
});

test("a gate cookie can't be replayed as a staff cookie (different signing key)", () => {
  const now = Date.now();
  const sessionStyle = (payload: object) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", KEY).update(body).digest("base64url")}`;
  };
  assert.equal(hasStaffCookie(sessionStyle({ staffId: 1, role: "mentor", exp: now + 1000 }), undefined, now, KEY), true);
  assert.equal(hasStaffCookie(sessionStyle({ staffId: 1, role: "mentor", exp: now - 1 }), undefined, now, KEY), false);
  assert.equal(hasStaffCookie(undefined, sessionStyle({ admin: true }), now, KEY), true);
  assert.equal(hasStaffCookie(signValue({ staffId: 1, exp: now + 1000 }, KEY), undefined, now, KEY), false);
});

test("the TestMu email is read from the common response shapes", () => {
  assert.equal(emailFrom({ email: "A@x.io" }), "a@x.io");
  assert.equal(emailFrom({ data: { email: "b@x.io" } }), "b@x.io");
  assert.equal(emailFrom({ data: { user: { email: "c@x.io" } } }), "c@x.io");
  assert.equal(emailFrom({ email: "not-an-email" }), null);
  assert.equal(emailFrom(null), null);
});
