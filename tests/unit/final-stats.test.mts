// The one-time final Kane CLI numbers (no database): counting the usage page's latest.json per
// org, deciding which orgs belong to participants, and the totals per team and overall. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFinalStats, countsByOrg, matchOrgs, parseUsageFiles, type Participant } from "../../src/server/final-stats.ts";

// Shaped like the usage page's files: arrays keyed by org id, counts at fixed positions.
const latest = {
  generated: "2026-10-25T01:05:00Z",
  window: { from: "2026-10-24T00:00:00Z", to: "2026-10-25T01:05:00Z", env: "prod" },
  orgs: [{ org: "100", sessions: 9 }, { org: "200", sessions: 4 }, { org: "300", sessions: 7 }, { org: "400", sessions: 50 }],
  feat: [
    ["agent runs (run / testmd)", "100", "paid", "external", 20, 20, 1, "0.10.0"],
    ["testrun", "100", "paid", "external", 5, 5, 1, "0.10.0"],
    ["assurance · design", "100", "paid", "external", 3, 3, 1, "0.10.0"],
    ["assurance · extract", "200", "free", "external", 2, 2, 1, "0.10.0"],
    ["agent runs (run / testmd)", "200", "free", "external", 7, 7, 1, "0.9.1"],
    ["code export", "100", "paid", "external", 99, 99, 1, "0.10.0"],
    ["agent runs (run / testmd)", "400", "paid", "external", 500, 500, 9, "0.10.0"],
  ],
  metrics: [
    ["assurance", "design runs · ok", "100", 4, 0, 4, 1, "0.10.0"],
    ["assurance", "design runs · failed", "100", 2, 0, 2, 1, "0.10.0"],
    ["assurance", "design runs · ok", "300", 1, 0, 1, 1, "0.10.0"],
  ],
  outcomes: [
    [1792800000000, "result|author|passed|100", "100", 6, 1, "0.10.0"],
    [1792800000000, "result|author|failed|", "100", 2, 1, "0.10.0"],
    [1792800000000, "verdict|failed", "100", 3, 1, "0.10.0"],
    [1792800000000, "verdict|broken", "200", 1, 1, "0.10.0"],
    [1792800000000, "verdict|passed", "200", 8, 1, "0.10.0"],
    [1792800000000, "result|replay|failed|", "200", 5, 1, "0.10.0"],
  ],
  explore: [
    ["300", "exploration_run_start", "", 2, 1, 2],
    ["300", "exploration_context_outcome", "ok", 1, 1, 0],
  ],
};
const emails = {
  generated: "2026-10-25T01:05:00Z",
  emails: {
    "100": [["captain@example.test", 5]],
    "300": [["solo@example.test", 7]],
    "400": [["mate@example.test", 2], ["someone-else@corp.test", 48]],
  },
};

test("counts each final stat per org from the usage page's rows", () => {
  const c = countsByOrg(parseUsageFiles(JSON.stringify(latest), JSON.stringify(emails)).latest);
  assert.deepEqual(c.get("100"), { tests_authored: 8, test_runs: 25, bugs_caught: 3, use_cases: 4, assurance_commands: 3, explorations: 0 });
  assert.deepEqual(c.get("200"), { tests_authored: 0, test_runs: 7, bugs_caught: 1, use_cases: 0, assurance_commands: 2, explorations: 0 });
  assert.deepEqual(c.get("300"), { tests_authored: 0, test_runs: 0, bugs_caught: 0, use_cases: 1, assurance_commands: 0, explorations: 2 });
});

const people: Participant[] = [
  { email: "captain@example.test", name: "Cap", teamId: 1, orgs: ["100"] }, // claimed into the team org
  { email: "mate@example.test", name: "Mate", teamId: 1, orgs: ["200"] }, // synced into org 200; also uses shared org 400
  { email: "solo@example.test", name: null, teamId: null, orgs: [] }, // no team, found only by email
];

