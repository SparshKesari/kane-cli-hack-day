import "server-only";
import { query } from "@/lib/db";
import { DEFAULT_TRACK } from "@/data/hackday";
import { draftText } from "./ai";
import { AppError, serverNow, withAudit, z, type Actor } from "./core";
import type { MemberRow } from "./auth";
import { listMilestones } from "./kane";
import * as activation from "./activation";
import { requestCodexCoupon } from "./codex-coupon";
import { enforceRateLimit } from "./ratelimit";
import { getActivationView, setTick } from "./event-activation";
import * as deck from "./deck";
import * as help from "./help";
import * as ideas from "./ideas";
import * as passport from "./passport";
import * as story from "./story";
import { getSubmissionContext } from "./submission";
import * as teamPage from "./team-page";
import * as teams from "./teams";

// Adapters the MCP server (src/server/mcp.ts) calls for tools owned by other
// areas. Since the merge into hack-os each one delegates to that area's
// service module (passport/activation, teams, ideas, help, submission,
// story/deck), so MCP and the web share one set of rules (zod → scope →
// idempotency → audit → receipt). participantStatus, findTeams,
// socialDraft and the renderer callback are still local read/draft helpers.

export type Ctx = { member: MemberRow; actor: Actor; requestId: string };

async function teamRow(teamId: number | null) {
  if (!teamId) return null;
  const [t] = await query<{ id: number; slug: string; name: string; state: string; max_size: number; recruiting_open: boolean; captain_id: number | null; is_solo: boolean; locked: boolean }>(
    `select id, slug, name, state, max_size, recruiting_open, captain_id, is_solo,
            (roster_locked_at is not null or state in ('roster_locked','submitted','withdrawn')) as locked
       from teams where id = $1`,
    [teamId],
  );
  return t ?? null;
}

// ── identity (→ src/server/{passport,activation}.ts) ─────────────────────────

const CONSENT_CATEGORIES = ["selfie_storage", "photo_publication", "face_matching", "social_mention", "teammate_discovery", "idea_discovery", "activity_publication"] as const;

export async function participantStatus(m: MemberRow) {
  const [team, consents, activation, tickets, idea, steps] = await Promise.all([
    teamRow(m.team_id),
    query<{ category: string; granted: boolean; recorded_at: Date }>("select category, granted, recorded_at from member_consent_current where member_id = $1", [m.id]),
    query<{ id: number; status: string; updated_at: Date; receipt_code: string | null }>(
      "select id, status, updated_at, receipt_code from activation_sessions where member_id = $1 order by created_at desc limit 1",
      [m.id],
    ),
    query<{ code: string; status: string }>("select code, status from help_tickets where member_id = $1 and status not in ('resolved','closed','duplicate') order by created_at desc limit 3", [m.id]),
    // A team's idea row starts with only the team name: it counts as saved once it has a description.
    m.team_id ? query<{ saved: boolean }>("select trim(private_description) <> '' as saved from ideas where team_id = $1", [m.team_id]) : Promise.resolve([]),
    getActivationView(m.id),
  ]);
  const act = activation[0] ?? null;
  const ideaSaved = !!idea[0]?.saved;
  const activated = steps.done || !!m.activated_at || act?.status === "active";
  // The same order as the site (flowState): a team, the captain locks it, activation, the idea, then build.
  const next = !team
    ? { id: "find_team", label: "Create or join a team", href: "/match" }
    : !team.locked && !activated
      ? team.captain_id === m.id
        ? { id: "lock_team", label: "Lock your final team (team_lock), then activate", href: "/team" }
        : { id: "lock_team", label: "Wait for your captain to lock the team, then activate", href: "/team" }
    : !activated
      ? { id: "activate", label: "Finish activation", href: "/activate" }
      : !ideaSaved
        ? { id: "idea", label: "Write your idea, check it with $hack-os, then save it on the Idea tab", href: `/t/${team.slug}/idea` }
        : { id: "build", label: "Report a Kane run from your harness", href: `/t/${team.slug}/proof` };
  return {
    member: { public_code: m.public_code, name: m.display_name ?? m.name, role: m.role, checked_in: !!m.checked_in_at, activated: !!m.activated_at },
    team: team ? { slug: team.slug, name: team.name, state: team.state, locked: team.locked, captain: team.captain_id === m.id, hub_url: `/t/${team.slug}` } : null,
    activation: act ? { session_id: act.id, status: act.status, receipt_code: act.receipt_code, updated_at: act.updated_at.toISOString() } : null,
    consents: Object.fromEntries(CONSENT_CATEGORIES.map((c) => [c, consents.find((x) => x.category === c)?.granted ?? null])),
    // The /activate checklist: 1 TestMu AI sign-up (tick), 2 the plan claim (kanehack claim), 3 the emailed Codex coupon (tick).
    activation_steps: {
      testmu_signup: steps.ticks.has("testmu_signup"),
      testmu_plan: steps.plan?.status ?? "not_started",
      codex_credits: steps.ticks.has("codex_credits"),
      done: steps.done,
    },
    idea: team ? { saved: ideaSaved, url: `/t/${team.slug}/idea` } : null,
    open_help: tickets,
    next_action: next,
    privacy_scope: "You see your own record and your team's. Nothing here is public.",
  };
}

