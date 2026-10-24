// After registration and activation, hack-os must take the person through the idea check
// before any building. A Codex run went straight to "build" on the server's next_action
// hint and skipped it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (base: string, f: string) => readFileSync(`${base}/hack-os/${f}`, "utf8");

for (const base of ["plugin/skills", ".agents/skills"]) {
  test(`${base}: SKILL.md never skips the idea step, whatever next_action says`, () => {
    const md = read(base, "SKILL.md");
    assert.match(md, /\*\*Never skip the idea step\.\*\*/);
    assert.match(md, /`idea\.saved`/);
  });

  test(`${base}: build.md sends anyone without a checked, saved idea back to the idea step`, () => {
    const md = read(base, "references/build.md");
    const start = md.slice(md.indexOf("## Start building"));
    assert.match(start.split("\n").slice(0, 6).join("\n"), /idea\.saved[\s\S]*references\/idea\.md/);
  });

  test(`${base}: idea.md lists the app types as Web App, Mobile App, others`, () => {
    const md = read(base, "references/idea.md");
    assert.match(md, /app type \(Web App, Mobile App, others\)/);
    assert.doesNotMatch(md, /AI Agent and Voice|Data and Dashboards/);
  });
}
