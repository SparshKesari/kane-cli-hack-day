// The site says what the API says: the same tracks, the same app type text, the same sign-in
// commands, links that exist, and none of the idea extras the event dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { challenge, resources, trackLabel } from "../../src/data/hackday.ts";
import { PAIR } from "../../src/data/agent-setup.ts";

const src = (f: string) => readFileSync(f, "utf8");

test("tracks are Web App, Mobile App and Other; old names read as Other", () => {
  assert.deepEqual(challenge.tracks, ["Web App", "Mobile App", "Other"]);
  for (const old of ["Wildcard", "AI Agent and Voice", "Data and Dashboards"]) assert.equal(trackLabel(old), "Other", old);
  assert.equal(trackLabel("Mobile App"), "Mobile App");
  const ideas = resources.find((r) => r.id === "build-ideas")!;
  for (const i of ideas.items) assert.ok((challenge.tracks as readonly string[]).includes(i.label), i.label);
});

test("the Idea tab's app type example matches the API: Web App, Mobile App, others", () => {
  assert.match(src("src/app/t/[slug]/idea/parts.tsx"), /placeholder="Web App, Mobile App, others"/);
});

test("judging copy matches the 4 x 25 rubric", () => {
  assert.doesNotMatch(src("src/components/home/JudgingTeaser.tsx"), /Kane counts most/);
});

test("/setup signs a machine in with kanehack password + signin, and counts the real skills", () => {
  const cmds = PAIR.map((c) => c.value).join("\n");
  assert.match(cmds, /kanehack password/);
  assert.match(cmds, /kanehack signin --email/);
  assert.doesNotMatch(src("src/app/setup/page.tsx"), /twelve/);
});

test("Codex tool links point at pages that exist (there is no /t index)", () => {
  assert.doesNotMatch(src("src/server/mcp.ts"), /["'`]\/t["'`]|siteUrl\("\/t"\)/);
});

test("the dashboard API no longer reports check-ins", () => {
  assert.doesNotMatch(src("src/app/api/v1/dashboard/route.ts"), /checked in/);
});

test("idea extras are gone: radar, opt-in prompts, the state row with 'Lock in this idea', the print page", () => {
  for (const d of ["src/app/t/[slug]/idea/radar", "src/app/t/[slug]/idea/print", "src/app/api/v1/ideas/radar"]) assert.ok(!existsSync(d), d);
  const page = src("src/app/t/[slug]/idea/page.tsx");
  assert.doesNotMatch(page, /Lock it in|SelectIdeaButton|idea\/print|aria-label="Idea state"/);
  assert.doesNotMatch(src("src/app/t/[slug]/idea/parts.tsx"), /RadarRunner|radarAction|SelectIdeaButton/);
  assert.doesNotMatch(src("src/server/mcp.ts"), /idea_check_overlap/);
  for (const base of ["plugin/skills", ".agents/skills"]) assert.doesNotMatch(src(`${base}/hack-os/references/idea.md`), /idea_check_overlap/);
});