export const profileSchema = z.object({
  delta: z
    .object({
      display_name: z.string().trim().min(1).max(60).optional(),
      github_handle: z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
      skills: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
      interests: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
    })
    .default({}),
  consent_changes: z.array(z.object({ category: z.enum(CONSENT_CATEGORIES), granted: z.boolean() })).max(7).default([]),
});

/** Profile fields + per-category consent (append-only, source 'mcp') through identity's passport service. */
export async function updateProfile(ctx: Ctx, input: z.infer<typeof profileSchema>) {
  const consents = Object.fromEntries(input.consent_changes.map((c) => [c.category, c.granted]));
  const r = await passport.updateProfile(ctx.member, ctx.actor, { ...input.delta, ...(input.consent_changes.length ? { consents } : {}) }, "mcp");
  const now = await serverNow().catch(() => new Date());
  const changed = Object.entries(r.consents_changed as Record<string, boolean>).map(([category, granted]) => ({ category, granted }));
  return { id: ctx.member.public_code ?? `M-${ctx.member.id}`, server_time: now.toISOString(), changed: r.fields, consents: changed };
}

/**
 * Start (or resume) the browser activation ceremony through identity's
 * activation service. The selfie is never taken by an agent: this only
 * returns the /activate URL and the session.
 */
/** Tick (or untick) /activate step 1 or 3 for the person. Step 2 is only ever ticked by a successful claim. */
export async function tickActivation(ctx: Ctx, step: "testmu_signup" | "codex_credits", done: boolean) {
  await setTick(ctx.member, step, done);
  const v = await getActivationView(ctx.member.id);
  return { step, done, activated: v.done };
}

/** Step 3: email their Codex coupon to `email` (default: the signed-in address) if it is on the participant list. */
export async function sendCodexCoupon(ctx: Ctx, email?: string | null) {
  // A person needs one or two tries (their own address, then the one they registered with); this stops list probing.
  await enforceRateLimit(`codex-coupon-member:${ctx.member.id}`, { limit: 10, windowSec: 3600 });
  return requestCodexCoupon(email?.trim() || ctx.member.email);
}

export async function beginActivation(ctx: Ctx) {
  const before = await activation.findSession(ctx.member.id);
  const s = await activation.beginActivation(ctx.member, ctx.actor);
  return { session_id: s.id, status: s.status, resumed: !!before && before.id === s.id, activate_url: `/activate?session=${s.id}`, expires_at: s.expires_at.toISOString() };
}

export async function activationCheckpoint(m: MemberRow, sessionId: number) {
  const st = await activation.getActivationState(m.id);
  if (!st.session || st.session.id !== sessionId) throw new AppError("NOT_FOUND", { userMessage: "No activation session with that id for you. Call activation_begin." });
  const human = st.marker === "awaiting_selfie";
  return {
    session_id: st.session.id,
    status: st.session.status,
    step: st.step,
    marker: st.marker,
    receipt_code: st.session.receipt_code,
    expires_at: st.session.expires_at.toISOString(),
    awaiting_human: st.awaiting_human,
    instruction: human
      ? "STOP browser automation. The participant takes the selfie themselves in the browser, or skips it."
      : st.awaiting_human
        ? "Waiting for the participant in the browser."
        : null,
    checkpoints: st.checkpoints.map((c) => ({ ...c, created_at: new Date(c.created_at).toISOString() })),
  };
}

