import { z } from "zod";

// The canonical project story (blueprint templates/project-story.schema.json,
// schema_version 1) and the public DTO every Ship Page template renders.
// Pure module: used by the studio editor (client), the services (server) and
// the templates, so it imports nothing server-only.
//
// One story powers the page, deck, video, README and social copy. Claims carry
// a confidence: only `verified` (bound to a real, source-verified Kane run or
// verified evidence) may ever render teal.

export const CREATION_TYPES = [
  "product",
  "application",
  "agent",
  "workflow",
  "extension",
  "plugin",
  "ci_pipeline",
  "validation_harness",
  "game",
  "tool",
  "other",
] as const;
export type CreationType = (typeof CREATION_TYPES)[number];

export const CONFIDENCES = ["verified", "participant_reported", "unverified"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

const str = (max: number) => z.string().trim().max(max);
const nullableId = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim()));
const nullableNum = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Must be a number" });
      return z.NEVER;
    }
    return n;
  });
const nullableStr = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v == null || v.trim() === "" ? null : v.trim().slice(0, max)));
/** "" or an https:// link (participant links are never http/javascript/data). */
const optHttps = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https:\/\/[^\s]+$/.test(s), "Must be an https:// link")
  .optional()
  .default("");

const FULL_SHA = /^[0-9a-f]{40}$/i;
const GITHUB_REPO = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export const proofSchema = z
  .object({
    claim: str(280).min(1, "Write the claim"),
    confidence: z.enum(CONFIDENCES),
    source: str(300),
    run_id: nullableId,
    evidence_id: nullableId,
    commit_sha: nullableStr(64),
  })
  .strict();

export const impactSchema = z
  .object({
    claim: str(280).min(1, "Write the claim"),
    measure: nullableNum,
    unit: nullableStr(40),
    baseline: nullableNum,
    source: nullableStr(300),
  })
  .strict();

