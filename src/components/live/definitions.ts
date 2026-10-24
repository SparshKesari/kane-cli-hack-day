// The live metric dictionary (blueprint backend/METRIC_DEFINITIONS.md, SPEC §9).
// Shared by the projection (src/server/metrics.ts), the API, the TV and the
// MetricDefinitionPopover, so the number and its explanation never drift apart.
//
// These are distinct signals. Never add them up into one "confidence score",
// never call a Kane execution a build, and never compare coverage across projects.

export const METRIC_DEFINITION_VERSION = "1";

export const METRIC_NAMES = [
  "participants_registered",
  "participants_checked_in",
  "participants_activated",
  "teams_active",
  "teams_verified",
  "kane_executions",
  "builds_validated",
  "test_members_executed",
  "bugs_detected",
  "bugs_confirmed",
  "fixed_and_reverified",
  "evidence_packs",
  "coverage",
  "median_time_to_proof",
  "help_open",
  "help_median_claim_seconds",
  "help_median_resolution_seconds",
  "submissions_finalized",
  "photographs_published",
  "team_spotlights",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

/**
 * How much a number can be trusted, which decides its pill:
 *   verified  : every unit is backed by evidence (teal ✓ VERIFIED)
 *   suspected : detections, not confirmed results (grey SUSPECTED)
 *   count     : a plain operational count (no pill)
 */
export type MetricTrust = "verified" | "suspected" | "count";

export type MetricDef = {
  name: MetricName;
  /** Short TV label. */
  label: string;
  /** One line under the number. */
  footnote: string;
  numerator: string;
  denominator: string;
  source: string;
  trustGate: string;
  trust: MetricTrust;
  unit: "count" | "seconds";
  /** "ops" metrics never leave the server for the public TV or API. */
  audience: "public" | "ops";
  /** Medians: a sample of 0 means "unknown", shown as —. */
  median?: boolean;
};

const d = (def: MetricDef) => def;

export const METRICS: Record<MetricName, MetricDef> = {
  participants_registered: d({
    name: "participants_registered",
    label: "Registered",
    footnote: "Profiles saved on the site",
    numerator: "Distinct participants with a saved profile on /register",
    denominator: "None",
    source: "Event DB",
    trustGate: "The participant saved their own profile",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
  participants_checked_in: d({
    name: "participants_checked_in",
    label: "Checked in",
    footnote: "Admitted guests at the desk",
    numerator: "Distinct admitted roster guests (Luma-approved or walk-in) with a check-in time",
    denominator: "Admitted roster guests",
    source: "Roster + staff check-in desk",
    trustGate: "Signed CSV import or a staff check-in",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
  participants_activated: d({
    name: "participants_activated",
    label: "Passports active",
    footnote: "Browser-verified activations",
    numerator: "Distinct participants with a verified activation receipt",
    denominator: "Registered participants",
    source: "Event DB + Kane activation",
    trustGate: "Activation receipt issued after browser verification",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  teams_active: d({
    name: "teams_active",
    label: "Active teams",
    footnote: "Formed teams with members",
    numerator: "Teams in formed, active, roster-locked or submitted state with at least one current member",
    denominator: "Team",
    source: "Team state in the event DB",
    trustGate: "Row consistency (no empty ghost teams)",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
  teams_verified: d({
    name: "teams_verified",
    label: "Teams with proof",
    footnote: "≥1 verified passing Kane run",
    numerator: "Distinct teams with at least one source-verified passing Kane run on their own project",
    denominator: "Active teams",
    source: "Kane runs linked to projects",
    trustGate: "Verified run, run team = project team",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  kane_executions: d({
    name: "kane_executions",
    label: "Kane executions",
    footnote: "Completed runs · every outcome",
    numerator: "Distinct (source, execution id) Kane runs with a terminal event, split by status",
    denominator: "Execution (not a build, not a release)",
    source: "kanehack CLI / MCP / CI adapters",
    trustGate: "Source-verified run with a terminal exit",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
  builds_validated: d({
    name: "builds_validated",
    label: "Builds validated",
    footnote: "Evidence-linked commits",
    numerator: "Distinct repository + commit SHA pairs with a verified passing Kane run",
    denominator: "Project commit (counted once, however many runs)",
    source: "GitHub repository link + Kane run",
    trustGate: "Provenance links the run to the exact SHA",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  test_members_executed: d({
    name: "test_members_executed",
    label: "Test members run",
    footnote: "Executions, not unique tests",
    numerator: "Individual test members that actually executed (passed or failed) in verified runs",
    denominator: "Member execution (unique definitions shown separately)",
    source: "Kane batch run events",
    trustGate: "Verified run",
    trust: "count",
    unit: "count",
    audience: "ops",
  }),
  bugs_detected: d({
    name: "bugs_detected",
    label: "Suspected detections",
    footnote: "Unconfirmed · not all failures are bugs",
    numerator: "Distinct defect candidate signatures linked to a failing Kane run (infra/auth set aside)",
    denominator: "Candidate",
    source: "Kane / agent failure reports",
    trustGate: "De-duplicated per project signature",
    trust: "suspected",
    unit: "count",
    audience: "public",
  }),
  bugs_confirmed: d({
    name: "bugs_confirmed",
    label: "Bugs confirmed",
    footnote: "Reviewed, reproducible defects",
    numerator: "Distinct human-confirmed product defects with attributable Kane evidence",
    denominator: "Confirmed issue (infra/auth-only errors excluded)",
    source: "Defects + Kane evidence",
    trustGate: "Confirming actor + evidence",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  fixed_and_reverified: d({
    name: "fixed_and_reverified",
    label: "Fixed + reverified",
    footnote: "Closed feedback loops",
    numerator: "Confirmed defects with a later passing Kane run on a different (corrected) commit",
    denominator: "Confirmed defect",
    source: "Defects + verification runs + SHA",
    trustGate: "Verified before/after runs on distinct revisions",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  evidence_packs: d({
    name: "evidence_packs",
    label: "Evidence packs",
    footnote: "Sealed, hashed, stored privately",
    numerator: "Distinct verified evidence pack hashes (not quarantined)",
    denominator: "Pack hash",
    source: "Private artifact storage",
    trustGate: "Integrity hash + privacy review",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  coverage: d({
    name: "coverage",
    label: "Teams with coverage",
    footnote: "Designed vs proven · per team only",
    numerator: "Teams whose latest verified run carries a Kane designed/proven coverage graph and a sealed pack",
    denominator: "Shown per team only; never summed or compared across projects",
    source: "Kane cover + sealed packs",
    trustGate: "Same graph context, fresh pack",
    trust: "verified",
    unit: "count",
    audience: "ops",
  }),
  median_time_to_proof: d({
    name: "median_time_to_proof",
    label: "Median time to proof",
    footnote: "Commit → first passing run",
    numerator: "Median time from a pushed commit to its first verified passing Kane run",
    denominator: "Eligible commit-run pairs (N shown)",
    source: "GitHub + Kane",
    trustGate: "Clock sanity (positive, under 12h)",
    trust: "count",
    unit: "seconds",
    audience: "ops",
    median: true,
  }),
  help_open: d({
    name: "help_open",
    label: "Help requests open",
    footnote: "Mentor queue, no details on TV",
    numerator: "Tickets new, triaged, claimed, in progress or escalated",
    denominator: "Ticket",
    source: "Help desk",
    trustGate: "Actual ticket transitions",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
  help_median_claim_seconds: d({
    name: "help_median_claim_seconds",
    label: "Median wait for a mentor",
    footnote: "Open → claimed",
    numerator: "Median of claim time minus open time",
    denominator: "Claimed tickets (N shown)",
    source: "Help desk",
    trustGate: "Actual ticket transitions",
    trust: "count",
    unit: "seconds",
    audience: "public",
    median: true,
  }),
  help_median_resolution_seconds: d({
    name: "help_median_resolution_seconds",
    label: "Median to resolve",
    footnote: "Open → resolved (staff only)",
    numerator: "Median of resolve time minus open time",
    denominator: "Resolved tickets (N shown)",
    source: "Help desk",
    trustGate: "Mentor-confirmed resolution",
    trust: "count",
    unit: "seconds",
    audience: "ops",
    median: true,
  }),
  submissions_finalized: d({
    name: "submissions_finalized",
    label: "Submissions finalized",
    footnote: "Receipts accepted before the lock",
    numerator: "Distinct teams with a signed submission receipt accepted before the server-clock deadline",
    denominator: "Active teams",
    source: "Submissions DB",
    trustGate: "Server lock + immutable receipt",
    trust: "verified",
    unit: "count",
    audience: "public",
  }),
  photographs_published: d({
    name: "photographs_published",
    label: "Photos published",
    footnote: "Approved with consent",
    numerator: "Distinct published event photos",
    denominator: "Photo",
    source: "Media DB",
    trustGate: "Per-person consent + staff approval",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
  team_spotlights: d({
    name: "team_spotlights",
    label: "Ship pages live",
    footnote: "Published team showcases",
    numerator: "Projects with a public ship page",
    denominator: "Project",
    source: "Published assets",
    trustGate: "Team-approved publication",
    trust: "count",
    unit: "count",
    audience: "public",
  }),
};

export type FreshnessState = "fresh" | "delayed" | "stale" | "offline";

/** One metric as served by /api/v1/live/metrics. `value: null` means unknown: render —, never 0. */
export type MetricValue = {
  name: MetricName;
  value: number | null;
  denominator: number | null;
  sample_n: number | null;
  source: string;
  definition_version: string;
  as_of: string | null;
  freshness: FreshnessState;
  is_demo: boolean;
  /** true when a demo value was held back on production. */
  withheld: boolean;
  breakdown: Record<string, number | string | null>;
};

/** "4m 12s", "1h 05m". */
export function formatSeconds(s: number) {
  const sec = Math.max(0, Math.round(s));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The number to print for a metric, or null for "unknown". */
export function displayValue(v: MetricValue | undefined | null): string | null {
  if (!v || v.value == null || v.withheld) return null;
  const def = METRICS[v.name];
  if (def.median && !v.sample_n) return null;
  return def.unit === "seconds" ? formatSeconds(v.value) : v.value.toLocaleString("en-US");
}
