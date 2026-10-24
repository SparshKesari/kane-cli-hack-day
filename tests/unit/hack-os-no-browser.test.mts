// hack-os runs the whole participant flow from Codex: the password is typed once in the
// person's own terminal (`kanehack password`), then register / signin / claim and the event
// tools do the rest. A Codex e2e run went to the browser for sign-up, pairing, activation and
// the idea, because the skill told it to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (base: string, f: string) => readFileSync(`${base}/hack-os/${f}`, "utf8");

for (const base of ["plugin/skills", ".agents/skills"]) {
  test(`${base}: SKILL.md prefers tools and kanehack over the browser, and the password stays in the terminal`, () => {
    const md = read(base, "SKILL.md");
    assert.match(md, /`kanehack password`[^\n]*own terminal/);
    assert.match(md, /not the browser/i);
  });

  test(`${base}: sign-up is kanehack register, sign-in is kanehack signin; pairing is only the fallback`, () => {
    const setup = read(base, "references/setup.md");
    const signup = read(base, "references/signup-team.md");
    assert.match(signup, /kanehack register --name/);
    assert.doesNotMatch(signup, /There is no sign-up in this chat/);
    assert.match(setup, /kanehack signin --email/);
    assert.match(setup, /kanehack password --check --json/);
    assert.ok(setup.indexOf("kanehack signin") < setup.indexOf("kanehack pair --start"), "signin comes before pairing");
    assert.match(setup, /fallback/i);
  });

  test(`${base}: the captain locks the team with team_lock`, () => {
    const md = read(base, "references/signup-team.md");
    assert.match(md, /`team_lock`/);
    assert.doesNotMatch(md, /The skill can't lock it/);
  });

  test(`${base}: activation is kanehack claim + activation_tick, read back from activation_steps`, () => {
    const md = read(base, "references/activate.md");
    assert.match(md, /kanehack claim --json/);
    assert.match(md, /`activation_tick`/);
    assert.match(md, /activation_steps/);
    assert.doesNotMatch(md, /The skill can't see these steps/);
  });

  test(`${base}: the idea is saved with idea_save after a yes`, () => {
    const md = read(base, "references/idea.md");
    assert.match(md, /`idea_save`/);
    assert.doesNotMatch(md, /The skill can't save it for them/);
  });
}
