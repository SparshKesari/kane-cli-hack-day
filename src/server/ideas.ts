import "server-only";
import { cosineSimilarity, embedMany } from "ai";
import { query } from "@/lib/db";
import { requireFlag } from "@/lib/flags";
import { draftObject } from "./ai";
import { AppError, parse, sha256, withAudit, writeAudit, z, zx, type Receipt } from "./core";
import { hasRole, type Staff } from "./auth";
import { receiptOf, type ActingMember } from "./teams";

// Ideas (SPEC §4, E6). A team's idea is private by default; every save is a
// revision. The Idea Validator is ADVISORY: eight criteria, a verdict, three
// changes and a Kane capability path, drafted by the model through the AI
// Gateway or, when that's unavailable, by the deterministic rubric below. It
// is never an official score. The Idea Radar compares OPT-IN public summaries
// only; private descriptions are never selected, embedded or returned.

export const PROJECT_TYPES = ["application", "agent", "extension", "plugin", "workflow", "ci_pipeline", "validation_harness", "tool", "other"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  application: "App / product",
  agent: "AI agent",
  extension: "Browser extension",
  plugin: "Developer plugin",
  workflow: "Workflow / automation",
  ci_pipeline: "CI/CD pipeline",
  validation_harness: "Standalone validation harness",
  tool: "Tool / CLI",
  other: "Other",
};

export type IdeaStatus = "draft" | "validated" | "shared" | "selected" | "frozen";
export type Verdict = "qualifies" | "needs_work" | "ineligible";

export type Idea = {
  id: number;
  team_id: number;
  title: string;
  private_description: string;
  app_type: string;
  kane_plan: string;
  extra_info: string;
  public_summary: string | null;
  discovery_opt_in: boolean;
  project_type: ProjectType;
  qualification: "draft" | Verdict;
  status: IdeaStatus;
  frozen_at: Date | null;
  updated_at: Date;
  idea_lock_at: Date;
  /** Always false: ideas never lock (event day, 2026-10-24). Kept for callers and API clients. */
  locked: boolean;
  revision: number;
};

// ── Criteria ─────────────────────────────────────────────────────────────────

export const CRITERIA = [
  { id: "functional_deliverable", label: "Functional creation", question: "Is there a working thing (app, plugin, CI, workflow or standalone harness) with an outcome you can show?" },
  { id: "agent_use", label: "AI coding agent involved", question: "Is an AI coding agent meaningfully part of how it's built or how it runs?" },
  { id: "kane_integration", label: "Kane solves a real assurance problem", question: "Do Kane CLI components verify behaviour that matters, not just launch one isolated test?" },
  { id: "repeatability", label: "Repeatable verification", question: "Can the verification be re-run (suite, _test.md, CI, schedule) rather than a one-off?" },
  { id: "feedback_loop", label: "Results drive a decision", question: "Do results feed diagnosis, a fix, a regression test or a release decision?" },
  { id: "actual_proof", label: "Real evidence planned", question: "Will you show a real execution with evidence (logs, recordings, report links)?" },
  { id: "engineering_impact", label: "Credible engineering impact", question: "Is there a believable shipping speed or quality gain you can measure?" },
  { id: "feasible_demo", label: "Feasible in a day", question: "Is the MVP and demo achievable by the submission lock?" },
] as const;

export type CriterionId = (typeof CRITERIA)[number]["id"];
const CRITERION_IDS = CRITERIA.map((c) => c.id) as [CriterionId, ...CriterionId[]];

export const KANE_CAPABILITIES = {
  run: "kane-cli run: drive critical user flows from a plain-language objective",
  testmd: "Save runs as _test.md so the same checks re-run on every change",
  testrun: "kane-cli testrun: run the saved suite from CI or a script and read NDJSON results",
  assurance: "Assurance: generate a requirement-linked suite from your spec or PRD",
  coverage: "Coverage: see which requirements and flows are still untested",
  evidence: "Evidence packs: keep logs, screenshots and report links as proof",
  remote: "Remote execution: cloud browsers, Android emulators or iOS simulators",
} as const;
export type KaneCapability = keyof typeof KANE_CAPABILITIES;
const CAPABILITY_IDS = Object.keys(KANE_CAPABILITIES) as [KaneCapability, ...KaneCapability[]];

export type CriterionResult = { id: CriterionId; label: string; status: "met" | "partial" | "missing"; evidence: string };

export type Assessment = {
  version: "idea-validator@1";
  verdict: Verdict;
  summary: string;
  criteria: CriterionResult[];
  /** Exactly three. */
  changes: [string, string, string];
  kane_path: { capability: KaneCapability; label: string; why: string }[];
  generator: "llm" | "rules";
  model: string | null;
  warning?: string;
  /** Always true: shown as "Advisory — not an official score". */
  advisory: true;
  assessed_at: string;
};