test("an org counts when a participant claimed into it, or when every user in it is a participant", () => {
  const m = matchOrgs(people, parseUsageFiles(JSON.stringify(latest), JSON.stringify(emails)).emails);
  assert.deepEqual([...m.orgTeam.entries()].sort(), [["100", 1], ["200", 1], ["300", null]]);
  assert.equal(m.byOrgId, 2);
  assert.equal(m.byEmail, 1);
  // Org 400 has a participant and someone else: the whole org's usage isn't counted.
  assert.equal(m.sharedSkipped, 1);
  assert.equal(m.participantsMatched, 3);
});

test("an org claimed by two teams goes to the team with more members in it, and is reported", () => {
  const m = matchOrgs(
    [
      { email: "a@x.test", teamId: 1, orgs: ["100"] },
      { email: "b@x.test", teamId: 2, orgs: ["100"] },
      { email: "c@x.test", teamId: 2, orgs: ["100"] },
    ],
    {},
  );
  assert.equal(m.orgTeam.get("100"), 2);
  assert.equal(m.conflicts, 1);
});

test("final stats total only participant orgs, per team and overall", () => {
  const files = parseUsageFiles(JSON.stringify(latest), JSON.stringify(emails));
  const s = buildFinalStats(files, people, new Map([[1, { slug: "kestrel", name: "Kestrel" }]]));
  // Orgs 100 + 200 + 300; org 400 (500 runs) is left out.
  assert.deepEqual(s.totals, { tests_authored: 8, test_runs: 32, bugs_caught: 4, use_cases: 5, assurance_commands: 5, explorations: 2 });
  assert.deepEqual(s.teams, [{ slug: "kestrel", name: "Kestrel", orgs: 2, counts: { tests_authored: 8, test_runs: 32, bugs_caught: 4, use_cases: 4, assurance_commands: 5, explorations: 0 } }]);
  assert.equal(s.data_generated, "2026-10-25T01:05:00Z");
  assert.deepEqual(s.window, { from: "2026-10-24T00:00:00Z", to: "2026-10-25T01:05:00Z" });
  assert.deepEqual(s.matched, { orgs: 3, by_org_id: 2, by_email: 1, shared_skipped: 1, team_conflicts: 0, participants: 3, participants_matched: 3 });
  // Nothing personal is kept: no emails anywhere in what gets saved.
  assert.doesNotMatch(JSON.stringify(s), /@/);
});

test("each org is listed with its team, how it was found, its participants and whether it counted", () => {
  const files = parseUsageFiles(JSON.stringify(latest), JSON.stringify(emails));
  const s = buildFinalStats(files, people, new Map([[1, { slug: "kestrel", name: "Kestrel" }]]));
  const kestrel = { slug: "kestrel", name: "Kestrel" };
  assert.deepEqual(
    s.orgs.map(({ counts, ...o }) => ({ ...o, runs: counts.test_runs })),
    [
      { org: "100", team: kestrel, via: "testmu", participants: ["Cap"], users: 1, counted: true, runs: 25 },
      { org: "200", team: kestrel, via: "testmu", participants: ["Mate"], users: null, counted: true, runs: 7 },
      { org: "300", team: null, via: "email", participants: ["(no name)"], users: 1, counted: true, runs: 0 },
      // Shared with someone who isn't a participant: listed so organizers can see it, never counted.
      { org: "400", team: kestrel, via: "email", participants: ["Mate"], users: 2, counted: false, runs: 500 },
    ],
  );
  assert.doesNotMatch(JSON.stringify(s.orgs), /@/);
});

test("files that aren't the usage page's are refused with what was expected", () => {
  assert.throws(() => parseUsageFiles("{}", JSON.stringify(emails)), (e: { code?: string; userMessage?: string }) => e.code === "VALIDATION_FAILED" && /latest\.json/.test(e.userMessage ?? ""));
  assert.throws(() => parseUsageFiles(JSON.stringify(latest), "not json"), (e: { code?: string; userMessage?: string }) => e.code === "VALIDATION_FAILED" && /emails\.json/.test(e.userMessage ?? ""));
});
