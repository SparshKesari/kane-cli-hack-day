// The homepage starts people with the install command and $hack-os in Codex, not on a
// sign-in page: no "Sign in" in the homepage calls to action or the signed-out navbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ctas, setup, startCommands } from "../../src/data/hackday.ts";

test("the homepage leads with the install command, then $hack-os in Codex", () => {
  assert.equal(startCommands.unix, "curl -fsSL https://kaneclihack.sh/install.sh | sh");
  assert.equal(startCommands.windows, "irm https://www.kaneclihack.sh/install.ps1 | iex", "the form install.ps1 and the skill give");
  for (const file of ["src/components/Hero.tsx", "src/components/home/Closer.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /<StartCommand/, file);
    assert.doesNotMatch(src, /ctas\.login|passport\/login/, file);
  }
  assert.match(readFileSync("src/components/home/StartCommand.tsx", "utf8"), /\$hack-os/);
  assert.match(readFileSync("src/components/Hero.tsx", "utf8"), /<StartCommand id="start"/, "the hero holds the #start anchor");
  const install = setup.find((s) => s.id === "install");
  assert.equal(install?.value, startCommands.unix);
  assert.match(install?.body ?? "", /\$hack-os/);
});

test("no sign-in option in the homepage calls to action or the signed-out navbar", () => {
  assert.equal("login" in ctas, false);
  assert.equal(ctas.register.href, "/#start");
  const signedOut = readFileSync("src/components/Account.tsx", "utf8").split("export function SignedOut")[1];
  assert.doesNotMatch(signedOut, /passport\/login|Sign in/);
  assert.match(signedOut, /href="\/#start"/);
});

test("the footer links to the install command, not to sign-in or /register", () => {
  const footer = readFileSync("src/components/Footer.tsx", "utf8");
  assert.doesNotMatch(footer, /passport\/login|"\/register"|Sign in/);
  assert.match(footer, /href: "\/#start"/);
});
