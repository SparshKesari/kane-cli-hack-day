// Event day, 2026-10-24: the clock no longer locks teams, ideas or submissions, so the schedule,
// the homepage and hub, the judge queue and the agent-facing event messages say "due", not "lock".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schedule, submissions } from "../../src/data/hackday.ts";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the schedule's deadlines say due, and submissions are due at 6:00 PM", () => {
  const deadlines = schedule.filter((s) => s.deadline);
  assert.deepEqual(deadlines.map((s) => s.title), ["Hackathon begins. Teams due", "Idea due", "Submissions due"]);
  for (const s of schedule) assert.doesNotMatch(`${s.title} ${s.note ?? ""}`, /\block|\bcloses\b/i, s.title);
  assert.equal(submissions.final.closing, "Submissions are due at 6:00 PM.");
});

test("the homepage, hub and judge queue mark deadlines Due, not Lock", () => {
  for (const f of ["src/components/home/Schedule.tsx", "src/components/machines/Antikythera.tsx", "src/components/home/Deliverables.tsx"]) {
    assert.doesNotMatch(src(f), /^\s*Lock\s*$|>\s*Lock\s*<|Lock \{to12h|hard lock|marked <span[^>]*>Lock/m, f);
  }
  assert.doesNotMatch(src("src/components/hub/SubmitBody.tsx"), /tag="(Closes|Locks)"/);
  assert.doesNotMatch(src("src/components/home/NowNext.tsx"), /Team registration closes/);
  assert.doesNotMatch(src("src/app/judge/page.tsx"), /Submissions lock/);
});

test("the Live TV, the organizer broadcast and the printed signs say due", () => {
  assert.doesNotMatch(src("src/components/live/LiveTV.tsx"), />Submissions lock</);
  assert.doesNotMatch(src("src/server/ops.ts"), /Submissions lock at|official submission lock/);
  assert.doesNotMatch(src("src/app/ops/recovery/print/signage/page.tsx"), /Team registration closes|Submission lock |deadline still stands/);
});

test("agents hear that submissions are due, not that they lock", () => {
  assert.doesNotMatch(src("src/components/gen/registry.tsx"), /"Submissions lock"/);
  assert.doesNotMatch(src("src/server/mcp.ts"), /[Ss]ubmissions lock/);
  assert.doesNotMatch(src("src/app/api/v1/event/brief/route.ts"), /Submissions lock/);
});

test("MCP tool descriptions don't tell agents an idea or evidence locks at a time", () => {
  const mcp = src("src/server/mcp.ts");
  assert.doesNotMatch(mcp, /Refused after the idea lock|before the submission lock|the server lock time/);
});

test("the event brief tells agents nothing locks on the clock", () => {
  const mcp = src("src/server/mcp.ts");
  assert.match(mcp, /const NO_CLOCK_LOCKS = "Nothing locks on the clock: teams, ideas and submissions stay open after their due times\.";/);
  assert.match(mcp, /message: `\$\{e\.name\}: phase \$\{e\.phase\.toUpperCase\(\)\}\. \$\{NO_CLOCK_LOCKS\}/);
  assert.match(mcp, /clock_locks: NO_CLOCK_LOCKS,/);
});
