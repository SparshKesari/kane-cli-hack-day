// There is no check-in desk step on event day: people save their profile on /register,
// find a team and activate. Nothing a participant reads may send them to a check-in desk,
// and nothing public counts check-ins. Staff pages (/ops/checkin, roster, paper slips)
// still exist, unused, and are out of scope here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHASE_SPECS } from "../../src/components/live/phases.ts";
import { METRIC_NAMES } from "../../src/components/live/definitions.ts";
import { ctas, schedule } from "../../src/data/hackday.ts";

const PARTICIPANT_FILES = [
  "src/data/hackday.ts",
  "src/app/register/page.tsx",
  "src/app/register/parts.tsx",
  "src/app/pair/page.tsx",
  "src/app/passport/page.tsx",
  "src/app/passport/b/[token]/page.tsx",
  "src/app/passport/login/page.tsx",
  "src/components/gen/registry.tsx",
  "src/components/live/phases.ts",
  "src/components/live/Dashboard.tsx",
  "src/components/live/LiveTV.tsx",
  "src/components/live/HomeStats.tsx",
  "src/server/mcp-adapters.ts",
  "src/server/mcp.ts",
  "src/server/core.ts",
  "src/server/activation.ts",
  "public/print/brief.html",
  "public/print/tv-fallback.html",
  "plugin/skills/hack-os/SKILL.md",
  "plugin/skills/hack-os/scripts/event-api.mjs",
];

const CHECK_IN = /check[- ]?in(?!g)|checked[ _-]?in/i;

test("nothing a participant reads mentions checking in", () => {
  const hits: string[] = [];
  for (const file of PARTICIPANT_FILES) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Code may still read the column; only words a person sees count.
        const words = line.replace(/checked_in_at|checked_in\b|participants_checked_in|\/ops\/checkin/g, "");
        if (CHECK_IN.test(words)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
  assert.deepEqual(hits, []);
});

test("the server's next step for a participant is never a check-in", () => {
  const src = readFileSync("src/server/mcp-adapters.ts", "utf8");
  assert.doesNotMatch(src, /id: "check_in"/);
  assert.match(src, /const next = !team\b/);
});

test("public live numbers count registrations, not check-ins", () => {
  assert.ok(METRIC_NAMES.includes("participants_registered"));
  assert.equal(PHASE_SPECS.arrival.primary, "participants_registered");
  assert.ok(!PHASE_SPECS.arrival.strip.includes("participants_checked_in"));
  assert.doesNotMatch(readFileSync("src/components/live/HomeStats.tsx", "utf8"), /participants_checked_in/);
  assert.doesNotMatch(readFileSync("src/components/live/LiveTV.tsx", "utf8"), /participants_checked_in/);
  assert.doesNotMatch(readFileSync("src/server/dashboard.ts", "utf8"), /checked_in_at > \$2/, "arrivals chart counts sign-ups");
});

test("the start-here button and the 09:30 slot don't mention check-in", () => {
  assert.equal(ctas.register.label, "Start here →");
  assert.ok(schedule.some((s) => s.start === "09:30" && s.title === "Arrival, breakfast"));
});

test("the staff menu has no check-in desk", () => {
  assert.doesNotMatch(readFileSync("src/app/ops/nav.ts", "utf8"), /\/ops\/checkin/);
  assert.doesNotMatch(readFileSync("src/app/ops/page.tsx", "utf8"), /Check-in desk|label: "Checked in"/);
  assert.doesNotMatch(readFileSync("src/app/ops/_kit/shell.tsx", "utf8"), /Check-in desk/);
});