export const readinessSchema = z.object({
  checks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        status: z.enum(["pass", "fail", "warn", "skip", "skipped"]),
        version: z.string().trim().max(60).optional(),
        detail: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(20),
});

/** Store a doctor report (statuses + versions only) through identity's readiness service. */
export async function reportReadiness(ctx: Ctx, input: z.infer<typeof readinessSchema>) {
  const checks = input.checks.map((c) => ({ ...c, status: c.status === "skipped" ? ("skip" as const) : c.status }));
  const tokenId = ctx.actor.type === "token" && typeof ctx.actor.id === "number" ? ctx.actor.id : null;
  const r = await passport.recordReadiness(ctx.member, ctx.actor, { checks }, "cli", tokenId);
  const failing = checks.filter((c) => c.status === "fail").map((c) => c.id);
  return { id: `RD-${r.id}`, server_time: new Date(r.created_at).toISOString(), ready: failing.length === 0, failing };
}

// ── teams (→ src/server/teams.ts, src/server/match.ts) ───────────────────────

export async function findTeams(filters: { skill?: string; recruiting_only?: boolean; limit?: number }) {
  const teams = await query<{ slug: string; name: string; summary_public: string | null; max_size: number; members: number; recruiting_open: boolean }>(
    `select t.slug, t.name, t.summary_public, t.max_size, t.recruiting_open,
            (select count(*)::int from team_memberships tm where tm.team_id = t.id and tm.left_at is null) as members
       from teams t
      where t.state in ('recruiting','formed') and ($1::boolean is false or t.recruiting_open)
      order by t.recruiting_open desc, t.created_at desc limit $2`,
    [filters.recruiting_only ?? true, Math.min(filters.limit ?? 20, 50)],
  );
  const builders = await query<{ public_code: string | null; display_name: string; skills: string[]; interests: string[] }>(
    `select m.public_code, coalesce(m.display_name, split_part(m.name, ' ', 1)) as display_name, p.skills, p.interests
       from teammate_profiles p join members m on m.id = p.member_id
       join member_consent_current c on c.member_id = m.id and c.category = 'teammate_discovery' and c.granted
      where p.discoverable and m.team_id is null and m.deleted_at is null
        and ($1::text is null or $1 = any(p.skills))
      limit 30`,
    [filters.skill?.toLowerCase() ?? null],
  );
  return {
    teams: teams.map((t) => ({ ...t, seats_left: Math.max(0, t.max_size - t.members), url: `/match?team=${t.slug}` })),
    builders,
    note: "Only teams that are recruiting and people who opted in to teammate discovery are listed.",
  };
}

export const teamCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  track: z.string().trim().max(80).optional(),
  recruiting: z.boolean().default(false),
  solo: z.boolean().default(false),
});

/** One active team per member; team lock and walk-in rules live in teams.ts. */
export async function createTeam(ctx: Ctx, input: z.infer<typeof teamCreateSchema>) {
  const r = await teams.createTeam(
    { member: ctx.member, actor: ctx.actor },
    { name: input.name, track: input.track ?? DEFAULT_TRACK, recruiting_open: input.recruiting, solo: input.solo },
  );
  return { id: r.slug, team_id: r.teamId, slug: r.slug, state: r.state, hub_url: `/t/${r.slug}`, server_time: r.receipt.server_time, receipt: r.receipt };
}

/** Captain only: this is the final team (roster locked, recruiting off, open invites revoked). The tool asked first. */
export async function lockTeam(ctx: Ctx) {
  if (!ctx.member.team_id) throw new AppError("CONFLICT", { userMessage: "Create or join a team first." });
  const receipt = await teams.confirmFinalTeam({ member: ctx.member, actor: ctx.actor }, ctx.member.team_id);
  const t = await teamRow(ctx.member.team_id);
  return { team: t ? { slug: t.slug, name: t.name, state: t.state, hub_url: `/t/${t.slug}` } : null, receipt };
}

