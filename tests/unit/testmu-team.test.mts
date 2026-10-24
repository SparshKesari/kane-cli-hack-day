// TestMu AI Hack Day team sync without a network or database: the invite API's answers
// for every code in the contract, Retry-After, when the sync carries on, what the
// captain reads, and where invites go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteResultFrom, retryAfterSeconds, syncContinues, teamSyncMessage } from "../../src/lib/testmu-team.ts";

test("added, invited and already-in-team are done, with the organization", () => {
  for (const code of ["MEMBER_ADDED", "MEMBER_INVITED", "ALREADY_IN_TEAM"]) {
    assert.deepEqual(inviteResultFrom(200, { code, message: "m", organization_id: 7654321 }, null), { code, done: true, message: "m", organizationId: 7654321, retryAfter: null });
  }
});

test("every refusal in the contract keeps its code and is not done", () => {
  const refusals = [
    [401, "INVALID_CREDENTIALS"],
    [403, "NOT_TEAM_LEAD"],
    [403, "INELIGIBLE"],
    [403, "NOT_HACK_DAY_ORG"],
    [409, "MEMBER_IN_ANOTHER_TEAM"],
    [409, "ALREADY_INVITED"],
    [409, "TEAM_FULL"],
    [422, "INVALID_REQUEST"],
    [403, "REGION_NOT_SUPPORTED"],
    [410, "CAMPAIGN_ENDED"],
  ] as const;
  for (const [status, code] of refusals) {
    const r = inviteResultFrom(status, { code, message: "m" }, null);
    assert.equal(r.code, code);
    assert.equal(r.done, false, code);
  }
});

test("a done code on a non-2xx, or 2xx without a known code, is not done", () => {
  assert.equal(inviteResultFrom(409, { code: "MEMBER_ADDED" }, null).done, false);
  assert.deepEqual(inviteResultFrom(200, null, null), { code: "HTTP_200", done: false, message: null, organizationId: null, retryAfter: null });
});

test("429 is RATE_LIMITED with Retry-After in seconds, and a 5xx is UNAVAILABLE", () => {
  assert.deepEqual(inviteResultFrom(429, { message: "Too Many Attempts." }, "9"), { code: "RATE_LIMITED", done: false, message: "Too Many Attempts.", organizationId: null, retryAfter: 9 });
  assert.equal(inviteResultFrom(429, {}, null).retryAfter, 60);
  assert.equal(inviteResultFrom(503, null, null).code, "UNAVAILABLE");
});

test("Retry-After: seconds, an HTTP date, or a default", () => {
  assert.equal(retryAfterSeconds("7"), 7);
  assert.equal(retryAfterSeconds("0.2"), 1);
  const at = retryAfterSeconds(new Date(Date.now() + 30_000).toUTCString());
  assert.ok(at >= 29 && at <= 31, String(at));
  assert.equal(retryAfterSeconds(null), 60);
  assert.equal(retryAfterSeconds("soon"), 60);
});

test("the sync carries on past answers about one teammate and stops on the captain or TestMu AI", () => {
  for (const code of ["MEMBER_ADDED", "MEMBER_INVITED", "ALREADY_IN_TEAM", "NOT_HACK_DAY_ORG", "MEMBER_IN_ANOTHER_TEAM", "ALREADY_INVITED", "INELIGIBLE", "INVALID_REQUEST"]) assert.equal(syncContinues(code), true, code);
  for (const code of ["INVALID_CREDENTIALS", "NOT_TEAM_LEAD", "TEAM_FULL", "RATE_LIMITED", "UNAVAILABLE", "CAMPAIGN_ENDED", "REGION_NOT_SUPPORTED", "HTTP_404"]) assert.equal(syncContinues(code), false, code);
});

test("the captain reads clear text for each problem, naming the teammate where it's about them", () => {
  assert.match(teamSyncMessage("NOT_TEAM_LEAD", "Ann"), /isn’t the admin of its own Hack Day account.*help desk/);
  assert.match(teamSyncMessage("MEMBER_IN_ANOTHER_TEAM", "Ann"), /^Ann already belongs to another TestMu AI team/);
  assert.match(teamSyncMessage("ALREADY_INVITED", "Ann"), /^Ann was already invited to another TestMu AI team/);
  assert.match(teamSyncMessage("NOT_HACK_DAY_ORG", "Ann"), /^Ann has a TestMu AI account .*step 2 on \/activate/);
  assert.match(teamSyncMessage("TEAM_FULL", "Ann"), /already has 4 people/);
  assert.match(teamSyncMessage("INVALID_CREDENTIALS", "Ann"), /didn’t accept that password/);
  assert.match(teamSyncMessage("RATE_LIMITED", "Ann"), /slow down/);
  assert.match(teamSyncMessage("MEMBER_INVITED", "Ann"), /Joins your TestMu AI team when they activate/);
  assert.equal(teamSyncMessage(null, "Ann"), "Not added to your TestMu AI team yet.");
  assert.match(teamSyncMessage("UNAVAILABLE", "Ann"), /couldn’t reach TestMu AI/);
});

test("invites go to the real API only in production, and never to it anywhere else", async () => {
  const { inviteTarget, TESTMU_INVITE_DEFAULT_URL } = await import("../../src/server/testmu-team.ts");
  const saved = { ...process.env };
  try {
    delete process.env.HACKOS_ENV;
    delete process.env.TESTMU_TEAM_INVITE_URL;
    delete process.env.TESTMU_TEAM_INVITE_STUB;
    process.env.VERCEL_ENV = "production";
    assert.deepEqual(inviteTarget(), { kind: "http", url: TESTMU_INVITE_DEFAULT_URL });
    assert.equal(TESTMU_INVITE_DEFAULT_URL, "https://backend.lambdatest.com/api/trials/hack-day/team/invite");
    process.env.TESTMU_TEAM_INVITE_URL = "https://backend.lambdatest.com/other";
    assert.deepEqual(inviteTarget(), { kind: "http", url: "https://backend.lambdatest.com/other" });
    process.env.VERCEL_ENV = "preview";
    assert.deepEqual(inviteTarget(), { kind: "stub", code: "MEMBER_ADDED" }, "a preview never calls lambdatest.com");
    process.env.TESTMU_TEAM_INVITE_STUB = "team_full";
    assert.deepEqual(inviteTarget(), { kind: "stub", code: "TEAM_FULL" });
    process.env.TESTMU_TEAM_INVITE_URL = "http://127.0.0.1:3105/api/trials/hack-day/team/invite";
    assert.deepEqual(inviteTarget(), { kind: "http", url: "http://127.0.0.1:3105/api/trials/hack-day/team/invite" }, "a mock host is called");
  } finally {
    process.env = saved;
  }
});
