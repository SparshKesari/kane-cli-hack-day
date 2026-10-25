// The submit step, as a team meets it: the final submission form (2026-10-24) requires only the
// project name, description, one-liner pitch and GitHub repo; every launch link is optional; and the
// video is a URL, so a local showcase.mp4 needs somewhere public first (kanehack publish, or YouTube/Loom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_DRAFT, preflight } from "../../src/server/submission.ts";
import { startGuideMarkdown } from "../../src/data/start-guide.ts";

// How each required preflight item is named in the skill and on /start.
const NAMED: Record<string, RegExp> = {
  project_name: /project name/i,
  project_description: /project description/i,
  one_line_pitch: /one-liner pitch/i,
  repo_url: /GitHub repo URL/i,
};
const OPTIONAL = [/showcase page/i, /LinkedIn post\(s\)/i, /X post\(s\)/i, /blog link\(s\)/i, /deck/i, /video/i, /Hacker News post/i];
const required = preflight(EMPTY_DRAFT, [], { creditedCount: 0, github: null }).items.filter((i) => i.required).map((i) => i.id);
const skills = ["plugin/skills", ".agents/skills"];

test("every field preflight requires has a name here (a new required field fails this test)", () => {
  assert.deepEqual(required.filter((id) => !NAMED[id]), []);
});

test("preflight requires exactly the four fields, and nothing else (links, runs, SHA are optional)", () => {
  assert.deepEqual(required, ["project_name", "project_description", "one_line_pitch", "repo_url"]);
});

test("SKILL.md and /start list every required field and every optional link, and drop the commit SHA requirement", () => {
  const sources = [...skills.map((b) => [b, readFileSync(`${b}/hack-os/SKILL.md`, "utf8").split("## Submission and launch assets")[1]?.split("\n## ")[0] ?? ""]), ["/start.md", startGuideMarkdown().split(/^## .*: Submit$/m)[1]?.split("\n## ")[0] ?? ""]];
  for (const [where, text] of sources) {
    for (const id of required) assert.match(text, NAMED[id], `${where} doesn't name ${id}`);
    for (const re of OPTIONAL) assert.match(text, re, `${where} doesn't name ${re}`);
    assert.match(text, /no commit SHA/i, where);
    assert.doesNotMatch(text, /harness description|known limitations|Kane components used/i, where);
  }
});

test("ready to submit: the session asks for all 11 fields, saves with submission_save and finalizes with submission_finalize", () => {
  const all = ["Project name", "Project description", "One-liner pitch", "GitHub repo URL", "Showcase page", "LinkedIn post(s)", "X post(s)", "Blog link(s)", "Deck", "Video", "Hacker News post"];
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    for (const f of all) assert.ok(md.includes(`   - ${f}`), `${b}: build.md doesn't list ${f}`);
    assert.match(md, /submission_save/, b);
    assert.match(md, /submission_finalize/, b);
  }
});

test("ready to submit: Kane runs are still linked for judging, with a yes, via team_page_update", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /team_page_update/, b);
    assert.match(md, /kane_run_ids/, b);
  }
});

test("ready to submit: the video goes up with kanehack publish (or YouTube/Loom) and its URL into Video", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /kanehack publish/, b);
    assert.match(md, /--yes/, b);
    assert.match(md, /"Video"/, b);
    assert.match(md, /YouTube|Loom/, b);
    assert.match(md, /\.evidence/, b);
  }
  assert.match(startGuideMarkdown(), /kanehack publish/);
});

test("ready to submit: the agent drafts the Submit tab's text fields for the captain to paste", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /draft/i, b);
    assert.match(md, /Project description/, b);
    assert.match(md, /One-liner pitch/, b);
  }
});

test("the shipped prize counts only from the Submit tab's Shipped prize bundle, filled before the captain finalizes", () => {
  for (const b of skills) {
    const skill = readFileSync(`${b}/hack-os/SKILL.md`, "utf8");
    assert.match(skill, /Shipped prize bundle/, b);
    assert.match(skill, /never checks those rows/, b);
    const md = readFileSync(`${b}/hack-os/references/build.md`, "utf8").split('## "Ready to submit"')[1];
    assert.match(md, /Shipped prize bundle/, b);
    assert.match(md, /before the captain finalizes/, b);
  }
  const start = startGuideMarkdown();
  assert.match(start, /Shipped prize bundle/);
  assert.match(start, /before the captain finalizes/);
});

test("hack-os and /start use hack-gtm's real names: launch/video/showcase.mp4, and a Show HN post the author writes", () => {
  for (const b of skills) {
    const both = readFileSync(`${b}/hack-os/SKILL.md`, "utf8") + readFileSync(`${b}/hack-os/references/build.md`, "utf8");
    assert.doesNotMatch(both, /(?<!launch\/)video\/showcase\.mp4/, b);
    assert.match(both, /launch\/video\/showcase\.mp4/, b);
    assert.match(both, /Show HN/, b);
  }
  const start = startGuideMarkdown();
  assert.doesNotMatch(start, /(?<!launch\/)video\/showcase\.mp4/);
  assert.match(start, /kanehack publish launch\/video\/showcase\.mp4/);
  assert.match(start, /--yes --json/);
});

test("after the team lock time rosters stay open: hack-os never tells people the server locked every roster", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/SKILL.md`, "utf8");
    assert.doesNotMatch(md, /locked every roster/, b);
    assert.match(md, /Rosters stay open after that time/, b);
    assert.match(md, /`roster_locked`, `submitted` or `withdrawn`/, b);
  }
});

test("hack-os and /start don't say the clock locks teams or ideas (#42): only a frozen idea or a locked roster is locked", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/SKILL.md`, "utf8") + readFileSync(`${b}/hack-os/references/idea.md`, "utf8");
    assert.doesNotMatch(md, /Idea locks 12:00|idea locks at 12:00|Team registration closes 11:00/i, b);
    const idea = readFileSync(`${b}/hack-os/references/idea.md`, "utf8");
    assert.match(idea, /frozen/, b);
    // #48: a frozen idea saves now; the skill must not send people to the help desk for it.
    assert.doesNotMatch(idea, /`idea_save` refuses/, b);
  }
  const start = startGuideMarkdown();
  assert.doesNotMatch(start, /teams are locked|idea locks/i);
});

test("submissions are due at 18:00, not locked (#45): hack-os and /start never say they lock", () => {
  for (const b of skills) {
    const md = readFileSync(`${b}/hack-os/SKILL.md`, "utf8") + readFileSync(`${b}/hack-os/references/build.md`, "utf8");
    assert.doesNotMatch(md, /Submissions lock/i, b);
    assert.match(md, /due at 18:00/, b);
  }
  const start = startGuideMarkdown();
  assert.doesNotMatch(start, /Submissions lock/i);
  assert.match(start, /Submissions due/);
});