export type IdeaInput = { title: string; description: string; project_type: ProjectType };

// ── Reads ────────────────────────────────────────────────────────────────────

const IDEA_SELECT = `
  select i.id, i.team_id, i.title, i.private_description, i.app_type, i.kane_plan, i.extra_info, i.public_summary, i.discovery_opt_in, i.project_type,
         i.qualification, i.status, i.frozen_at, i.updated_at, e.idea_lock_at,
         false as locked,
         coalesce((select max(r.revision) from idea_revisions r where r.idea_id = i.id), 0)::int as revision
    from ideas i join teams t on t.id = i.team_id
    join hack_events e on e.id = coalesce(t.event_id, current_event_id())`;

/** The team's idea (private fields included: callers must be that team or organizer staff). */
export async function getIdea(teamId: number): Promise<Idea | null> {
  const [row] = await query<Idea>(`${IDEA_SELECT} where i.team_id = $1`, [teamId]);
  if (row) return row;
  // Teams made before 011 ran, or created elsewhere: make the row so the tab always works.
  await query("insert into ideas (team_id, title) select id, left(name, 120) from teams where id = $1 on conflict (team_id) do nothing", [teamId]);
  const [made] = await query<Idea>(`${IDEA_SELECT} where i.team_id = $1`, [teamId]);
  return made ?? null;
}

export type Revision = { revision: number; created_at: Date; actor: string | null; title: string; verdict: Verdict | null; generator: string | null };

export type OpsIdeaRow = {
  team_id: number;
  team_name: string;
  team_slug: string;
  team_state: string;
  title: string | null;
  app_type: string | null;
  private_description: string | null;
  kane_plan: string | null;
  extra_info: string | null;
  status: IdeaStatus | null;
  updated_at: Date | null;
  revision: number;
  /** Something was saved: a revision, a description or a Kane plan (a team's blank row doesn't count). */
  saved: boolean;
};

/** Every team's idea for /ops/ideas, newest first, teams with nothing saved last; withdrawn teams left out. Organizer only. */
export async function listIdeasForOps(staff: Staff | null): Promise<OpsIdeaRow[]> {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  return query<OpsIdeaRow>(
    `select t.id as team_id, t.name as team_name, t.slug as team_slug, t.state as team_state,
            i.title, i.app_type, i.private_description, i.kane_plan, i.extra_info, i.status, i.updated_at, coalesce(r.n, 0) as revision,
            (coalesce(r.n, 0) > 0 or coalesce(i.private_description, '') <> '' or coalesce(i.kane_plan, '') <> '') as saved
       from teams t
       left join ideas i on i.team_id = t.id
       left join lateral (select max(x.revision)::int as n from idea_revisions x where x.idea_id = i.id) r on true
      where t.state <> 'withdrawn'
      order by (coalesce(r.n, 0) > 0 or coalesce(i.private_description, '') <> '' or coalesce(i.kane_plan, '') <> '') desc, i.updated_at desc nulls last, t.name`,
  );
}

export async function listRevisions(ideaId: number, limit = 20) {
  return query<Revision>(
    `select r.revision, r.created_at, coalesce(m.display_name, m.name) as actor,
            r.user_submitted->>'title' as title, r.assessment->>'verdict' as verdict, r.assessment->>'generator' as generator
       from idea_revisions r left join members m on m.id = r.actor_id
      where r.idea_id = $1 order by r.revision desc limit $2`,
    [ideaId, limit],
  );
}

/** The most recent advisory assessment, and the revision it was made on. */
export async function latestAssessment(ideaId: number) {
  const [row] = await query<{ revision: number; assessment: Assessment }>(
    "select revision, assessment from idea_revisions where idea_id = $1 and assessment is not null order by revision desc limit 1",
    [ideaId],
  );
  return row ?? null;
}

// Ideas never freeze (event day, 2026-10-24: teams kept refining after noon). An idea frozen
// before that is still editable, and saving it takes it out of the freeze.

// ── Save (T-IDEA-01, T-IDEA-04) ──────────────────────────────────────────────

export const ideaSchema = z
  .object({
    title: zx.text(120),
    private_description: z.string().trim().max(4000).default(""),
    // Left out (e.g. an older MCP client) → the current value stays.
    app_type: z.string().trim().max(120).optional(),
    kane_plan: z.string().trim().max(4000).optional(),
    extra_info: z.string().trim().max(4000).optional(),
    public_summary: zx.optText(400),
    discovery_opt_in: zx.checkbox.default(false),
    project_type: z.enum(PROJECT_TYPES).default("other"),
    source: z.enum(["web", "mcp"]).default("web"),
  })
  .refine((v) => !v.discovery_opt_in || !!v.public_summary, { message: "Write a public summary before sharing it with other teams.", path: ["public_summary"] });

