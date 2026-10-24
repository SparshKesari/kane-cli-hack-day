// Event-day activation rules that need no database: how the TestMu AI claim
// API's answers map to what a participant sees, and how a Codex credit code
// upload is parsed, deduped and masked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimErrorText, mapClaimResponse, redactClaimBody } from "../../src/lib/testmu-claim.ts";
import { maskCode, parseCodexCodes, splitCsvLine } from "../../src/lib/codex-codes.ts";

test("any 2xx is a claim", () => {
  for (const s of [200, 201, 204]) assert.equal(mapClaimResponse(s, { ok: true }).outcome, "claimed");
  assert.equal(mapClaimResponse(200, undefined).outcome, "claimed");
});

test("404 and 'user/account not found' 4xx answers mean: register with TestMu AI first", () => {
  assert.equal(mapClaimResponse(404, null).outcome, "not_registered");
  assert.equal(mapClaimResponse(422, { code: "USER_NOT_FOUND" }).outcome, "not_registered");
  assert.equal(mapClaimResponse(400, { code: "NOT_REGISTERED" }).outcome, "not_registered");
  assert.equal(mapClaimResponse(422, { code: "INVALID_REQUEST", errors: { email: ["No account exists for this email."] } }).outcome, "not_registered");
  assert.equal(mapClaimResponse(422, { errors: { email: ["This user does not exist"] } }).outcome, "not_registered");
  assert.equal(mapClaimResponse(400, { message: "Account not found" }).outcome, "not_registered");
});

test("NON_SIGNEDUP means not signed up, even with a 2xx", () => {
  const body = { code: "NON_SIGNEDUP", message: "Claim recorded. Trial will be activated after signup." };
  for (const s of [200, 201, 202, 400, 404, 422]) assert.equal(mapClaimResponse(s, body).outcome, "not_registered");
  assert.match(mapClaimResponse(200, body).detail ?? "", /HTTP 200 · NON_SIGNEDUP · Claim recorded/);
  assert.equal(mapClaimResponse(200, { status: "success" }).outcome, "claimed");
});

test("everything else is a plain error with a detail for staff", () => {
  // The documented empty-email answer is a request problem, not an unknown user.
  const empty = mapClaimResponse(422, { code: "INVALID_REQUEST", errors: { email: ["The email field is required."] } });
  assert.equal(empty.outcome, "error");
  assert.match(empty.detail ?? "", /HTTP 422 · INVALID_REQUEST · email: The email field is required\./);
  assert.equal(mapClaimResponse(422, { code: "ALREADY_CLAIMED", errors: { email: ["A trial was already claimed for this account."] } }).outcome, "error");
  assert.equal(mapClaimResponse(500, { code: "BOOM" }).outcome, "error");
  assert.equal(mapClaimResponse(503, undefined).detail, "HTTP 503 · malformed response");
  assert.equal(mapClaimResponse(401, { message: "Unauthorized" }).outcome, "error");
  assert.equal(mapClaimResponse(429, {}).outcome, "error");
  const timeout = mapClaimResponse(null, undefined, "timeout");
  assert.deepEqual(timeout, { outcome: "error", detail: "timeout", reason: "retry" });
});

// The live API (Hack Day 2026 FE spec): POST {email, password, …}; several outcomes are HTTP 200.
const live = (code: string, extra: Record<string, unknown> = {}) => ({ code, message: "m", user_id: 1, username: "jane", access_token: "tok-secret", organization_id: 7, ...extra });

test("the live API's four success codes are a claim", () => {
  for (const c of ["SIGNEDUP", "JOINED_TEAM", "ALREADY_CLAIMED", "ALREADY_ACTIVE"]) assert.equal(mapClaimResponse(200, live(c)).outcome, "claimed", c);
});

test("INELIGIBLE is not a claim, even with a 200", () => {
  const r = mapClaimResponse(200, { code: "INELIGIBLE", message: "This account is not eligible for the Hack Day trial." });
  assert.equal(r.outcome, "error");
  assert.equal(r.reason, "ineligible");
});

test("an unknown code with a 2xx is not a claim", () => {
  assert.equal(mapClaimResponse(200, { code: "SOMETHING_NEW" }).outcome, "error");
});

test("a wrong password for an existing account says so", () => {
  const r = mapClaimResponse(401, { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." });
  assert.equal(r.outcome, "error");
  assert.equal(r.reason, "wrong_password");
});

test("field errors come back to the person", () => {
  const r = mapClaimResponse(422, { code: "INVALID_REQUEST", errors: { password: ["The password must be at least 8 characters."] } });
  assert.equal(r.outcome, "error");
  assert.equal(r.reason, "invalid");
  assert.deepEqual(r.fields, ["The password must be at least 8 characters."]);
});

test("region, campaign end, rate limit and FAILED each say what happened", () => {
  assert.equal(mapClaimResponse(403, { code: "REGION_NOT_SUPPORTED", message: "US only" }).reason, "region");
  assert.equal(mapClaimResponse(410, { code: "CAMPAIGN_ENDED" }).reason, "ended");
  assert.equal(mapClaimResponse(429, { message: "Too Many Attempts." }).reason, "retry");
  assert.equal(mapClaimResponse(502, { code: "FAILED" }).reason, "retry");
  assert.equal(mapClaimResponse(null, undefined, "network error").reason, "retry");
});

test("credentials in the API's answer are never stored or shown to staff", () => {
  const stored = JSON.stringify(redactClaimBody(live("SIGNEDUP", { nested: { password: "p", accessKey: "k" } })));
  for (const s of ["tok-secret", "\"p\"", "\"k\""]) assert.ok(!stored.includes(s), `${s} in ${stored}`);
  assert.match(stored, /"code":"SIGNEDUP"/);
  assert.match(stored, /"username":"jane"/);
  assert.ok(!(mapClaimResponse(401, { code: "INVALID_CREDENTIALS", access_token: "tok-secret" }).detail ?? "").includes("tok-secret"));
});

test("claim error text flattens code, message and field errors", () => {
  assert.equal(claimErrorText({ code: "X", errors: { email: ["a", "b"] } }), "X · email: a · email: b");
  assert.equal(claimErrorText("nope"), "");
});

test("a CSV with a code column keeps the other columns as extra", () => {
  const p = parseCodexCodes('﻿Amount,Code,Notes\n250,ABCD-1111,"first, batch"\n250,ABCD-2222,\n');
  assert.deepEqual(p.rows, [
    { code: "ABCD-1111", extra: { Amount: "250", Notes: "first, batch" } },
    { code: "ABCD-2222", extra: { Amount: "250" } },
  ]);
  assert.equal(p.duplicatesInFile, 0);
  assert.deepEqual(p.invalid, []);
});

test("one code per line, with duplicates and invalid lines counted", () => {
  const p = parseCodexCodes("CDX-AAAA-0001\n\nCDX-AAAA-0002\r\nCDX-AAAA-0001\nbad code!\nab\n");
  assert.deepEqual(p.rows.map((r) => r.code), ["CDX-AAAA-0001", "CDX-AAAA-0002"]);
  assert.equal(p.duplicatesInFile, 1);
  assert.deepEqual(p.invalid.map((i) => i.line), [5, 6]);
  assert.deepEqual(parseCodexCodes("   \n").rows, []);
});

test("csv splitting honours quotes and masking shows only the last four", () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d""e"'), ["a", "b,c", 'd"e']);
  assert.equal(maskCode("CDX-1234-9F2A"), "••••-9F2A");
});
