// The submit step, as a team meets it: preflight requires more than the old "repo, URL, run report"
// line said; a reported Kane run counts only once the draft links it; and the demo video is a URL,
// so a local showcase.mp4 needs somewhere public first (kanehack publish, or YouTube/Loom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_DRAFT, preflight } from "../../src/server/submission.ts";
import { startGuideMarkdown } from "../../src/data/start-guide.ts";

// How each required preflight item is named in the skill and on /start.
const NAMED: Record<string, RegExp> = {
  project_name: /project name/i,
  project_type: /type/i,
  one_line_pitch: /one-line pitch/i,
  repo_url: /repo/i,
  commit_sha: /commit SHA/i,
  demo: /live URL or run command/i,
  kane_evidence: /Kane (CLI )?run/i,
  harness_summary: /harness description/i,
  kane_components: /Kane components/i,
  limitations: /known limitations/i,
};
const required = preflight(EMPTY_DRAFT, [], { creditedCount: 0, github: null }).items.filter((i) => i.required).map((i) => i.id);
const skills = ["plugin/skills", ".agents/skills"];

test("every field preflight requires has a name here (a new required field fails this test)", () => {
  assert.deepEqual(required.filter((id) => !NAMED[id]), []);
});

test("SKILL.md and /start list every field submission_preflight requires", () => {
  const sources = [...skills.map((b) => [b, readFileSync(`${b}/hack-os/SKILL.md`, "utf8").split("## Submission and launch assets")[1]?.split("\n## ")[0] ?? ""]), ["/start.md", startGuideMarkdown().split(/^## .*: Submit$/m)[1]?.split("\n## ")[0] ?? ""]];
  for (const [where, text] of sources) for (const id of required) assert.match(text, NAMED[id], `${where} doesn't name ${id}`);
});

test("ready to submit: link the team's Kane runs, or preflight keeps saying the run report is missing", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /team_page_update/, b);
    assert.match(md, /kane_run_ids/, b);
    assert.match(md, /tick/i, b);
  }
});

test("ready to submit: the demo video goes up with kanehack publish (or YouTube/Loom) and its URL into Demo video URL", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /kanehack publish/, b);
    assert.match(md, /--yes/, b);
    assert.match(md, /Demo video URL/, b);
    assert.match(md, /YouTube|Loom/, b);
    assert.match(md, /\.evidence/, b);
  }
  assert.match(startGuideMarkdown(), /kanehack publish/);
});

test("ready to submit: the agent drafts the Submit tab's text fields for the captain to paste", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /draft/i, b);
    assert.match(md, /git rev-parse HEAD/, b);
  }
});