/** Accept an invite code (the tool asked the person first; teams.ts checks lock and cap in one transaction). */
export async function joinTeam(ctx: Ctx, code: string) {
  const r = await teams.joinTeam({ member: ctx.member, actor: ctx.actor }, { code, confirm: true });
  return { id: r.slug, team_id: r.teamId, name: r.name, left_team: r.leftTeam, hub_url: `/t/${r.slug}`, server_time: r.receipt.server_time, receipt: r.receipt };
}

// ── ideas (→ src/server/ideas.ts) ─────────────────────────────────────────────

/**
 * Advisory assessment of free text through teams-ideas' validator (LLM with a
 * rule-based fallback). Nothing is stored: the team saves its idea on the
 * Idea tab, where the stored revision and freeze rules apply.
 */
export async function validateIdea(ctx: Ctx, input: { project_idea: string; publication_intent: "private" | "share_summary" }) {
  if (!ctx.member.team_id) throw new AppError("FORBIDDEN", { userMessage: "Ideas belong to a team. Create or join one first." });
  const text = input.project_idea.trim();
  const a = await ideas.assessIdea({ title: text.split(/[.\n]/)[0].slice(0, 120) || "Idea", description: text, project_type: "other" });
  const met = { met: "yes", partial: "partly", missing: "no" } as const;
  return {
    id: `IDEA-CHECK-${ctx.member.team_id}`,
    server_time: a.assessed_at,
    verdict: a.verdict,
    summary: a.summary,
    criteria: a.criteria.map((c) => ({ id: c.id, met: met[c.status], note: c.evidence || c.label })),
    changes: a.changes,
    kane_path: a.kane_path.map((k) => k.label),
    generator: a.generator,
    warning: a.warning ?? null,
    advisory: true as const,
    stored: false,
  };
}

/** Overlaps with other teams' *opted-in public summaries* only. */
/** Save the team's idea (the Idea tab's form, same lock and revision rules). The tool asked first. */
export async function saveTeamIdea(ctx: Ctx, input: { title: string; private_description: string; app_type?: string; kane_plan?: string; extra_info?: string }) {
  if (!ctx.member.team_id) throw new AppError("CONFLICT", { userMessage: "Create or join a team first." });
  const r = await ideas.saveIdea({ member: ctx.member, actor: ctx.actor }, ctx.member.team_id, { ...input, source: "mcp" });
  return { title: r.idea.title, revision: r.idea.revision, receipt: r.receipt };
}

// ── help (→ src/server/help.ts) ──────────────────────────────────────────────

export const HELP_CATEGORY_IDS = help.HELP_CATEGORIES;

/** Docs suggestions from help's fixed docs map (model picks, or keyword match without the gateway). */
export async function diagnoseHelp(member: MemberRow, category: (typeof help.HELP_CATEGORIES)[number], symptom: string) {
  const team = await teamRow(member.team_id);
  const d = await help.diagnoseHelp({ category, summary: symptom.slice(0, 200), details: symptom.length > 200 ? symptom : undefined }, { teamSlug: team?.slug ?? null });
  const steps = d.suggestions.map((s) => `${s.title}: ${s.tip ?? s.steps[0] ?? ""}${s.links[0] ? ` (${s.links[0].url})` : ""}`).join("\n");
  return { ...d, steps: steps || "No matching doc. Ask a mentor with help_create.", escalate: "If this doesn't fix it, call help_create to ask a mentor." };
}

export const helpCreateSchema = z.object({
  category: z.enum(help.HELP_CATEGORIES),
  safe_summary: z.string().trim().min(8).max(200),
  details: z.string().trim().max(2000).optional(),
  tried: z.string().trim().max(1000).optional(),
  run_id: z.string().trim().max(120).optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  table_label: z.string().trim().max(40).optional(),
});

/** Open a mentor ticket through help.ts (secret scrubbing, rate limits, Slack outbox). Idempotent per member + key. */
export async function createHelpTicket(ctx: Ctx, input: z.infer<typeof helpCreateSchema>, key: string | null) {
  const r = await help.createHelpTicket(
    { member: ctx.member, actor: ctx.actor, source: "mcp" },
    {
      category: input.category,
      priority: input.priority,
      summary: input.safe_summary,
      details: input.details,
      tried: input.tried,
      safe_run_id: input.run_id,
      table_label: input.table_label,
      idempotency_key: key ?? undefined,
    },
  );
  return { id: r.ticket.code, ticket_id: r.ticket.id, status: r.ticket.status, server_time: r.receipt.server_time, url: r.ticket.url, replayed: r.replayed, warnings: r.warnings };
}