/** Save a new revision. Any team member, at any time. */
export async function saveIdea(who: ActingMember, teamId: number, input: unknown): Promise<{ idea: Idea; receipt: Receipt }> {
  const data = parse(ideaSchema, input);
  const cur = await getIdea(teamId);
  if (!cur) throw new AppError("NOT_FOUND");
  const next = { app_type: data.app_type ?? cur.app_type, kane_plan: data.kane_plan ?? cur.kane_plan, extra_info: data.extra_info ?? cur.extra_info };
  const textChanged =
    cur.title !== data.title ||
    cur.private_description !== data.private_description ||
    cur.project_type !== data.project_type ||
    cur.app_type !== next.app_type ||
    cur.kane_plan !== next.kane_plan;
  const qualification = textChanged ? "draft" : cur.qualification;
  const status: IdeaStatus =
    cur.status === "selected" ? "selected" : data.discovery_opt_in ? "shared" : qualification !== "draft" ? "validated" : "draft";

  const receipt = await withAudit(who.actor, "idea.save", "idea", async (tx) => {
    const { rows } = await tx.query<{ now: Date; revision: number }>(
      `with u as (
         update ideas set title = $2, private_description = $3, public_summary = $4, discovery_opt_in = $5, project_type = $6,
                qualification = $7, status = $8, app_type = $11, kane_plan = $12, extra_info = $13, frozen_at = null, updated_at = now()
          where id = $1 returning id)
       insert into idea_revisions (idea_id, revision, user_submitted, actor_id)
       select u.id, coalesce((select max(revision) from idea_revisions where idea_id = u.id), 0) + 1, $9, $10 from u
       returning now() as now, revision`,
      [
        cur.id,
        data.title,
        data.private_description,
        data.public_summary,
        data.discovery_opt_in,
        data.project_type,
        qualification,
        status,
        JSON.stringify({ title: data.title, private_description: data.private_description, ...next, public_summary: data.public_summary, discovery_opt_in: data.discovery_opt_in, project_type: data.project_type }),
        who.member.id,
        next.app_type,
        next.kane_plan,
        next.extra_info,
      ],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    // Sharing is a per-person consent too: record the choice of whoever flipped it.
    if (cur.discovery_opt_in !== data.discovery_opt_in) {
      await tx.query("insert into member_consents (member_id, category, granted, source) values ($1, 'idea_discovery', $2, $3)", [who.member.id, data.discovery_opt_in, data.source]);
    }
    // A changed or withdrawn public summary invalidates radar edges and cached vectors.
    if (cur.public_summary !== data.public_summary || !data.discovery_opt_in) {
      await tx.query("delete from idea_similarity_edges where source_idea_id = $1 or target_idea_id = $1", [cur.id]);
      await tx.query("delete from idea_embeddings where idea_id = $1", [cur.id]);
    }
    return {
      result: receiptOf(`IDEA-${cur.id}.r${rows[0].revision}`, rows[0].now),
      resourceId: cur.id,
      before: { status: cur.status, discovery_opt_in: cur.discovery_opt_in, revision: cur.revision },
      after: { status, discovery_opt_in: data.discovery_opt_in, revision: rows[0].revision },
    };
  });
  return { idea: (await getIdea(teamId))!, receipt };
}

/** Captain marks the idea as the one they're building (validated/shared → selected). */
export async function selectIdea(who: ActingMember, teamId: number, captainId: number | null): Promise<Receipt> {
  if (captainId !== who.member.id) throw new AppError("FORBIDDEN", { userMessage: "Only the team captain can lock in the idea." });
  const cur = await getIdea(teamId);
  if (!cur) throw new AppError("NOT_FOUND");
  return withAudit(who.actor, "idea.select", "idea", async (tx) => {
    const { rows } = await tx.query<{ now: Date }>("update ideas set status = 'selected', frozen_at = null, updated_at = now() where id = $1 returning now() as now", [cur.id]);
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receiptOf(`IDEA-${cur.id}`, rows[0].now), resourceId: cur.id, before: { status: cur.status }, after: { status: "selected" } };
  });
}

// ── Validator (T-IDEA-02) ────────────────────────────────────────────────────

const llmSchema = z.object({
  verdict: z.enum(["qualifies", "needs_work", "ineligible"]),
  summary: z.string(),
  criteria: z.array(z.object({ id: z.enum(CRITERION_IDS), status: z.enum(["met", "partial", "missing"]), evidence: z.string() })),
  changes: z.array(z.string()),
  kane_path: z.array(z.object({ capability: z.enum(CAPABILITY_IDS), why: z.string() })),
});

