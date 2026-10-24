import type { MetricName } from "./definitions";

// What /live shows in each phase (SPEC §9 screen modes). Copy in the site's
// voice; the headline's second line is the one lime dot-matrix phrase.

export type LivePhase = "arrival" | "build" | "verify" | "submit" | "showtime" | "recap";

export type PanelKey =
  | "welcome"
  | "teams"
  | "activation"
  | "activity"
  | "proof"
  | "tips"
  | "help"
  | "loops"
  | "lesson"
  | "checklist"
  | "cards"
  | "aggregates"
  | "gallery";

export type PhaseSpec = {
  index: string;
  kicker: string;
  headline: [string, string];
  sub: string;
  next: { title: string; body: string; href: string; cta: string };
  /** The one big orbital count. */
  primary: MetricName;
  primaryTone: "verified" | "neutral";
  /** Metric strip (20% of the screen). */
  strip: MetricName[];
  /** Story panels (50%), rotated every 15–25s. */
  panels: PanelKey[];
};

export const PHASE_SPECS: Record<LivePhase, PhaseSpec> = {
  arrival: {
    index: "01",
    kicker: "Arrival and matching",
    headline: ["Find your", "people."],
    sub: "Every builder starts with a personal passport. Save your profile, find a team, then choose what you want to make.",
    next: { title: "Save your profile, then find a team.", body: "Start at kaneclihack.sh/register. Solo is fine. Teams lock at 11:00.", href: "/match", cta: "Scan: find a team" },
    primary: "participants_registered",
    primaryTone: "neutral",
    strip: ["participants_registered", "participants_activated", "teams_active", "help_open"],
    panels: ["welcome", "teams", "activation", "activity"],
  },
  build: {
    index: "02",
    kicker: "The build is on",
    headline: ["Proof is", "happening."],
    sub: "The room is building, and Kane is checking what actually works. Every meaningful run makes the story clearer.",
    next: { title: "Verify your first critical flow.", body: "A passing build is not a release decision. Give Kane a real user journey to verify.", href: "/help", cta: "Stuck? Scan for help" },
    primary: "kane_executions",
    primaryTone: "neutral",
    strip: ["kane_executions", "teams_verified", "builds_validated", "bugs_detected", "help_open"],
    panels: ["activity", "proof", "tips", "help"],
  },
  verify: {
    index: "03",
    kicker: "Verification hour",
    headline: ["Check the", "important things."],
    sub: "Make every result actionable: find real bugs, close proof gaps and leave an inspectable trail of evidence.",
    next: { title: "Close a proof gap before adding features.", body: "Let what Kane actually found guide your next change, then re-run it on the new commit.", href: "/help", cta: "Ask a mentor" },
    primary: "fixed_and_reverified",
    primaryTone: "verified",
    strip: ["builds_validated", "bugs_detected", "bugs_confirmed", "fixed_and_reverified", "evidence_packs"],
    panels: ["loops", "lesson", "activity"],
  },
  submit: {
    index: "04",
    kicker: "Final submission",
    headline: ["Lock the", "evidence."],
    sub: "Confirm your repo and commit, a working link and your Kane evidence, then finalize for an immutable receipt.",
    next: { title: "Review and finalize your submission.", body: "Your team hub → Submit. Finalize returns an S- receipt with the server time.", href: "/submit", cta: "Open Submit" },
    primary: "submissions_finalized",
    primaryTone: "verified",
    strip: ["submissions_finalized", "teams_verified", "evidence_packs", "help_open"],
    panels: ["checklist", "help"],
  },
  showtime: {
    index: "05",
    kicker: "Showcase",
    headline: ["Show what", "you shipped."],
    sub: "Creation first. Proof second. Then why your approach helps teams ship reliable software faster.",
    next: { title: "Make every demo count.", body: "Show working software, the validation behind it, and the actual result.", href: "/ship", cta: "Browse the showcase" },
    primary: "submissions_finalized",
    primaryTone: "verified",
    strip: ["submissions_finalized", "team_spotlights", "fixed_and_reverified", "photographs_published"],
    panels: ["cards", "activity"],
  },
  recap: {
    index: "06",
    kicker: "Recap",
    headline: ["That's a", "wrap."],
    sub: "Reviewed aggregates from the day, and every published ship page to share.",
    next: { title: "Share your ship page.", body: "Every published project is at /ship. Photos appear once everyone in them has consented.", href: "/ship", cta: "Open the gallery" },
    primary: "submissions_finalized",
    primaryTone: "verified",
    strip: ["kane_executions", "builds_validated", "bugs_confirmed", "fixed_and_reverified", "photographs_published"],
    panels: ["aggregates", "gallery"],
  },
};

export const OPS_STRIP: MetricName[] = [
  "help_open",
  "help_median_claim_seconds",
  "help_median_resolution_seconds",
  "median_time_to_proof",
  "test_members_executed",
  "coverage",
];

export const PANEL_TITLES: Record<PanelKey, string> = {
  welcome: "Start here",
  teams: "Teams with open seats",
  activation: "Passports",
  activity: "The room, in motion",
  proof: "Teams with proof",
  tips: "How proof works here",
  help: "Help is close",
  loops: "Closed loops",
  lesson: "Designed vs proven",
  checklist: "Receipt checklist",
  cards: "Projects",
  aggregates: "The day, verified",
  gallery: "Ship pages",
};

/** Rotation cadence: 15–25s, varied a little so panels don't feel mechanical. */
export const PANEL_SECONDS = [20, 18, 22, 24, 16];