export async function helpStatus(m: MemberRow, code: string) {
  const t = await help.getHelpTicket(code.trim(), { member: m });
  const last = [...t.messages].reverse().find((x) => x.author_type !== "member") ?? null;
  return {
    code: t.code,
    status: t.status,
    status_label: t.status_label,
    priority: t.priority,
    category: t.category,
    mentor: t.mentor,
    opened_at: t.opened_at,
    last_reply: last ? { author: last.author, body: last.body.slice(0, 500), at: last.created_at } : null,
    url: t.url,
  };
}

// ── submission (→ src/server/submission.ts) ──────────────────────────────────

async function myTeam(m: MemberRow) {
  const t = await teamRow(m.team_id);
  if (!t) throw new AppError("FORBIDDEN", { userMessage: "Join or create a team first." });
  return t;
}

/**
 * The same preflight the Submit tab shows (submission.ts), read-only. Finalize
 * needs the team name typed as confirm_phrase, like the web form.
 */
export async function submissionPreflight(m: MemberRow, projectId?: number | null) {
  const team = await myTeam(m);
  const c = await getSubmissionContext(team.id);
  if (projectId && projectId !== c.project.id) throw new AppError("FORBIDDEN", { userMessage: "That project belongs to another team." });
  const frozen = !!c.submission && ["finalized", "locked", "organizer_exception"].includes(c.submission.status);
  const linked = c.runs.filter((r) => c.draft.kane_run_ids.includes(r.id));
  return {
    project_id: c.project.id,
    team_slug: team.slug,
    team_name: team.name,
    submission: c.submission
      ? { status: c.submission.status, receipt_code: c.submission.receipt_code, finalized_at: c.submission.finalized_at ? new Date(c.submission.finalized_at).toISOString() : null }
      : null,
    saved: !!c.submission,
    requirements: c.preflight.items.map((i) => ({ id: i.id, label: i.label, required: i.required, state: i.state, ok: i.state !== "missing", detail: i.detail ?? null })),
    ready: c.preflight.ok && !c.locked && !frozen && !!c.submission,
    missing: [...(c.submission ? [] : ["Save your draft on the Submit tab first"]), ...c.preflight.missing],
    warnings: [
      ...c.preflight.items.filter((i) => i.state === "uncertain").map((i) => `${i.label}: ${i.detail ?? "uncertain"}`),
      ...(linked.length && !linked.some((r) => r.source_verified) ? ["No source-verified Kane run linked: judges will see your runs as UNVERIFIED."] : []),
    ],
    verified_run_ids: linked.filter((r) => r.source_verified && r.status === "passed").map((r) => r.id),
    locked: c.locked,
    locks_at: c.locksAt.toISOString(),
    server_time: c.serverNow.toISOString(),
    confirm_phrase_hint: `Type the team name exactly: ${team.name}`,
  };
}

/**
 * Finalize through submission.ts: typed team name, server-clock lock,
 * immutable snapshot, signed receipt, and the showcase story published from
 * the same draft (unless publish_showcase is false).
 */
export async function finalizeSubmission(ctx: Ctx) {
  // Finalizing is irreversible, so agents never do it: the captain finishes it
  // in the browser (submission.ts refuses non-web callers too). Hand off.
  const team = await myTeam(ctx.member);
  const ctxNow = await getSubmissionContext(team.id);
  const s = ctxNow.submission;
  const frozen = !!s && (s.status === "finalized" || s.status === "locked");
  return {
    team_slug: team.slug,
    already_finalized: frozen,
    receipt_code: frozen ? s!.receipt_code : null,
    preflight_ok: ctxNow.preflight.ok,
    missing: ctxNow.preflight.missing,
    url: frozen ? `/submit/receipt/${s!.receipt_code}` : `/t/${team.slug}/submit#finalize`,
  };
}

// ── studio / showcase (→ src/server/{story,deck}.ts) ─────────────────────────