const SYSTEM = `You are the advisory Idea Validator for the Kane CLI Hack Day ("Build anything with an AI coding agent, then use Kane CLI to engineer the confidence to ship it").
Eligible creations include products, apps, agents, extensions, plugins, CI pipelines, workflows AND standalone validation harnesses: a harness on its own is fully eligible.
Assess the idea against exactly these eight criteria, one entry each:
${CRITERIA.map((c) => `- ${c.id}: ${c.question}`).join("\n")}
For each: status met | partial | missing, and evidence = a short quote from the idea text that supports it, or "Not mentioned".
verdict: qualifies (no criterion missing, Kane integration and a functional creation are met), ineligible (no functional creation AND no Kane use), otherwise needs_work.
changes: exactly three concrete, actionable improvements, most important first, each one sentence.
kane_path: 2 to 4 Kane capabilities from this list, in the order the team should adopt them, each with a one-line reason tied to the idea:
${Object.entries(KANE_CAPABILITIES).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
summary: one or two plain sentences. You are advisory only: never present this as a score, ranking or judging outcome. Never invent facts about the team.`;

/**
 * Assess an idea. `useAi` false keeps the text off the model entirely.
 * The LLM output is checked (all eight criteria present) and topped up from
 * the rubric where it falls short; any failure returns the rubric result.
 */
export async function assessIdea(input: IdeaInput, opts: { useAi?: boolean; now?: Date } = {}): Promise<Assessment> {
  const rules = ruleAssessment(input);
  const at = (opts.now ?? new Date()).toISOString();
  if (opts.useAi === false) return { ...rules, assessed_at: at, warning: "Rule-based check (AI not used, by your choice)." };

  const drafted = await draftObject({
    schema: llmSchema,
    system: SYSTEM,
    prompt: `Project type: ${PROJECT_TYPE_LABEL[input.project_type]}\nTitle: ${input.title}\nIdea:\n${input.description.slice(0, 4000)}`,
    fallback: () => null as unknown as z.infer<typeof llmSchema>,
  });
  const v = drafted.value;
  if (drafted.generator !== "llm" || !v) return { ...rules, assessed_at: at, warning: drafted.warning };

  const byId = new Map(v.criteria.map((c) => [c.id, c]));
  if (CRITERIA.some((c) => !byId.has(c.id))) return { ...rules, assessed_at: at, warning: "AI answer was incomplete; rule-based check shown." };

  const changes = [...v.changes.map((s) => s.trim()).filter(Boolean), ...rules.changes].slice(0, 3) as [string, string, string];
  const kanePath = v.kane_path.length ? dedupePath(v.kane_path) : rules.kane_path;
  return {
    version: "idea-validator@1",
    verdict: v.verdict,
    summary: v.summary.slice(0, 600),
    criteria: CRITERIA.map((c) => ({ id: c.id, label: c.label, status: byId.get(c.id)!.status, evidence: byId.get(c.id)!.evidence.slice(0, 300) })),
    changes,
    kane_path: kanePath,
    generator: "llm",
    model: drafted.model,
    advisory: true,
    assessed_at: at,
  };
}

function dedupePath(path: { capability: KaneCapability; why: string }[]) {
  const seen = new Set<KaneCapability>();
  return path
    .filter((p) => !seen.has(p.capability) && seen.add(p.capability))
    .slice(0, 5)
    .map((p) => ({ capability: p.capability, label: KANE_CAPABILITIES[p.capability], why: p.why.slice(0, 240) }));
}