export const storySchema = z
  .object({
    schema_version: z.literal(1),
    project_id: z.string(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    project_name: str(120).min(1, "Name your project"),
    one_line_pitch: str(170),
    creation_type: z.enum(CREATION_TYPES),
    problem: str(1200),
    what_we_built: str(2000),
    how_it_works: z.array(str(300)).max(8),
    harness: z
      .object({
        summary: str(600),
        components: z.array(str(120)).max(10),
        stages: z.array(str(120)).max(8),
      })
      .strict(),
    proof: z.array(proofSchema).max(12),
    impact: z.array(impactSchema).max(8),
    limitations: z.array(str(300)).max(8),
    links: z
      .object({
        github: optHttps,
        demo: optHttps,
        // A commit link is rendered as a public link, so it must be https like the others. The
        // full SHA the field asks for becomes the commit link on the GitHub repository above.
        repo_commit: z
          .string()
          .trim()
          .max(500)
          .refine((s) => s === "" || FULL_SHA.test(s) || /^https:\/\/[^\s]+$/.test(s), "Paste the full commit URL, or the full 40-character SHA")
          .optional()
          .default(""),
        ship_page: z.string().trim().max(300).optional().default(""),
      })
      .strict()
      .transform((l, ctx) => {
        if (!FULL_SHA.test(l.repo_commit)) return l;
        const repo = GITHUB_REPO.exec(l.github);
        if (!repo) {
          ctx.addIssue({ code: "custom", path: ["repo_commit"], message: "A commit SHA needs the GitHub repository link. Add it above, or paste the full commit URL." });
          return z.NEVER;
        }
        return { ...l, repo_commit: `https://github.com/${repo[1]}/${repo[2]}/commit/${l.repo_commit.toLowerCase()}` };
      }),
    team: z
      .array(
        z
          .object({
            display_name: str(80).min(1),
            handle: nullableStr(40),
            publicly_credited: z.boolean(),
          })
          .strict(),
      )
      .max(12),
    visuals: z
      .array(
        z
          .object({
            kind: str(40).min(1),
            approved: z.boolean(),
            source: str(500).min(1),
            alt_text: str(300).optional(),
          })
          .strict(),
      )
      .max(12),
    consent_reviewed: z.boolean(),
    status: z.enum(["draft", "approved", "published"]),
  })
  .strict();

export type Story = z.infer<typeof storySchema>;
export type StoryInput = z.input<typeof storySchema>;
export type ProofClaim = Story["proof"][number];
export type ImpactClaim = Story["impact"][number];

/** An empty story for a project, ready for the editor. */
export function blankStory(p: { id: number; slug: string; name: string }): Story {
  return {
    schema_version: 1,
    project_id: String(p.id),
    slug: p.slug,
    project_name: p.name,
    one_line_pitch: "",
    creation_type: "other",
    problem: "",
    what_we_built: "",
    how_it_works: [],
    harness: { summary: "", components: [], stages: [] },
    proof: [],
    impact: [],
    limitations: [],
    links: { github: "", demo: "", repo_commit: "", ship_page: "" },
    team: [],
    visuals: [],
    consent_reviewed: false,
    status: "draft",
  };
}

/** Phrases like "100% pass", "42 tests", "3x faster": a number that reads as a measured result. */
const METRIC_RE = /\b\d[\d,.]*\s*(%|percent|x\b|×|tests?\b|cases?\b|runs?\b|passed|passing|pass(?:es)?\b|bugs?\b|defects?\b|ms\b|seconds?\b|minutes?\b|hours?\b|faster|slower|fewer|more)/i;
export const looksLikeMetric = (s: string) => METRIC_RE.test(s);

/** An impact number is shown only with a source and a baseline; otherwise it reads as qualitative. */
export const impactIsMeasured = (i: ImpactClaim) => i.measure !== null && i.baseline !== null && !!i.source;

// ── Templates ────────────────────────────────────────────────────────────────

export const SHIP_TEMPLATES = [
  { id: "product-proof", name: "Product × Proof", blurb: "Editorial split: the creation and its Kane proof side by side.", bestFor: "Any creation (default)" },
  { id: "proof-atlas", name: "Proof Atlas", blurb: "A provenance map: claims → Kane runs → evidence, with gaps shown.", bestFor: "Standalone harnesses, assurance" },
  { id: "launch-film", name: "Launch Film", blurb: "Video-led, restrained copy, proof panel below the film.", bestFor: "Apps and UX-heavy creations" },
  { id: "terminal-zine", name: "Terminal Zine", blurb: "Mono developer journal: commands, annotations, run results.", bestFor: "CLIs, plugins, extensions, CI" },
  { id: "shipping-ledger", name: "Shipping Ledger", blurb: "Chronological build → detect → fix → reverify, red states included.", bestFor: "Strong iteration stories" },
  { id: "confidence-specimen", name: "Confidence Specimen", blurb: "Museum-style specimen card: observation, method, limits.", bestFor: "Technical finalists" },
] as const;

export type ShipTemplateId = (typeof SHIP_TEMPLATES)[number]["id"];
export const DEFAULT_TEMPLATE: ShipTemplateId = "product-proof";
export const isShipTemplate = (s: unknown): s is ShipTemplateId => typeof s === "string" && SHIP_TEMPLATES.some((t) => t.id === s);

// ── Public DTO ───────────────────────────────────────────────────────────────

/** A proof claim as the public sees it. `confidence` was re-checked on the server at publish. */
export type PublicProof = {
  claim: string;
  confidence: Confidence;
  source: string;
  run_id: string | null;
  evidence_id: string | null;
  commit_sha: string | null;
  /** Server-side facts about the bound run, when there is one. */
  run?: { status: string; finished_at: string | null; objective: string | null } | null;
};

export type PublicImpact = { claim: string; measured: boolean; measure: number | null; unit: string | null; baseline: number | null; source: string | null };

export type Badges = {
  /** A finalized (or locked) official submission exists. */
  shipped: boolean;
  /** At least one source-verified, passed Kane run is on record. */
  kaneVerified: boolean;
};

/** Everything a Ship Page template may render. No emails, no private idea text, no uncredited names. */
export type PublicStory = {
  slug: string;
  name: string;
  pitch: string;
  creationType: CreationType;
  problem: string;
  whatWeBuilt: string;
  howItWorks: string[];
  harness: { summary: string; components: string[]; stages: string[] };
  proof: PublicProof[];
  impact: PublicImpact[];
  limitations: string[];
  links: { github: string | null; demo: string | null; repoCommit: string | null; shipPage: string };
  /** Credited people only; handles only where that person consented to mentions. */
  team: { name: string; handle: string | null }[];
  /** Approved visuals with an https or same-site source. */
  visuals: { kind: string; src: string; alt: string }[];
  badges: Badges;
  /** Published version id and time, or null for a studio preview. */
  version: number | null;
  publishedAt: string | null;
  hasDeck: boolean;
  /** True when this is a studio draft preview, not a published page. */
  preview: boolean;
};

// Same-site paths only: "//host/x" is protocol-relative (another origin), so it's refused.
const safeSrc = (s: string) => /^https:\/\/[^\s"'<>]+$/.test(s) || /^\/(?!\/)[\w./-]+$/.test(s);

/**
 * Story → public DTO. `credited` is the list of names (and consented handles)
 * the server approved; anyone else in story.team is dropped.
 */
export function toPublicStory(
  story: Story,
  opts: {
    shipPage: string;
    credited: { name: string; handle: string | null }[];
    proofRuns?: Record<string, PublicProof["run"]>;
    badges: Badges;
    version: number | null;
    publishedAt: string | null;
    hasDeck: boolean;
    preview: boolean;
  },
): PublicStory {
  return {
    slug: story.slug,
    name: story.project_name,
    pitch: story.one_line_pitch,
    creationType: story.creation_type,
    problem: story.problem,
    whatWeBuilt: story.what_we_built,
    howItWorks: story.how_it_works.filter(Boolean),
    harness: {
      summary: story.harness.summary,
      components: story.harness.components.filter(Boolean),
      stages: story.harness.stages.filter(Boolean),
    },
    proof: story.proof.map((p) => ({ ...p, run: p.run_id ? (opts.proofRuns?.[p.run_id] ?? null) : null })),
    impact: story.impact.map((i) => {
      const measured = impactIsMeasured(i);
      return { claim: i.claim, measured, measure: measured ? i.measure : null, unit: measured ? i.unit : null, baseline: measured ? i.baseline : null, source: i.source };
    }),
    limitations: story.limitations.filter(Boolean),
    links: {
      github: story.links.github || null,
      demo: story.links.demo || null,
      repoCommit: story.links.repo_commit || null,
      shipPage: opts.shipPage,
    },
    team: opts.credited,
    visuals: story.visuals.filter((v) => v.approved && safeSrc(v.source)).map((v) => ({ kind: v.kind, src: v.source, alt: v.alt_text || `${v.kind} for ${story.project_name}` })),
    badges: opts.badges,
    version: opts.version,
    publishedAt: opts.publishedAt,
    hasDeck: opts.hasDeck,
    preview: opts.preview,
  };
}

export const CREATION_LABEL: Record<CreationType, string> = {
  product: "Product",
  application: "Application",
  agent: "Agent",
  workflow: "Workflow",
  extension: "Extension",
  plugin: "Plugin",
  ci_pipeline: "CI pipeline",
  validation_harness: "Validation harness",
  game: "Game",
  tool: "Tool",
  other: "Creation",
};
