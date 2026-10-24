// TestMu AI activation rules that need no network: reading the account API's
// answer, and when activation runs at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activationEnabled, credentialsFromBody, provisionTestmuAccount } from "../../src/lib/testmu-provision.ts";

test("username + access key are read from the common answer shapes", () => {
  assert.deepEqual(credentialsFromBody({ username: "alex", access_key: "k1", email: "A@x.io" }), { username: "alex", accessKey: "k1", email: "a@x.io" });
  assert.deepEqual(credentialsFromBody({ data: { user_name: "alex", accessKey: "k2" } }), { username: "alex", accessKey: "k2", email: null });
  assert.equal(credentialsFromBody({ username: "alex" }), null);
  assert.equal(credentialsFromBody({ username: "", access_key: "k" }), null);
  assert.equal(credentialsFromBody(null), null);
});

test("activation is off in production until TestMu's endpoint is configured", () => {
  const saved = { ...process.env };
  try {
    process.env.VERCEL_ENV = "production";
    delete process.env.TESTMU_PROVISION_URL;
    assert.equal(activationEnabled(), false);
    process.env.TESTMU_PROVISION_URL = "https://testmu.example/provision";
    assert.equal(activationEnabled(), true);
    process.env.VERCEL_ENV = "preview";
    delete process.env.TESTMU_PROVISION_URL;
    assert.equal(activationEnabled(), true);
  } finally {
    process.env = saved;
  }
});

test("without an endpoint, production refuses and previews get a stub key", async () => {
  const saved = { ...process.env };
  const profile = { name: "Alex", email: "alex@x.io", linkedin: null, x: null, github: null, external_id: "member:7" };
  try {
    delete process.env.TESTMU_PROVISION_URL;
    process.env.VERCEL_ENV = "production";
    const prod = await provisionTestmuAccount(profile);
    assert.equal(prod.ok, false);
    process.env.VERCEL_ENV = "preview";
    const stub = await provisionTestmuAccount(profile);
    assert.ok(stub.ok && stub.username === "hack-member7" && stub.accessKey.startsWith("stub_"));
  } finally {
    process.env = saved;
  }
});