/** Validate the team's current idea and store the assessment as a revision. Any team member. */
export async function validateTeamIdea(who: ActingMember, teamId: number, opts: { useAi?: boolean } = {}): Promise<{ assessment: Assessment; receipt: Receipt }> {
  await requireFlag("idea");
  const idea = await getIdea(teamId);
  if (!idea) throw new AppError("NOT_FOUND");
  const text = [
    idea.app_type && `Type of app: ${idea.app_type}`,
    idea.private_description,
    idea.kane_plan && `How we'll use Kane CLI: ${idea.kane_plan}`,
    idea.extra_info,
    idea.public_summary,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (text.trim().length < 20) throw new AppError("VALIDATION_FAILED", { userMessage: "Describe the idea in a sentence or two first, then validate." });

  const assessment = await assessIdea({ title: idea.title, description: text, project_type: idea.project_type }, { useAi: opts.useAi });
  const receipt = await withAudit(who.actor, "idea.validate", "idea", async (tx) => {
    const { rows } = await tx.query<{ now: Date; revision: number }>(
      `insert into idea_revisions (idea_id, revision, user_submitted, assessment, actor_id)
       values ($1, coalesce((select max(revision) from idea_revisions where idea_id = $1), 0) + 1, $2, $3, $4)
       returning now() as now, revision`,
      [
        idea.id,
        JSON.stringify({ title: idea.title, private_description: idea.private_description, public_summary: idea.public_summary, discovery_opt_in: idea.discovery_opt_in, project_type: idea.project_type }),
        JSON.stringify(assessment),
        who.member.id,
      ],
    );
    // A frozen idea comes out of the freeze, like a save.
    await tx.query(
      `update ideas set qualification = $2, status = case when status in ('draft','frozen') then 'validated' else status end, frozen_at = null, updated_at = now()
        where id = $1`,
      [idea.id, assessment.verdict],
    );
    return {
      result: receiptOf(`IDEA-${idea.id}.r${rows[0].revision}`, rows[0].now),
      resourceId: idea.id,
      payload: { verdict: assessment.verdict, generator: assessment.generator, advisory: true },
    };
  });
  return { assessment, receipt };
}

// ── The deterministic rubric (fallback, and the AI-off path) ─────────────────

type Rule = { strong: RegExp; weak: RegExp };

const RULES: Record<CriterionId, Rule> = {
  functional_deliverable: {
    strong: /\b(app|application|web app|website|site|tracker|game|platform|api|plugin|extension|cli|tool|pipeline|harness|workflow|bot|dashboard|service|github action|action|agent|sdk|library|gate)\b/i,
    weak: /\b(build|make|create|ship|prototype|mvp)\w*/i,
  },
  agent_use: {
    strong: /\b(codex|claude( code)?|cursor|copilot|coding agent|ai agent|llm|gpt|agentic|openai)\b/i,
    weak: /\b(ai|agents?|model|autonomous)\b/i,
  },
  kane_integration: {
    strong: /kane[\s\S]{0,80}\b(test|verif|validat|run|assur|coverage|regress|flow|evidence|check)|\b(test|verif|validat|check)\w*[\s\S]{0,80}\bkane\b/i,
    weak: /\b(kane|testmu|lambdatest|test manager)\b/i,
  },
  repeatability: {
    strong: /\b(repeatable|reusable|repeat\w*|re-?run|regression|ci|cd|on every (pr|push|commit|deploy|change)|github actions?|pipeline|scheduled|nightly|suite|testmd|_test\.md|same (seeded|test|fixture)\w* \w+|seeded (data|tasks?|users?|fixtures?))\b/i,
    weak: /\b(tests?|automat\w*|scripts?)\b/i,
  },
  feedback_loop: {
    strong: /\b(block\w*|gate\w*|fail the build|release (decision|readiness)|go\/no-?go|diagnos\w*|root cause|auto-?fix\w*|triage\w*|rollback|open\w* (an )?issues?|pr comments?|feedback|self-?heal\w*|guides? the (coding )?agent|next change)\b/i,
    weak: /\b(report\w*|alert\w*|notif\w*|fix\w*|dashboard)\b/i,
  },
  actual_proof: {
    strong: /\b(evidence|screenshots?|recordings?|videos?|logs?|artifacts?|traces?|proof|report (url|link)|real (run|execution|app|site))\b/i,
    weak: /\b(demo|show|results?)\b/i,
  },
  engineering_impact: {
    strong: /\b(faster|minutes|hours|reduc\w*|sav\w*|cut\w*|confidence|fewer (bugs|regressions)|catch\w* [\s\S]{0,30}before|time to (ship|merge|release)|flak\w*|coverage gaps?|mttr|escap\w* defects?|(decid\w*|choose|prioriti\w*)[\s\S]{0,40}\b(ship|release|fix)\w*)\b/i,
    weak: /\b(quality|reliab\w*|speed|efficien\w*|productiv\w*)\b/i,
  },
  feasible_demo: {
    strong: /\b(mvp|demo|demonstrat\w*|in (a|one) day|first version|v0|scope|live|today|by 6|at the event|on stage)\b/i,
    weak: /./,
  },
};

const ADVICE: Record<CriterionId, { missing: string; partial: string }> = {
  functional_deliverable: {
    missing: "Name the concrete thing you'll ship (app, plugin, CI job or a standalone harness) and the one outcome it produces.",
    partial: "Say exactly what runs at the end of the day and what someone sees when it works.",
  },
  agent_use: {
    missing: "Say where an AI coding agent does real work: writing the harness, generating tests, or deciding what to verify.",
    partial: "Make the agent's job explicit: which step does the agent own, and how is its output checked?",
  },
  kane_integration: {
    missing: "Put Kane CLI at the centre: pick the critical flows it will verify and what decision each run feeds.",
    partial: "Go past one isolated Kane run: verify the flows that matter and wire the result into your workflow.",
  },
  repeatability: {
    missing: "Make verification repeatable: save the Kane runs as _test.md files and re-run them on every change.",
    partial: "Turn the checks into a suite that runs from CI or a script, not by hand.",
  },
  feedback_loop: {
    missing: "Close the loop: let a failing Kane run block a merge, open an issue or trigger a fix-and-reverify step.",
    partial: "Say what happens when verification fails: who or what acts on it, and how you re-verify the fix.",
  },
  actual_proof: {
    missing: "Plan the proof now: a real run against real software with logs, recordings or a report link you can show judges.",
    partial: "Decide which evidence (Kane report link, recording, logs) you'll attach to your submission.",
  },
  engineering_impact: {
    missing: "State the impact you'll measure, e.g. minutes to a release decision or regressions caught before merge.",
    partial: "Put a number on the impact and say how you'll measure it during the demo.",
  },
  feasible_demo: {
    missing: "Cut scope to an MVP you can demo live by the submission lock; list what's out of scope.",
    partial: "Write the 3-minute demo script: what's built, the harness, a witnessed Kane run, and a failure it catches.",
  },
};

const PRIORITY: CriterionId[] = ["kane_integration", "functional_deliverable", "feedback_loop", "actual_proof", "repeatability", "agent_use", "feasible_demo", "engineering_impact"];

const GENERIC_CHANGES = [
  "Rehearse the failure path: show Kane catching a real regression, the fix, and the re-run passing.",
  "Write a one-paragraph public summary and opt in to the Idea Radar to see where you're distinct.",
  "Pick the single metric you'll show on stage and capture its baseline before you build.",
];

/** Sentence around the first match, trimmed, as quoted evidence. */
function quote(text: string, re: RegExp) {
  const m = re.exec(text);
  if (!m) return null;
  let start = Math.max(text.lastIndexOf(".", m.index) + 1, m.index - 80, 0);
  // Cut back at a word boundary, never mid-word ("how which…" from "show which…").
  if (start > 0 && /\S/.test(text[start - 1])) start = text.indexOf(" ", start) + 1 || start;
  const endDot = text.indexOf(".", m.index + m[0].length);
  const end = Math.min(endDot === -1 ? text.length : endDot + 1, m.index + m[0].length + 100);
  return `“${text.slice(start, end).trim().replace(/\s+/g, " ")}”`;
}

export function ruleAssessment(input: IdeaInput): Omit<Assessment, "assessed_at"> {
  const text = `${input.title}. ${input.description}`.trim();
  const tooShort = input.description.trim().length < 40;
  const harnessType = ["validation_harness", "ci_pipeline", "workflow", "plugin", "extension", "tool", "application", "agent"].includes(input.project_type);

  const criteria: CriterionResult[] = CRITERIA.map((c) => {
    const r = RULES[c.id];
    let status: CriterionResult["status"] = "missing";
    let evidence = "Not mentioned";
    const strong = quote(text, r.strong);
    const weak = c.id === "feasible_demo" ? null : quote(text, r.weak);
    if (strong) [status, evidence] = ["met", strong];
    else if (weak) [status, evidence] = ["partial", weak];

    if (c.id === "functional_deliverable" && harnessType) {
      // A standalone harness, CI pipeline or plugin IS the creation (BRIEF: equal eligibility).
      status = strong ? "met" : "partial";
      evidence = strong ?? `Project type: ${PROJECT_TYPE_LABEL[input.project_type]}`;
    }
    if (c.id === "feasible_demo" && !strong) {
      status = tooShort ? "missing" : "partial";
      evidence = tooShort ? "Too little detail to judge scope" : "No MVP or demo scope stated";
    }
    return { id: c.id, label: c.label, status, evidence };
  });

  const s = Object.fromEntries(criteria.map((c) => [c.id, c.status])) as Record<CriterionId, CriterionResult["status"]>;
  const missing = criteria.filter((c) => c.status === "missing").length;
  const met = criteria.filter((c) => c.status === "met").length;
  const verdict: Verdict =
    tooShort && met <= 1
      ? "ineligible"
      : s.functional_deliverable === "missing" && s.kane_integration === "missing"
        ? "ineligible"
        : missing === 0 && s.kane_integration === "met" && s.functional_deliverable === "met" && met >= 5
          ? "qualifies"
          : "needs_work";

  const changes = [
    ...PRIORITY.filter((id) => s[id] === "missing").map((id) => ADVICE[id].missing),
    ...PRIORITY.filter((id) => s[id] === "partial").map((id) => ADVICE[id].partial),
    ...GENERIC_CHANGES,
  ].slice(0, 3) as [string, string, string];

  return {
    version: "idea-validator@1",
    verdict,
    summary:
      verdict === "qualifies"
        ? `Covers all eight criteria (${met} clearly). Sharpen the proof and the demo.`
        : verdict === "ineligible"
          ? "As written, there's no clear creation or Kane use yet. Describe what you'll build and what Kane verifies."
          : `${met} of 8 criteria are clearly covered and ${missing} ${missing === 1 ? "is" : "are"} missing. Work through the three changes below.`,
    criteria,
    changes,
    kane_path: kanePath(text, input.project_type, s),
    generator: "rules",
    model: null,
    advisory: true,
  };
}

function kanePath(text: string, type: ProjectType, s: Record<CriterionId, CriterionResult["status"]>) {
  const out: { capability: KaneCapability; why: string }[] = [{ capability: "run", why: "Start by driving your most important user flow with an objective and watch it pass or fail." }];
  if (/\b(spec|prd|requirement|acceptance criteria|user stor)/i.test(text) || type === "validation_harness") {
    out.push({ capability: "assurance", why: "You have requirements to work from: generate a requirement-linked suite instead of hand-writing tests." });
  }
  if (s.repeatability !== "met" || /\b(regression|suite)\b/i.test(text)) {
    out.push({ capability: "testmd", why: "Save the runs as _test.md so every change re-checks the same flows." });
  }
  if (/\b(ci|pipeline|github action|pull request|\bpr\b|merge|deploy)/i.test(text) || type === "ci_pipeline") {
    out.push({ capability: "testrun", why: "Run the saved suite from CI and gate the merge on its result." });
  }
  if (/\b(mobile|android|ios|device|cross-?browser|safari|firefox|cloud)\b/i.test(text)) {
    out.push({ capability: "remote", why: "Your idea spans devices or browsers: run on cloud browsers, emulators or simulators." });
  }
  if (/\bcoverage\b/i.test(text)) out.push({ capability: "coverage", why: "Show which flows are verified and which are still gaps." });
  if (s.actual_proof !== "met" || out.length < 3) out.push({ capability: "evidence", why: "Keep the report links, logs and recordings as the proof you'll show judges." });
  return dedupePath(out).slice(0, 4);
}

// ── Idea Radar (T-IDEA-05) ───────────────────────────────────────────────────

export type RadarLabel = "similar_angle" | "possible_overlap" | "complementary";
export type RadarMatch = {
  team_id: number;
  team_name: string;
  team_slug: string;
  /** The other team's OPT-IN public summary. Never private text. */
  public_summary: string;
  project_type: ProjectType;
  label: RadarLabel;
  similarity: number;
  explanation: string;
};
export type RadarResult =
  | { status: "needs_opt_in"; matches: []; method: null; compared: 0 }
  | { status: "ok"; matches: RadarMatch[]; method: "embeddings" | "token_overlap"; compared: number; warning?: string };

/** Public-only view of an idea: this type has no private field on purpose. */
type PublicIdea = { id: number; team_id: number; team_name: string; team_slug: string; public_summary: string; project_type: ProjectType };

const EMBED_MODEL = process.env.HACKOS_EMBED_MODEL ?? "openai/text-embedding-3-small";
const gatewayConfigured = () => !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);

