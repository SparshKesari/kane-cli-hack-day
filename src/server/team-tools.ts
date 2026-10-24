import "server-only";
import { isEnabled, requireFlag } from "@/lib/flags";
import { AppError, parse, siteUrl, z, zx, type toEnvelope } from "./core";
import { PROJECT_TYPES, assessIdea, getIdea, latestAssessment, saveIdea, validateTeamIdea, type Assessment } from "./ideas";
import { suggestions } from "./match";
import { createTeam, currentTeamOf, joinTeam, listRecruitingTeams, type ActingMember } from "./teams";
import { trackLabel } from "@/data/hackday";

// Envelope builders for the teams-ideas use cases, shared by /api/v1 route
// handlers (wrap in envelopeResponse) and the event MCP server (wrap in
// toEnvelope): team_find, team_create, team_join, idea_validate,
// idea_check_overlap. Writes that change a team need explicit_confirmation
// (CONTRACTS §5); without it they return needs_action and change nothing.

export type EnvelopeInput = Parameters<typeof toEnvelope>[0];

/** explicit_confirmation: true, exactly (not "true", not 1). */
const confirmed = (input: unknown) => (input as { explicit_confirmation?: unknown } | null)?.explicit_confirmation === true;

function needsConfirmation(message: string, tool: string, fallbackText: string): EnvelopeInput {
  return {
    status: "needs_action",
    message,
    actions: [{ id: "confirm", label: "Ask the participant, then call again with explicit_confirmation: true", requires_human_confirmation: true, tool }],
    fallbackText,
  };
}

/** The member's team id, or a clear error for team-scoped tools. */
async function myTeamId(who: ActingMember) {
  const cur = await currentTeamOf(who.member.id);
  if (!cur) throw new AppError("NOT_FOUND", { userMessage: "You're not on a team yet. Create one or join with an invite code." });
  return cur;
}

// ── team_find ────────────────────────────────────────────────────────────────

export async function teamFindTool(who: ActingMember, input: unknown): Promise<EnvelopeInput> {
  const f = parse(z.object({ skill: z.string().max(32).optional(), show: z.enum(["all", "people", "teams"]).default("all") }), input ?? {});
  if (!(await isEnabled("match"))) {
    // Matchmaker off: still list open teams (no people), so joining keeps working.
    const teams = await listRecruitingTeams({ skill: f.skill ?? null, limit: 20 });
    return {
      status: "partial",
      message: `${teams.length} open teams. People matching is switched off right now.`,
      data: { teams: teams.map((t) => ({ id: t.id, name: t.name, track: trackLabel(t.track), open_seats: t.cap - t.member_count, summary: t.summary_public, seeking: t.seeking_skills })), people: [] },
      warnings: ["Matchmaker disabled by organizers"],
      links: [{ label: "Team finder", url: "/match" }],
    };
  }
  const r = await suggestions(who, { skill: f.skill, show: f.show });
  const teams = r.teams.map((t) => ({ id: t.team_id, name: t.name, track: trackLabel(t.track), open_seats: t.open_seats, summary: t.summary_public, seeking: t.seeking_skills, why: t.explanation }));
  const people = r.people.map((p) => ({ member_id: p.member_id, name: p.name, skills: p.skills, interests: p.interests, availability: p.availability, why: p.explanation }));
  const lines = [
    ...teams.slice(0, 5).map((t) => `Team ${t.name} (${t.open_seats} open): ${t.why}`),
    ...people.slice(0, 5).map((p) => `${p.name}: ${p.why}`),
  ];
  return {
    message: `${teams.length} open teams and ${people.length} people looking (opted-in only).`,
    data: { teams, people, my_team: r.myTeam ? { id: r.myTeam.team_id, name: r.myTeam.name } : null },
    uiType: "TeamMatchCard",
    links: [{ label: "Team finder", url: "/match" }],
    actions: [{ id: "request_intro", label: "Request an intro on /match", requires_human_confirmation: true, href: siteUrl("/match") }],
    fallbackText: lines.length ? `${lines.join("\n")}\nRequest intros at ${siteUrl("/match")}` : `No opted-in matches yet. Opt in at ${siteUrl("/match")}.`,
  };
}

// ── team_create ──────────────────────────────────────────────────────────────

export async function teamCreateTool(who: ActingMember, input: unknown): Promise<EnvelopeInput> {
  if (!confirmed(input)) return needsConfirmation("Creating a team makes you its captain.", "team_create", "Confirm with the participant before creating the team.");
  const team = await createTeam(who, input);
  return {
    message: `Team created. You're captain. Showcase reserved at /ship/${team.slug}.`,
    data: { team_id: team.teamId, slug: team.slug, state: team.state, receipt: team.receipt },
    links: [
      { label: "Team hub", url: `/t/${team.slug}` },
      { label: "Invite teammates", url: "/team" },
    ],
    fallbackText: `Created ${team.slug} (receipt ${team.receipt.id}). Invite teammates at ${siteUrl("/team")}.`,
  };
}

