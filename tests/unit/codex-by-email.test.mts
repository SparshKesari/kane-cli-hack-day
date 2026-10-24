// The OpenAI Codex coupon now arrives by email (to the address the person registered with),
// not from a code pool on /activate. The site, the hack-os skill and the installer's
// closing text say so; the installer's "Next" commands are terminal commands, not Codex prompts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIVATION_STEPS } from "../../src/data/activation-steps.ts";
import { setup } from "../../src/data/hackday.ts";

test("step 3 on /activate says the Codex coupon comes by email, with no code button", () => {
  const step3 = ACTIVATION_STEPS.find((s) => s.id === "codex_credits")!;
  assert.match(step3.body, /by email/i);
  assert.doesNotMatch(step3.body, /credit code/i);
  const page = readFileSync("src/app/activate/page.tsx", "utf8");
  assert.doesNotMatch(page, /<GetCodeButton/, "no code handout on the page");
  assert.match(page, /CODEX_BY_EMAIL\(email\)/, "the page shows which address the coupon goes to");
});

test("the /setup coupon step explains the email instead of a placeholder", () => {
  const coupon = setup.find((s) => s.id === "coupon")!;
  assert.doesNotMatch(coupon.body, /^\[/);
  assert.match(coupon.body, /email/i);
});

test("hack-os tells people the coupon arrives by email", () => {
  for (const base of ["plugin/skills", ".agents/skills"]) {
    const md = readFileSync(`${base}/hack-os/references/activate.md`, "utf8");
    assert.match(md, /by email/i, base);
    assert.doesNotMatch(md, /page shows their Codex credit code|no codes are left/i, base);
  }
});

test("the installer's next steps are terminal commands, and only $hack-os is in Codex", () => {
  for (const file of ["public/install.sh", "public/install.ps1"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /from Codex, no terminal/, file);
    assert.match(src, /Next, in this terminal:/, file);
    assert.match(src, /Then in Codex: start a new session and type \$hack-os/, file);
  }
});