/**
 * Compare the team's opted-in public summary with other teams' opted-in
 * public summaries. Labels are suggestions, never ownership claims. Writes
 * idea_similarity_edges for organizers; returns matches for the team.
 */
export async function ideaRadar(who: ActingMember, teamId: number): Promise<RadarResult> {
  await requireFlag("idea");
  const pool = await query<PublicIdea>(
    `select i.id, i.team_id, t.name as team_name, t.slug as team_slug, i.public_summary, i.project_type
       from ideas i join teams t on t.id = i.team_id
      where i.discovery_opt_in and i.public_summary is not null and length(trim(i.public_summary)) > 0
        and t.state <> 'withdrawn'`,
  );
  const mine = pool.find((p) => p.team_id === teamId);
  if (!mine) return { status: "needs_opt_in", matches: [], method: null, compared: 0 };
  const others = pool.filter((p) => p.team_id !== teamId);

  let method: "embeddings" | "token_overlap" = "token_overlap";
  let warning: string | undefined;
  let sims: number[] = others.map((o) => jaccard(tokens(mine.public_summary), tokens(o.public_summary)));
  if (others.length && gatewayConfigured()) {
    try {
      const vecs = await embeddingsFor([mine, ...others]);
      sims = others.map((o) => cosineSimilarity(vecs.get(mine.id)!, vecs.get(o.id)!));
      method = "embeddings";
    } catch (err) {
      console.error("[ideas] radar embeddings fell back to token overlap", (err as Error)?.name);
      warning = "AI embeddings unavailable; using word overlap.";
    }
  } else if (others.length) {
    warning = "AI embeddings not configured; using word overlap.";
  }

  const matches: RadarMatch[] = [];
  others.forEach((o, i) => {
    const label = labelFor(sims[i], method, mine.project_type, o.project_type);
    if (!label) return;
    matches.push({
      team_id: o.team_id,
      team_name: o.team_name,
      team_slug: o.team_slug,
      public_summary: o.public_summary,
      project_type: o.project_type,
      label,
      similarity: Math.round(sims[i] * 1000) / 1000,
      explanation: explain(label, mine, o),
    });
  });
  matches.sort((a, b) => b.similarity - a.similarity);
  const top = matches.slice(0, 8);

  for (const m of top) {
    const target = others.find((o) => o.team_id === m.team_id)!;
    await query(
      `insert into idea_similarity_edges (source_idea_id, target_idea_id, similarity, label, explanation)
       values ($1, $2, $3, $4, $5)
       on conflict (source_idea_id, target_idea_id) do update set similarity = excluded.similarity, label = excluded.label, explanation = excluded.explanation, created_at = now()`,
      [mine.id, target.id, m.similarity, m.label, m.explanation],
    ).catch(() => {});
  }
  await writeAudit(who.actor, { action: "idea.radar", resourceType: "idea", resourceId: mine.id, payload: { method, compared: others.length, matches: top.length } }).catch(() => {});
  return { status: "ok", matches: top, method, compared: others.length, warning };
}