// ── team_join ────────────────────────────────────────────────────────────────

export async function teamJoinTool(who: ActingMember, input: unknown): Promise<EnvelopeInput> {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (!confirmed(raw) && raw.confirm !== true && raw.confirm !== "on") {
    return needsConfirmation("Joining moves you onto that team (and off any current one).", "team_join", "Confirm with the participant before joining.");
  }
  const joined = await joinTeam(who, { ...raw, confirm: true });
  return {
    message: `You joined ${joined.name}.${joined.leftTeam ? ` You left ${joined.leftTeam}.` : ""}`,
    data: { team_id: joined.teamId, slug: joined.slug, left_team: joined.leftTeam, receipt: joined.receipt },
    links: [{ label: "Team hub", url: `/t/${joined.slug}` }],
    fallbackText: `Joined ${joined.name} (receipt ${joined.receipt.id}). Team hub: ${siteUrl(`/t/${joined.slug}`)}`,
  };
}

// ── ideas ────────────────────────────────────────────────────────────────────

const validateInput = z.object({
  /** Ad-hoc check (not stored): any participant, team or not. Omit to validate the team's saved idea. */
  project_idea: z.string().trim().min(20).max(4000).optional(),
  title: zx.optText(120),
  project_type: z.enum(PROJECT_TYPES).default("other"),
  use_ai: z.boolean().default(true),
});

function assessmentText(a: Assessment) {
  const marks = { met: "✓", partial: "!", missing: "✗" } as const;
  return [
    `Advisory — not an official score. Verdict: ${a.verdict.replace("_", " ")} (${a.generator === "llm" ? "AI draft" : "rule-based"}).`,
    ...a.criteria.map((c) => `${marks[c.status]} ${c.label}: ${c.evidence}`),
    "Three changes:",
    ...a.changes.map((c, i) => `${i + 1}. ${c}`),
    `Kane path: ${a.kane_path.map((p) => p.capability).join(" → ")}`,
  ].join("\n");
}

export async function ideaValidateTool(who: ActingMember, input: unknown): Promise<EnvelopeInput> {
  await requireFlag("idea");
  const data = parse(validateInput, input ?? {});
  let assessment: Assessment;
  let receipt = null;
  let slug: string | null = null;
  if (data.project_idea) {
    assessment = await assessIdea({ title: data.title ?? "Untitled", description: data.project_idea, project_type: data.project_type }, { useAi: data.use_ai });
  } else {
    const team = await myTeamId(who);
    slug = team.slug;
    const out = await validateTeamIdea(who, team.team_id, { useAi: data.use_ai });
    assessment = out.assessment;
    receipt = out.receipt;
  }
  return {
    status: assessment.verdict === "qualifies" ? "ok" : "needs_action",
    message: `Advisory: ${assessment.verdict.replace("_", " ")}. Not an official score.`,
    data: { assessment, receipt },
    uiType: "IdeaChecklist",
    warnings: assessment.warning ? [assessment.warning] : [],
    links: slug ? [{ label: "Idea lab", url: `/t/${slug}/idea` }] : [],
    fallbackText: assessmentText(assessment),
  };
}

/** Save the team's idea (a new revision). Sharing a public summary is a consent: it needs explicit confirmation. */
export async function ideaSaveTool(who: ActingMember, input: unknown): Promise<EnvelopeInput> {
  const team = await myTeamId(who);
  const raw = (input ?? {}) as Record<string, unknown>;
  if (raw.discovery_opt_in === true && !confirmed(raw)) {
    return needsConfirmation("Sharing a public summary with other teams needs the participant's OK.", "idea_save", "Ask before sharing the public summary.");
  }
  const { idea, receipt } = await saveIdea(who, team.team_id, { ...raw, source: "mcp" });
  return {
    message: `Saved revision ${idea.revision}. Status: ${idea.status}.`,
    data: { idea_id: idea.id, revision: idea.revision, status: idea.status, discovery_opt_in: idea.discovery_opt_in, receipt },
    links: [{ label: "Idea lab", url: `/t/${team.slug}/idea` }],
    fallbackText: `Saved idea revision ${idea.revision} (receipt ${receipt.id}).`,
  };
}

/** The team's idea for its own members (private text included: team scope only). */
export async function ideaGetTool(who: ActingMember): Promise<EnvelopeInput> {
  const team = await myTeamId(who);
  const idea = await getIdea(team.team_id);
  if (!idea) throw new AppError("NOT_FOUND");
  const latest = await latestAssessment(idea.id);
  return {
    message: `${idea.title} · ${idea.status}${idea.locked ? " (frozen)" : ""}`,
    data: { idea, assessment: latest?.assessment ?? null, assessed_revision: latest?.revision ?? null },
    links: [{ label: "Idea lab", url: `/t/${team.slug}/idea` }],
    fallbackText: `${idea.title} (${idea.status}). Edit at ${siteUrl(`/t/${team.slug}/idea`)}`,
  };
}
