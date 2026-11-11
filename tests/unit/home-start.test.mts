// The homepage starts people with the install command and $hack-os in Codex, not on a
// sign-in page: no "Sign in" in the homepage calls to action or the signed-out navbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ctas, setup, startCommands } from "../../src/data/hackday.ts";

test("the SF install command stays in its sign-off; the hero leads to online registration", () => {
  assert.equal(startCommands.unix, "curl -fsSL https://kaneclihack.sh/install.sh | sh");
  assert.equal(startCommands.windows, "irm https://www.kaneclihack.sh/install.ps1 | iex", "the form install.ps1 and the skill give");
  // The SF sign-off still carries the install command. The hero is the online hackathon's
  // now (the homepage is its landing page): it sends people to register, not to install.
  const closer = readFileSync("src/components/home/Closer.tsx", "utf8");
  assert.match(closer, /<StartCommand/);
  const hero = readFileSync("src/components/Hero.tsx", "utf8");
  assert.doesNotMatch(hero, /<StartCommand/, "no SF install command in the online hero");
  assert.match(hero, /href="\/o\/register"/, "the hero's first call to action is registration");
  for (const src of [closer, hero]) assert.doesNotMatch(src, /ctas\.login|passport\/login/);
  assert.match(readFileSync("src/components/home/StartCommand.tsx", "utf8"), /\$hack-os/);
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