async function embeddingsFor(ideas: PublicIdea[]) {
  const out = new Map<number, number[]>();
  const cached = await query<{ idea_id: number; summary_sha: string; vector: number[] }>(
    "select idea_id, summary_sha, vector from idea_embeddings where model = $1 and idea_id = any($2::bigint[])",
    [EMBED_MODEL, ideas.map((i) => i.id)],
  );
  const byId = new Map(cached.map((c) => [c.idea_id, c]));
  const missing = ideas.filter((i) => byId.get(i.id)?.summary_sha !== sha256(i.public_summary));
  ideas.forEach((i) => !missing.includes(i) && out.set(i.id, byId.get(i.id)!.vector));
  if (missing.length) {
    const { embeddings } = await embedMany({ model: EMBED_MODEL, values: missing.map((i) => i.public_summary), abortSignal: AbortSignal.timeout(15_000) });
    for (const [n, i] of missing.entries()) {
      out.set(i.id, embeddings[n]);
      await query(
        `insert into idea_embeddings (idea_id, summary_sha, model, vector) values ($1, $2, $3, $4)
         on conflict (idea_id, model) do update set summary_sha = excluded.summary_sha, vector = excluded.vector, created_at = now()`,
        [i.id, sha256(i.public_summary), EMBED_MODEL, embeddings[n]],
      ).catch(() => {});
    }
  }
  return out;
}

