// TestMu AI answering "Incorrect password for this account" (401) is never a dead end: the
// message and the skill give the way out. Reset that account's password (Google or GitHub
// sign-ups have none), save it with `kanehack password --testmu`, claim again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAN_MESSAGES, TESTMU_PASSWORD_RESET_URL } from "../../src/data/activation-steps.ts";

test("the wrong-password message links TestMu AI's password reset and covers Google sign-ups", () => {
  assert.equal(TESTMU_PASSWORD_RESET_URL, "https://accounts.lambdatest.com/password/reset");
  assert.ok(PLAN_MESSAGES.wrongPassword.includes(TESTMU_PASSWORD_RESET_URL));
  assert.match(PLAN_MESSAGES.wrongPassword, /different password/);
  assert.match(PLAN_MESSAGES.wrongPassword, /Google/);
});

test("hack-os: a refused TestMu AI password goes to a reset and kanehack password --testmu, not a ticket", () => {
  for (const base of ["plugin/skills", ".agents/skills"]) {
    const md = readFileSync(`${base}/hack-os/references/activate.md`, "utf8");
    assert.ok(md.includes(TESTMU_PASSWORD_RESET_URL), base);
    assert.match(md, /kanehack password --testmu/, base);
    assert.match(md, /Google/, base);
  }
});
