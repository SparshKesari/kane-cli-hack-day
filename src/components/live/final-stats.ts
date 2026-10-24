// The event's final Kane CLI numbers: which ones there are, their labels and the saved shape.
// Shared by the import (src/server/final-stats.ts), /ops/final-stats and the /dashboard panel,
// so a number and its label never drift apart.

export const FINAL_STATS = [
  { key: "tests_authored", label: "Tests authored", note: "authoring runs with a result" },
  { key: "test_runs", label: "Test runs", note: "agent runs and testruns" },
  { key: "bugs_caught", label: "Bugs caught", note: "runs that failed or broke" },
  { key: "use_cases", label: "Use cases designed", note: "assurance design runs that succeeded" },
  { key: "assurance_commands", label: "Assurance commands", note: "kane-cli assurance" },
  { key: "explorations", label: "Explorations", note: "exploration runs started" },
] as const;

export type FinalStatKey = (typeof FINAL_STATS)[number]["key"];
export type StatCounts = Record<FinalStatKey, number>;

export type FinalStats = {
  data_generated: string;
  window: { from: string; to: string };
  totals: StatCounts;
  teams: { slug: string; name: string; orgs: number; counts: StatCounts }[];
  /** Each org with a participant in it: its team, whether it was found by a TestMu AI claim/team sync or by email, the participants' names, how many users the page lists in it, and whether it counted (orgs shared with non-participants don't). */
  orgs: { org: string; team: { slug: string; name: string } | null; via: "testmu" | "email"; participants: string[]; users: number | null; counted: boolean; counts: StatCounts }[];
  matched: { orgs: number; by_org_id: number; by_email: number; shared_skipped: number; team_conflicts: number; participants: number; participants_matched: number };
  imported_at?: string;
};