const BUILD_TYPES = new Set<ProjectType>(["application", "agent", "extension", "plugin", "tool"]);
const VERIFY_TYPES = new Set<ProjectType>(["validation_harness", "ci_pipeline", "workflow"]);
const complementaryTypes = (a: ProjectType, b: ProjectType) => (BUILD_TYPES.has(a) && VERIFY_TYPES.has(b)) || (VERIFY_TYPES.has(a) && BUILD_TYPES.has(b));

function labelFor(sim: number, method: "embeddings" | "token_overlap", a: ProjectType, b: ProjectType): RadarLabel | null {
  const [overlap, similar, comp] = method === "embeddings" ? [0.8, 0.65, 0.5] : [0.45, 0.25, 0.12];
  if (sim >= overlap) return "possible_overlap";
  if (sim >= similar) return complementaryTypes(a, b) ? "complementary" : "similar_angle";
  if (sim >= comp && complementaryTypes(a, b)) return "complementary";
  return null;
}

function explain(label: RadarLabel, a: PublicIdea, b: PublicIdea) {
  const shared = [...tokens(a.public_summary)].filter((t) => tokens(b.public_summary).has(t)).slice(0, 5);
  const words = shared.length ? `Both public summaries mention ${shared.join(", ")}. ` : "";
  if (label === "possible_overlap") return `${words}Close in problem and approach. Overlap is allowed: differentiate on your validation architecture or the proof you'll show.`;
  if (label === "complementary") return `${words}Same area, different kind of build (${PROJECT_TYPE_LABEL[a.project_type]} vs ${PROJECT_TYPE_LABEL[b.project_type]}). A collaboration could pair them.`;
  return `${words}A similar angle on the problem. Make your Kane harness or audience the distinct part.`;
}

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or our that the their them this to we will with you your using use uses build builds building app tool our which when what who how can make makes".split(" "),
);

function tokens(s: string) {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(ing|ed|es|s)$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((t) => b.has(t) && inter++);
  return inter / (a.size + b.size - inter);
}