/** The caller's project as a studio ProjectAccess (bearer member on the team). */
async function access(m: MemberRow, actor: Actor, projectId?: number | null): Promise<story.ProjectAccess> {
  const team = await teamRow(m.team_id);
  if (!team) throw new AppError("FORBIDDEN", { userMessage: "Join or create a team first." });
  const project = await story.getProjectForTeam(team.id);
  if (!project) throw new AppError("NOT_FOUND", { userMessage: "Your team has no project yet." });
  if (projectId && projectId !== project.id) throw new AppError("FORBIDDEN", { userMessage: "That project belongs to another team." });
  return { project, member: m, staff: null, actor, canWrite: true };
}

export async function deckGet(m: MemberRow, actor: Actor, projectId?: number | null, version?: number) {
  const a = await access(m, actor, projectId);
  const d = await deck.deckGet(a, version ?? null);
  return { ...d, project_id: a.project.id, html_url: `/ship/${a.project.slug}/deck`, studio_url: `/studio/${a.project.slug}/deck` };
}

export const deckUpdateSchema = z.object({
  project_id: z.number().int().positive().optional(),
  expected_version: z.number().int().min(0),
  deck: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().trim().min(8).max(200).optional(),
});

/** Optimistic lock (deck.ts): only expected_version + 1 can be written. */
export async function deckUpdate(ctx: Ctx, input: z.infer<typeof deckUpdateSchema>) {
  const a = await access(ctx.member, ctx.actor, input.project_id);
  const { data, receipt } = await deck.saveDeckVersion(a, { deck: input.deck, expected_version: input.expected_version, idempotency_key: input.idempotency_key, reason: "mcp" });
  return { id: receipt.id, version: data.version, server_time: receipt.server_time, preview_url: `/studio/${a.project.slug}/deck` };
}

/** Render request with an honest status (deck.ts): PDF is browser print, PPTX/MP4 unavailable. Never "finished". */
export async function demoGenerate(ctx: Ctx, input: { project_id?: number; format: "pdf" | "pptx" | "mp4"; version?: number }) {
  const a = await access(ctx.member, ctx.actor, input.project_id);
  const { data, receipt } = await deck.requestRender(a, { format: input.format, version: input.version });
  return { id: receipt.id, job: data, server_time: receipt.server_time, studio_url: `/studio/${a.project.slug}/deck` };
}

export async function showcasePreview(m: MemberRow, actor: Actor, projectId?: number | null) {
  const a = await access(m, actor, projectId);
  const p = await story.showcasePreview(a);
  return { ...p, showcase_state: a.project.showcase_state, editor_url: `/studio/${a.project.slug}` };
}

/**
 * Publish a story version as the Ship Page (story.ts): slug typed to confirm,
 * no review blockers, and every credited person's own consent.
 */
/** Publishing is a person's action in the browser (story.ts refuses tokens); this returns the hand-off. */
export async function showcasePublish(ctx: Ctx, input: { project_id?: number; story_version: number }) {
  const a = await access(ctx.member, ctx.actor, input.project_id);
  const preview = await story.showcasePreview(a);
  return { story_version: input.story_version, url: `/studio/${a.project.slug}#publish`, public_url: preview.public_url, publish_blockers: preview.publish_blockers, consent_missing: preview.consent_missing };
}

// ── social (→ src/server/social.ts) ──────────────────────────────────────────

