// The idea step must check the idea and then prompt by the result, and survive Codex's sandbox;
// every step the person does outside the chat ends with "type done".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (base: string, f: string) => readFileSync(`${base}/hack-os/${f}`, "utf8");

for (const base of ["plugin/skills", ".agents/skills"]) {
  test(`${base}: SKILL.md asks for "done" after any step the person does outside the chat, then checks it`, () => {
    const md = read(base, "SKILL.md");
    assert.match(md, /Type \*\*done\*\* here when it's finished/);
  });

  test(`${base}: SKILL.md says what to do when Codex's sandbox blocks a command`, () => {
    const md = read(base, "SKILL.md");
    assert.match(md, /sandbox/i);
    assert.match(md, /EPERM|operation not permitted/);
    assert.match(md, /UNREACHABLE/);
  });

  test(`${base}: idea.md always shows the feedback and prompts by the result`, () => {
    const md = read(base, "references/idea.md");
    assert.match(md, /Never save, and never move on, before they've seen the feedback/);
    for (const v of ["`ready`", "`needs_work`", "`rethink`"]) assert.ok(md.includes(v), v);
    assert.match(md, /exits 1|exit 1/);
  });

  test(`${base}: the "type done" prompt is used where people act outside the chat`, () => {
    for (const f of ["references/setup.md", "references/activate.md", "references/signup-team.md"]) assert.match(read(base, f), /type \*\*done\*\*/i, f);
  });
}