/** Draft only, for photographers/organizers linked to this member. Never publishes. */
export async function socialDraft(ctx: Ctx, input: { photo_id?: number; project_id: number; tone: "proof" | "story" | "hype" | "plain" }) {
  const [staff] = await query<{ id: number; role: string }>("select id, role from staff_accounts where member_id = $1 and active and role in ('photographer','organizer','admin')", [ctx.member.id]);
  if (!staff) throw new AppError("FORBIDDEN", { userMessage: "Social drafts are for the photo team." });
  const [proj] = await query<{ id: number; team_id: number; name: string; slug: string; summary: string | null }>("select id, team_id, name, slug, summary from projects where id = $1", [input.project_id]);
  if (!proj) throw new AppError("NOT_FOUND");
  const claims = (await listMilestones(proj.id, { publicOnly: true })).filter((x) => x.confidence === "verified");
  const fallback = () => `${proj.name} shipped at Kane CLI Hack Day.${claims[0] ? ` ${claims[0].title}.` : ""} kaneclihack.sh/ship/${proj.slug}`;
  const drafted = await draftText({
    system: "Write one short social post (under 260 characters) about a hackathon project. Only use the verified claims given. No hashtags spam, no invented numbers, no personal names.",
    prompt: `Project: ${proj.name}\nTone: ${input.tone}\nVerified claims: ${claims.map((c) => c.title).join("; ") || "none"}\nLink: kaneclihack.sh/ship/${proj.slug}`,
    fallback,
  });
  return withAudit(ctx.actor, "social.draft", "social_draft", async (tx) => {
    const { rows } = await tx.query<{ id: number; created_at: Date }>(
      `insert into social_drafts (photo_id, project_id, team_id, style, proposed_text, claim_ids, generated_by, checks, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, created_at`,
      [
        input.photo_id ?? null,
        proj.id,
        proj.team_id,
        input.tone,
        drafted.value.slice(0, 500),
        JSON.stringify(claims.map((c) => c.id)),
        drafted.generator === "llm" ? "llm" : "template",
        JSON.stringify({ verified_claims_only: true, needs_consent_check: !!input.photo_id }),
        staff.id,
      ],
    );
    return { result: { id: `SD-${rows[0].id}`, draft_id: rows[0].id, status: "draft", text: drafted.value, generator: drafted.generator, server_time: rows[0].created_at.toISOString() }, resourceId: rows[0].id };
  });
}

// ── renderer callback (→ src/server/deck.ts) ─────────────────────────────────

export const renderCallbackSchema = z.object({
  job_id: z.number().int().positive(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  object_key: z.string().max(300).regex(/^[A-Za-z0-9/_.-]+$/).optional(),
  error_code: z.string().max(60).optional(),
});

const RENDER_NEXT: Record<string, string[]> = { queued: ["running", "succeeded", "failed", "cancelled"], running: ["succeeded", "failed", "cancelled"] };

/** Apply a signed renderer status update. Finished jobs never move again. */
export async function applyRenderCallback(input: z.infer<typeof renderCallbackSchema>, deliveryId: string) {
  return withAudit<{ applied: boolean; status: string }>({ type: "pipeline", label: "renderer" }, "render.callback", "render_job", async (tx) => {
    const { rows } = await tx.query<{ status: string }>("select status from render_jobs where id = $1 for update", [input.job_id]);
    if (!rows[0]) throw new AppError("NOT_FOUND");
    if (!RENDER_NEXT[rows[0].status]?.includes(input.status)) return { result: { applied: false, status: rows[0].status }, resourceId: input.job_id, reason: "stale transition" };
    await tx.query(
      `update render_jobs set status = $2, object_key = coalesce($3, object_key), error_code = $4,
              started_at = case when $2 = 'running' then coalesce(started_at, now()) else started_at end,
              finished_at = case when $2 in ('succeeded','failed','cancelled') then now() else finished_at end,
              attempt_count = attempt_count + case when $2 = 'running' then 1 else 0 end
        where id = $1`,
      [input.job_id, input.status, input.object_key ?? null, input.error_code ?? null],
    );
    await tx.query("update integration_state set status = $1, updated_at = now(), last_success_at = case when $1 = 'ok' then now() else last_success_at end where system = 'renderer'", [
      input.status === "failed" ? "degraded" : "ok",
    ]);
    return { result: { applied: true, status: input.status }, resourceId: input.job_id, payload: { delivery: deliveryId } };
  });
}

// ── team page (→ src/server/team-page.ts) ────────────────────────────────────

/** team_page_get: the caller's team page, or a named team's (its members only). */
export async function teamPageGet(ctx: Ctx, team?: string) {
  return teamPage.getTeamPage(teamPage.mcpTeamRef(ctx.member, team), pageCaller(ctx));
}

/** team_page_update: the same idempotent upsert as PUT /api/v1/teams/{id|slug}/page. */
export async function teamPageUpdate(ctx: Ctx, input: { team?: string } & Record<string, unknown>) {
  const { team, ...body } = input;
  return teamPage.updateTeamPage(teamPage.mcpTeamRef(ctx.member, team), pageCaller(ctx), body);
}

const pageCaller = (ctx: Ctx): teamPage.PageCaller => ({ member: ctx.member, staff: null, actor: ctx.actor, source: "mcp" });
