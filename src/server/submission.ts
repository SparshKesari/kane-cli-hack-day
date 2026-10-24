import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";
import { PROGRESS_ITEMS, shippedMinimum } from "@/lib/progress";
import { logActivity } from "@/lib/teams";
import { PERSONAL_SIGN_IN, getMember, getStaff, hasRole, memberActor, randomCode, requirePersonalMember, requireTeamMember, staffActor, type MemberRow, type Staff } from "./auth";
import { AppError, idempotent, parse, sha256, siteUrl, stableStringify, transaction, writeAudit, z, zx, type Actor, type Receipt } from "./core";
import {
  CREDIT_CONSENT,
  PROJECT_TYPES,
  buildStory,
  getProjectByTeam,
  keepStudioStory,
  mediaPrefix,
  publishStoryTx,
  type CreditedMember,
  type ProjectRow,
  type ProjectStory,
  type ShowcaseState,
} from "./showcase";

// The official submission (D2): /t/[slug]/submit collects every asset into a
// draft, preflight lists what's missing, and finalize freezes a signed
// snapshot with a receipt code S-XXXX. The server clock (DB now()) decides
// the deadline; the DB trigger (008) refuses any change to a finalized row.
//
// Lifecycle: draft → preflighted → finalized → locked, plus withdrawn and
// manual_offline receipts as *new* records. Never a silent edit.
//
// Finalize also publishes the public showcase (/ship/{slug}) from the same
// data, as a separate, versioned project_story.

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const KANE_COMPONENTS = [
  { id: "run", label: "kane-cli run" },
  { id: "generate", label: "generate" },
  { id: "testmd", label: "testmd run" },
  { id: "testrun", label: "testrun run" },
  { id: "context", label: "context ingest / extract / review" },
  { id: "design_tests", label: "design tests" },
  { id: "cover", label: "cover" },
  { id: "maintain", label: "maintain" },
  { id: "sealed_evidence", label: "sealed evidence packs" },
  { id: "test_manager", label: "Test Manager" },
  { id: "exploration", label: "exploration sessions" },
  { id: "ci", label: "CI integration" },
  { id: "cloud_grid", label: "cloud grid / remote execution" },
] as const;
export const KANE_COMPONENT_IDS = KANE_COMPONENTS.map((c) => c.id) as [string, ...string[]];
export const kaneComponentLabel = (id: string) => KANE_COMPONENTS.find((c) => c.id === id)?.label ?? id;

export const SUBMISSION_STATUSES = ["draft", "preflighted", "awaiting_confirmation", "finalized", "locked", "withdrawn", "organizer_exception"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
const FROZEN: SubmissionStatus[] = ["finalized", "locked", "organizer_exception"];
export const isFrozen = (s: SubmissionStatus) => FROZEN.includes(s);

// ── Draft schema ────────────────────────────────────────────────────────────

const nul = (v: unknown) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v);
const arr = (v: unknown) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const splitLines = (v: unknown) => (typeof v === "string" ? v.split(/\r?\n/) : arr(v));

const optStr = (max: number) => z.preprocess(nul, z.string().trim().max(max).optional()).transform((v) => v ?? null);
const optUrl = z.preprocess(nul, zx.httpsUrl.optional()).transform((v) => v ?? null);
const optSha = z.preprocess(nul, zx.commitSha.optional()).transform((v) => v ?? null);
const optNum = z.preprocess(nul, z.coerce.number().finite().optional()).transform((v) => v ?? null);
const lines = (maxItems: number, maxLen: number) =>
  z.preprocess(
    splitLines,
    z
      .array(z.string().trim().max(maxLen, `Each line must be ${maxLen} characters or fewer`))
      .transform((a) => a.filter(Boolean))
      .refine((a) => a.length <= maxItems, `Up to ${maxItems} lines`),
  );
const urlLines = (maxItems: number) =>
  z.preprocess(
    (v) => splitLines(v).map((s) => String(s).trim()).filter(Boolean),
    z.array(zx.httpsUrl).max(maxItems, `Up to ${maxItems} links`),
  );
// Several links in one field: separated by commas, spaces or new lines.
const urlList = (maxItems: number) =>
  z.preprocess(
    (v) => arr(v).flatMap((s) => String(s).split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean),
    z.array(zx.httpsUrl).max(maxItems, `Up to ${maxItems} links`),
  );

export const DraftSchema = z.object({
  project_name: optStr(80),
  project_type: z.preprocess(nul, z.enum(PROJECT_TYPES).optional()).transform((v) => v ?? "other"),
  one_line_pitch: optStr(170),
  problem: optStr(1500),
  what_we_built: optStr(2000),
  how_it_works: lines(8, 300),
  harness_summary: optStr(1500),
  harness_stages: z.preprocess(arr, z.array(z.string().trim().max(80)).max(4)),
  kane_components: z.preprocess(arr, z.array(z.enum(KANE_COMPONENT_IDS)).max(KANE_COMPONENTS.length)),
  repo_url: optUrl,
  commit_sha: optSha,
  demo_url: optUrl,
  run_command: optStr(300),
  video_url: optUrl,
  screenshots: z.preprocess(arr, z.array(z.object({ path: z.string().max(300), alt: z.string().trim().max(200) })).max(6, "Up to 6 screenshots")),
  kane_run_ids: z.preprocess(arr, z.array(zx.id).max(50)),
  evidence_refs: urlLines(10),
  limitations: lines(10, 300),
  impact: z.preprocess(
    arr,
    z
      .array(z.object({ claim: z.string().trim().min(1).max(200), measure: optNum, unit: optStr(30), baseline: optNum, source: optStr(300) }))
      .max(3),
  ),
  devpost_url: optUrl,
  social_links: urlLines(6),
  // The final submission form (since 2026-10-24 16:40 PT): these plus project_name,
  // one_line_pitch, repo_url and video_url. The fields above stay for older drafts.
  project_description: optStr(3000),
  showcase_url: optUrl,
  linkedin_posts: urlList(10),
  x_posts: urlList(10),
  blog_links: urlList(10),
  deck_url: optUrl,
  hn_url: optUrl,
});
export type DraftKey = keyof typeof DraftSchema.shape;
export type SubmissionDraft = z.output<typeof DraftSchema>;

export const EMPTY_DRAFT: SubmissionDraft = DraftSchema.parse({});

/** A stored draft (jsonb) back into the current shape; tolerant of older rows. */
export function normalizeDraft(raw: unknown): SubmissionDraft {
  const r = DraftSchema.safeParse(raw ?? {});
  return r.success ? r.data : { ...EMPTY_DRAFT, ...(raw as Partial<SubmissionDraft>) };
}

/** The submit form posts flat fields; this turns them into the draft shape. */
export function draftInputFromForm(form: FormData) {
  const get = (k: string) => form.get(k);
  return {
    project_name: get("project_name"),
    project_description: get("project_description"),
    one_line_pitch: get("one_line_pitch"),
    repo_url: get("repo_url"),
    showcase_url: get("showcase_url"),
    linkedin_posts: get("linkedin_posts"),
    x_posts: get("x_posts"),
    blog_links: get("blog_links"),
    deck_url: get("deck_url"),
    video_url: get("video_url"),
    hn_url: get("hn_url"),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type KaneRunRef = {
  id: number;
  source: string;
  upstream_execution_id: string;
  status: string;
  exit_code: number | null;
  commit_sha: string | null;
  objective: string | null;
  source_verified: boolean;
  verification_state: string;
  evidence_artifact_id: number | null;
  report_url: string | null;
  at: Date | null;
};

export type SubmissionRow = {
  id: number;
  project_id: number;
  team_id: number;
  status: SubmissionStatus;
  draft: unknown;
  preflight: PreflightReport | null;
  receipt_code: string | null;
  finalized_by: number | null;
  finalized_by_staff: number | null;
  finalized_at: Date | null;
  received_at: Date | null;
  witness: string | null;
  incident_ref: string | null;
  immutable_snapshot: Record<string, unknown> | null;
  snapshot_sha256: string | null;
  signature: string | null;
  source: "web" | "mcp" | "manual_offline";
  supersedes_id: number | null;
  created_at: Date;
  updated_at: Date;
};

export type TeamMemberCredit = {
  id: number;
  name: string;
  display_name: string;
  handle: string | null;
  /** null: not asked yet. */
  consent: boolean | null;
  consent_at: Date | null;
};

type Db = Pick<PoolClient, "query">;
const rowsOf = async <T,>(db: Db, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];

const SUB_COLS = `id, project_id, team_id, status, draft, preflight, receipt_code, finalized_by, finalized_by_staff, finalized_at, received_at,
  witness, incident_ref, immutable_snapshot, snapshot_sha256, signature, source, supersedes_id, created_at, updated_at`;

/** The team's current submission: the live one, else the most recent (withdrawn) one. */
async function currentSubmission(db: Db, projectId: number, forUpdate = false) {
  const [row] = await rowsOf<SubmissionRow>(
    db,
    `select ${SUB_COLS} from submissions where project_id = $1
      order by (status <> 'withdrawn') desc, id desc limit 1 ${forUpdate ? "for update" : ""}`,
    [projectId],
  );
  return row ?? null;
}

/**
 * The 50 most recent runs (the picker list) plus every run the draft links,
 * however old: a linked run must never drop out of preflight, the signed
 * snapshot or the published proof because newer runs arrived.
 */
async function teamRuns(db: Db, projectId: number, linked: number[] = []) {
  const rows = await rowsOf<KaneRunRef>(
    db,
    `select id, source, upstream_execution_id, status, exit_code, commit_sha, objective, source_verified, verification_state,
            evidence_artifact_id, report_url, coalesce(finished_at, started_at, received_at) as at
       from kane_runs
      where project_id = $1
        and (id = any($2::bigint[]) or id in (select id from kane_runs where project_id = $1 order by received_at desc limit 50))
      order by received_at desc`,
    [projectId, linked],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), evidence_artifact_id: r.evidence_artifact_id ? Number(r.evidence_artifact_id) : null }));
}

async function teamCredits(db: Db, teamId: number): Promise<TeamMemberCredit[]> {
  const rows = await rowsOf<{ id: number; name: string; display_name: string | null; github_handle: string | null; x_handle: string | null; granted: boolean | null; recorded_at: Date | null; mention: boolean | null }>(
    db,
    `select m.id, m.name, m.display_name, m.github_handle, m.x_handle, c.granted, c.recorded_at, sm.granted as mention
       from members m
       left join member_consent_current c on c.member_id = m.id and c.category = $2
       left join member_consent_current sm on sm.member_id = m.id and sm.category = 'social_mention'
      where m.team_id = $1 and m.deleted_at is null
      order by m.id`,
    [teamId, CREDIT_CONSENT],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    display_name: r.display_name || r.name,
    // An @handle is published only with that person's own social_mention consent (same rule as the studio).
    handle: r.mention !== true ? null : r.github_handle ? `@${r.github_handle.replace(/^@/, "")}` : r.x_handle ? `@${r.x_handle.replace(/^@/, "")}` : null,
    consent: r.granted,
    consent_at: r.recorded_at,
  }));
}

const creditedOf = (members: TeamMemberCredit[]): CreditedMember[] =>
  members
    .filter((m) => m.consent === true)
    .map((m) => ({ member_id: m.id, display_name: m.display_name, handle: m.handle, consent_recorded_at: m.consent_at ? new Date(m.consent_at).toISOString() : null }));

async function progressDone(db: Db, teamId: number) {
  const rows = await rowsOf<{ item: string; value: string; done: boolean }>(db, "select item, value, done from progress where team_id = $1", [teamId]);
  return rows;
}

/** One project per team; registerTeam creates it, this covers teams from before 008 ran. */
async function ensureProject(teamId: number): Promise<ProjectRow> {
  const existing = await getProjectByTeam(teamId);
  if (existing) return existing;
  // The team slug may already be someone else's /ship slug (an organizer
  // rename): fall back to a suffixed slug rather than failing every submit.
  await query(
    `insert into projects (team_id, name, slug)
     select t.id, t.name,
            case when exists (select 1 from projects p where p.slug = t.slug) or exists (select 1 from project_slug_redirects r where r.old_slug = t.slug)
                 then left(t.slug, 56) || '-' || t.id else t.slug end
       from teams t where t.id = $1
     on conflict do nothing`,
    [teamId],
  );
  const p = await getProjectByTeam(teamId);
  if (!p) throw new AppError("NOT_FOUND", { userMessage: "Your project record is missing. Ask an organizer." });
  return p;
}

const httpsOrNull = (s: string | null | undefined) => (s && /^https:\/\//.test(s.trim()) ? s.trim() : null);

/** First-time draft: carry over what the team already put in the progress checklist and project. */
function prefill(project: ProjectRow, progress: { item: string; value: string }[]): SubmissionDraft {
  const p = new Map(progress.map((r) => [r.item, r.value?.trim() ?? ""]));
  const live = project.live_url ?? p.get("live-url-or-run-command") ?? "";
  const report = httpsOrNull(p.get("kane-cli-run-report"));
  return {
    ...EMPTY_DRAFT,
    project_name: project.name,
    project_type: project.project_type,
    one_line_pitch: project.summary?.slice(0, 170) ?? null,
    repo_url: httpsOrNull(project.repo_url ?? p.get("repo")),
    demo_url: httpsOrNull(live),
    run_command: httpsOrNull(live) ? project.run_command : live || project.run_command,
    video_url: httpsOrNull(p.get("video")),
    evidence_refs: report ? [report] : [],
    devpost_url: httpsOrNull(p.get("devpost-idea")),
    social_links: ["blog", "x-post", "hn-post"].map((k) => httpsOrNull(p.get(k))).filter((s): s is string => !!s),
  };
}

export type SubmissionContext = {
  project: ProjectRow;
  submission: SubmissionRow | null;
  draft: SubmissionDraft;
  runs: KaneRunRef[];
  members: TeamMemberCredit[];
  credited: CreditedMember[];
  preflight: PreflightReport;
  prize: { shipped: boolean; done: string[] };
  locksAt: Date;
  serverNow: Date;
  locked: boolean;
};

/** Everything the submit tab renders. Callers must already have checked team access. */
export async function getSubmissionContext(teamId: number): Promise<SubmissionContext> {
  const project = await ensureProject(teamId);
  let runs: KaneRunRef[];
  const [submission, recentRuns, members, progress, [clock]] = await Promise.all([
    currentSubmission(pool, project.id),
    teamRuns(pool, project.id),
    teamCredits(pool, teamId),
    progressDone(pool, teamId),
    query<{ now: Date; locks_at: Date }>("select now() as now, submission_locks_at as locks_at from hack_events where id = current_event_id()"),
  ]);
  runs = recentRuns;
  const draft = submission ? normalizeDraft(submission.draft) : prefill(project, progress);
  if (draft.kane_run_ids.some((id) => !runs.some((r) => r.id === id))) runs = await teamRuns(pool, project.id, draft.kane_run_ids);
  const credited = creditedOf(members);
  const done = progress.filter((r) => r.done).map((r) => r.item);
  const locksAt = clock?.locks_at ?? new Date(0);
  const now = clock?.now ?? new Date();
  return {
    project,
    submission,
    draft,
    runs,
    members,
    credited,
    preflight: preflight(draft, runs, { creditedCount: credited.length, github: submission?.preflight?.github ?? null }),
    prize: { shipped: shippedMinimum(new Set(done)), done },
    locksAt,
    serverNow: now,
    // The deadline time no longer locks a submission (event day, 2026-10-24). Kept for API clients.
    locked: false,
  };
}

/** For /ship previews (passed into getShowcase). */
export async function loadDraftForShowcase(teamId: number) {
  const project = await getProjectByTeam(teamId);
  if (!project) return null;
  const [submission, members] = await Promise.all([currentSubmission(pool, project.id), teamCredits(pool, teamId)]);
  if (!submission) return null;
  const draft = normalizeDraft(submission.draft);
  return {
    draft,
    runs: await teamRuns(pool, project.id, draft.kane_run_ids),
    credited: creditedOf(members),
    finalizedAt: submission.status !== "withdrawn" ? submission.finalized_at : null,
  };
}

// ── Preflight ───────────────────────────────────────────────────────────────

export type PreflightItem = { id: string; label: string; state: "ok" | "missing" | "uncertain"; required: boolean; detail?: string };
export type GithubCheck = "found" | "missing" | "unknown";
export type PreflightReport = { ok: boolean; items: PreflightItem[]; missing: string[]; github: GithubCheck | null; checked_at?: string };

/**
 * What's missing or uncertain. Pure, so the form, the finalize transaction
 * and agents all get the same answer. Deck and video are never required
 * (BRIEF: a media failure must never disqualify a valid entry).
 */
export function preflight(d: SubmissionDraft, runs: KaneRunRef[], opts: { creditedCount: number; github: GithubCheck | null }): PreflightReport {
  const items: PreflightItem[] = [];
  const add = (id: string, label: string, required: boolean, ok: boolean, detail?: string, uncertain = false) =>
    items.push({ id, label, required, state: !ok ? "missing" : uncertain ? "uncertain" : "ok", detail });

  // The final submission form: name, description, pitch and the GitHub repo are required;
  // every link is optional. Runs and credits no longer gate finalizing (kept in the signature).
  void runs;
  const onGithub = !!d.repo_url && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/i.test(d.repo_url);

  add("project_name", "Project name", true, !!d.project_name);
  add("project_description", "Project description", true, !!d.project_description);
  add("one_line_pitch", "One-liner pitch", true, !!d.one_line_pitch);
  add("repo_url", "GitHub repo URL", true, !!d.repo_url, onGithub ? undefined : "Not a github.com repo; judges will check it by hand.", !onGithub);

  add("showcase_url", "Showcase page", false, !!d.showcase_url);
  add("linkedin_posts", "LinkedIn post(s)", false, d.linkedin_posts.length > 0);
  add("x_posts", "X post(s)", false, d.x_posts.length > 0);
  add("blog_links", "Blog link(s)", false, d.blog_links.length > 0);
  add("deck_url", "Deck", false, !!d.deck_url);
  add("video_url", "Video", false, !!d.video_url);
  add("hn_url", "Hacker News post", false, !!d.hn_url);
  const missing = items.filter((i) => i.required && i.state === "missing").map((i) => i.label);
  return { ok: missing.length === 0, items, missing, github: opts.github };
}

/** Optional: ask GitHub whether the commit exists. Never blocks; "unknown" on any trouble. */
export async function checkGithubCommit(repoUrl: string | null, sha: string | null): Promise<GithubCheck> {
  const m = repoUrl ? /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(repoUrl) : null;
  if (!m || !sha) return "unknown";
  try {
    const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/commits/${sha}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "kane-hack-os" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (res.ok) return "found";
    if (res.status === 404 || res.status === 422) return "missing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ── Clock ───────────────────────────────────────────────────────────────────

/**
 * Inside a transaction: the DB clock and the official deadline. `locked` only says the deadline
 * time has passed (audit, receipts); nothing is refused for it (event day, 2026-10-24).
 */
export async function lockState(db: Db) {
  const [row] = await rowsOf<{ now: Date; locks_at: Date; locked: boolean }>(
    db,
    "select now() as now, submission_locks_at as locks_at, now() >= submission_locks_at as locked from hack_events where id = current_event_id()",
  );
  if (!row) throw new AppError("INTERNAL", { message: "hack_events row missing" });
  return row;
}

// ── Writes: team ────────────────────────────────────────────────────────────

/**
 * Who is acting. Browser calls resolve the member from cookies. MCP / REST
 * callers pass `as` with the member behind a bearer token (requireBearer),
 * and the token's actor is used for audit. Either way, only a current member
 * of this team may change its submission; staff never act as a member.
 */
export type ActingAs = { member: MemberRow; actor?: Actor; source?: "web" | "mcp" };

async function teamMember(slug: string, as?: ActingAs, opts: { personal?: boolean } = {}) {
  if (!as) {
    const { team, member } = await requireTeamMember(slug);
    if (!member) throw new AppError("FORBIDDEN");
    if (opts.personal) {
      // Acting as this person (consent, finalize attribution): a team-password
      // session can pick any teammate's name, so it isn't proof of who this is.
      const me = await requirePersonalMember();
      if (me.id !== member.id || me.team_id !== team.id) throw new AppError("UNAUTHENTICATED", { userMessage: PERSONAL_SIGN_IN });
      return { team, member: me, actor: memberActor(me), source: "web" as const };
    }
    return { team, member, actor: memberActor(member), source: "web" as const };
  }
  const [team] = await query<{ id: number; slug: string; name: string }>("select id, slug, name from teams where slug = $1", [slug]);
  if (!team) throw new AppError("NOT_FOUND");
  if (as.member.team_id !== team.id) throw new AppError("FORBIDDEN");
  return { team, member: as.member, actor: as.actor ?? memberActor(as.member), source: as.source ?? "mcp" };
}

/** Save the draft. Refused after the lock and once finalized. */
export async function saveDraft(slug: string, input: unknown, as?: ActingAs): Promise<{ data: { submissionId: number }; receipt: Receipt }> {
  const { team, actor, source } = await teamMember(slug, as);
  const parsed = parse(DraftSchema, input);
  // Only the fields that were sent change: the rest of a saved draft (older fields the form
  // no longer shows, screenshots) is kept, so a save never wipes them.
  const sent = Object.keys(input && typeof input === "object" ? input : {}).filter((k): k is DraftKey => k in DraftSchema.shape);
  const project = await ensureProject(team.id);

  const prefix = mediaPrefix(project.id);
  if (parsed.screenshots.some((s) => !s.path.startsWith(prefix) || s.path.includes("..") || !/^[\w./-]+$/.test(s.path))) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "A screenshot didn't come from this project's upload folder. Upload it again." });
  }

  return transaction(async (tx) => {
    const clock = await lockState(tx);

    if (parsed.kane_run_ids.length) {
      const ok = await rowsOf<{ id: number }>(tx, "select id from kane_runs where project_id = $1 and id = any($2::bigint[])", [project.id, parsed.kane_run_ids]);
      if (ok.length !== new Set(parsed.kane_run_ids).size) throw new AppError("VALIDATION_FAILED", { userMessage: "One of the linked Kane runs isn't from this project." });
    }

    const current = await currentSubmission(tx, project.id, true);
    if (current && isFrozen(current.status)) {
      throw new AppError("CONFLICT", { userMessage: `Already finalized as ${current.receipt_code}. The submission can't change.` });
    }
    let id: number;
    const before = current && current.status !== "withdrawn" ? current.draft : undefined;
    const base = before !== undefined ? normalizeDraft(before) : prefill(project, await progressDone(tx, team.id));
    const draft: SubmissionDraft = { ...base, ...Object.fromEntries(sent.map((k) => [k, parsed[k]])) };
    if (current && current.status !== "withdrawn") {
      await tx.query("update submissions set draft = $2, status = 'draft', preflight = null where id = $1", [current.id, JSON.stringify(draft)]);
      id = Number(current.id);
    } else {
      const { rows } = await tx.query<{ id: number }>(
        `insert into submissions (project_id, team_id, status, draft, source, supersedes_id) values ($1, $2, 'draft', $3, $4, $5) returning id`,
        [project.id, team.id, JSON.stringify(draft), source, current?.id ?? null],
      );
      id = Number(rows[0].id);
    }
    await tx.query(
      `update projects set name = coalesce($2, name), project_type = $3, summary = $4, repo_url = $5, live_url = $6, run_command = $7, updated_at = now()
        where id = $1`,
      [project.id, draft.project_name, draft.project_type, draft.one_line_pitch, draft.repo_url, draft.demo_url, draft.run_command],
    );
    await writeAudit(actor, { action: "submission.save_draft", resourceType: "submission", resourceId: id, before, after: draft }, tx);
    return { data: { submissionId: id }, receipt: { id: `submission:${id}`, server_time: new Date(clock.now).toISOString() } };
  });
}

/** Run preflight (optionally asking GitHub about the commit) and store the report. */
export async function runPreflight(slug: string, opts: { checkGithub?: boolean } = {}, as?: ActingAs) {
  const { team, actor } = await teamMember(slug, as);
  const project = await ensureProject(team.id);
  const sub = await currentSubmission(pool, project.id);
  if (!sub || sub.status === "withdrawn") throw new AppError("VALIDATION_FAILED", { userMessage: "Save your draft first." });
  if (isFrozen(sub.status)) return sub.preflight ?? preflight(normalizeDraft(sub.draft), [], { creditedCount: 0, github: null });
  const draft = normalizeDraft(sub.draft);
  const [runs, members, github] = await Promise.all([
    teamRuns(pool, project.id, draft.kane_run_ids),
    teamCredits(pool, team.id),
    opts.checkGithub ? checkGithubCommit(draft.repo_url, draft.commit_sha) : Promise.resolve(sub.preflight?.github ?? null),
  ]);
  const report = preflight(draft, runs, { creditedCount: creditedOf(members).length, github });
  return transaction(async (tx) => {
    const clock = await lockState(tx);
    const stored = { ...report, checked_at: new Date(clock.now).toISOString() };
    // Only touch a still-open draft; a concurrent finalize wins.
    await tx.query(
      "update submissions set preflight = $2, status = $3 where id = $1 and status in ('draft','preflighted')",
      [sub.id, JSON.stringify(stored), report.ok ? "preflighted" : "draft"],
    );
    await writeAudit(actor, { action: "submission.preflight", resourceType: "submission", resourceId: sub.id, payload: { ok: report.ok, missing: report.missing, github } }, tx);
    return stored;
  });
}

/** Each person answers for themselves: may this site name me on our public showcase and deck? */
export async function setCreditConsent(slug: string, granted: boolean) {
  const { member } = await teamMember(slug, undefined, { personal: true });
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; recorded_at: Date }>(
      "insert into member_consents (member_id, category, granted, source) values ($1, $2, $3, 'web') returning id, recorded_at",
      [member.id, CREDIT_CONSENT, granted],
    );
    await writeAudit(memberActor(member), { action: `consent.${CREDIT_CONSENT}`, resourceType: "member", resourceId: member.id, after: { granted } }, tx);
    return { granted, receipt: { id: `consent:${rows[0].id}`, server_time: new Date(rows[0].recorded_at).toISOString() } };
  });
}

// ── Finalize ────────────────────────────────────────────────────────────────

export const FinalizeInput = z.object({
  confirm_phrase: zx.text(120),
  confirm: zx.checkbox.refine((v) => v, "Tick the box to confirm the frozen contents"),
  publish_showcase: zx.checkbox,
  idempotency_key: zx.idempotencyKey,
});

export type FinalizeResult = {
  receipt_code: string;
  submission_id: number;
  finalized_at: string;
  snapshot_sha256: string;
  signed: boolean;
  showcase_state: ShowcaseState;
  already: boolean;
};

const signingKey = () => process.env.RECEIPT_SIGNING_KEY || null;
const hmac = (sha: string, key: string) => createHmac("sha256", key).update(sha).digest("base64url");

async function newReceiptCode(db: Db) {
  for (let i = 0; i < 8; i++) {
    const code = `S-${randomCode(4)}`;
    const taken = await rowsOf(db, "select 1 from submissions where receipt_code = $1", [code]);
    if (!taken.length) return code;
  }
  throw new AppError("INTERNAL", { message: "could not allocate a receipt code" });
}

/**
 * Freeze the submission. Explicit confirmation (checkbox + typed team name),
 * idempotency key (a double click returns the same receipt), deadline by DB
 * now(), snapshot → sha256 → HMAC, receipt S-XXXX. Also publishes the
 * showcase story from the same draft, unless the team opted out.
 */
export async function finalizeSubmission(slug: string, input: unknown, as?: ActingAs): Promise<{ data: FinalizeResult; receipt: Receipt }> {
  // The irreversible step happens in the browser, by the captain, signed in as
  // themselves (SPEC §2). Agents (MCP / bearer) get a hand-off link instead,
  // so a prompt-injected agent can't lock a team's submission early.
  if (as && as.source !== "web") {
    throw new AppError("FORBIDDEN", { userMessage: `Finalizing is done by your team captain in the browser: ${siteUrl(`/t/${slug}/submit#finalize`)}` });
  }
  const { team, member, actor, source } = await teamMember(slug, as, { personal: true });
  const [cap] = await query<{ captain_id: number | null }>("select captain_id from teams where id = $1", [team.id]);
  if (cap?.captain_id && Number(cap.captain_id) !== Number(member.id)) {
    throw new AppError("FORBIDDEN", {
      userMessage: "Only your team captain can finalize. Ask them to do it, or have them make you captain on the team page. If the captain isn't here, ask an organizer.",
    });
  }
  const body = parse(FinalizeInput, input);
  if (body.confirm_phrase.trim().toLowerCase() !== team.name.trim().toLowerCase()) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "Type your team name exactly to confirm.", details: { issues: [{ path: "confirm_phrase", message: "Doesn't match the team name" }] } });
  }
  const project = await ensureProject(team.id);

  const { result } = await idempotent(body.idempotency_key ?? null, `submission.finalize:team:${team.id}`, () =>
    transaction(async (tx): Promise<FinalizeResult> => {
      const current = await currentSubmission(tx, project.id, true);
      // Natural idempotency: already finalized → same receipt, no new record.
      if (current && isFrozen(current.status)) {
        return {
          receipt_code: current.receipt_code!,
          submission_id: Number(current.id),
          finalized_at: new Date(current.finalized_at!).toISOString(),
          snapshot_sha256: current.snapshot_sha256!,
          signed: !!current.signature,
          showcase_state: project.showcase_state,
          already: true,
        };
      }
      const clock = await lockState(tx);
      if (!current || current.status === "withdrawn") throw new AppError("VALIDATION_FAILED", { userMessage: "Save your draft before finalizing." });

      const draft = normalizeDraft(current.draft);
      // One client, one query at a time (pg queues concurrent ones and warns).
      const runs = await teamRuns(tx, project.id, draft.kane_run_ids);
      const members = await teamCredits(tx, team.id);
      const progress = await progressDone(tx, team.id);
      const pins = await rowsOf<{ deck_id: number | null; deck_version: number | null }>(
        tx,
        `select d.id as deck_id, d.version as deck_version from deck_versions d
          where d.project_id = $1 and d.status in ('approved','published') order by d.version desc limit 1`,
        [project.id],
      );
      const credited = creditedOf(members);
      const report = preflight(draft, runs, { creditedCount: credited.length, github: current.preflight?.github ?? null });
      if (!report.ok) {
        throw new AppError("VALIDATION_FAILED", { userMessage: `Still missing: ${report.missing.join(", ")}.`, details: { missing: report.missing } });
      }

      // The public story, written first so the snapshot can pin its version (T-SUB-07).
      const projectSlug = project.slug;
      const nextState: ShowcaseState =
        project.showcase_state === "hidden_by_moderation" ? "hidden_by_moderation" : body.publish_showcase ? "public" : "draft";
      const built = buildStory({ projectId: project.id, slug: projectSlug, draft, runs, credited, status: "published" });
      // A story the team approved in the Ship Studio stays the public page; the submission only
      // adds its screenshots, video and empty links. Finalize's own stories don't count.
      const studio = await rowsOf<{ content: ProjectStory }>(
        tx,
        `select s.content from published_assets a join project_stories s on s.id = a.source_story_id
          where a.project_id = $1 and a.kind = 'ship_page' and a.consent_receipt->>'basis' is distinct from 'finalize_confirmation'
          order by a.version desc limit 1`,
        [project.id],
      );
      const story = studio[0] ? keepStudioStory(studio[0].content, built) : built;
      const published = await publishStoryTx(tx, { projectId: project.id, story, memberId: member.id, credited, state: nextState });

      const code = await newReceiptCode(tx);
      const finalizedAt = new Date(clock.now).toISOString();
      const linked = runs.filter((r) => draft.kane_run_ids.includes(r.id));
      const done = new Set(progress.filter((r) => r.done).map((r) => r.item));
      const snapshot = {
        schema: "kane-hack-os.submission@1",
        receipt_code: code,
        source,
        team: { id: Number(team.id), slug: team.slug, name: team.name },
        project: { id: Number(project.id), slug: projectSlug },
        submitted_by: { member_id: Number(member.id), public_code: member.public_code, name: member.display_name || member.name },
        finalized_at: finalizedAt,
        locks_at: new Date(clock.locks_at).toISOString(),
        submission: draft,
        evidence: linked.map((r) => ({
          run_id: r.id,
          source: r.source,
          upstream_execution_id: r.upstream_execution_id,
          status: r.status,
          exit_code: r.exit_code,
          commit_sha: r.commit_sha,
          source_verified: r.source_verified,
          evidence_artifact_id: r.evidence_artifact_id,
        })),
        preflight: { ok: report.ok, uncertain: report.items.filter((i) => i.state === "uncertain").map((i) => i.id), github: report.github },
        // Prize eligibility is separate from the submission itself (T-SUB-06).
        prize: { shipped_minimum: shippedMinimum(done), progress_done: PROGRESS_ITEMS.filter((i) => done.has(i.id)).map((i) => i.id) },
        pins: { story_id: published.storyId, story_version: published.storyVersion, deck_version_id: pins[0]?.deck_id ?? null, deck_version: pins[0]?.deck_version ?? null },
      };
      const snapshotSha = sha256(stableStringify(snapshot));
      const key = signingKey();
      const signature = key ? hmac(snapshotSha, key) : null;

      await tx.query(
        `update submissions set status = 'finalized', receipt_code = $2, finalized_by = $3, finalized_at = $4, immutable_snapshot = $5,
                snapshot_sha256 = $6, signature = $7, preflight = $8, idempotency_key = $9, source = $10
          where id = $1`,
        [current.id, code, member.id, finalizedAt, JSON.stringify(snapshot), snapshotSha, signature, JSON.stringify(report), body.idempotency_key ?? null, source],
      );
      await tx.query("update projects set state = 'submitted', showcase_state = $2, updated_at = now() where id = $1", [project.id, nextState]);
      await tx.query(
        `insert into outbox_events (kind, payload, dedupe_key) values ('submission.finalized', $1, $2) on conflict (dedupe_key) do nothing`,
        [JSON.stringify({ receipt_code: code, team_slug: team.slug, project_slug: projectSlug, showcase_state: nextState }), `submission.finalized:${current.id}`],
      );
      await writeAudit(
        actor,
        {
          action: "submission.finalize",
          resourceType: "submission",
          resourceId: current.id,
          after: { receipt_code: code, snapshot_sha256: snapshotSha },
          payload: { story_id: published.storyId, showcase_state: nextState, signed: !!signature },
        },
        tx,
      );
      return {
        receipt_code: code,
        submission_id: Number(current.id),
        finalized_at: finalizedAt,
        snapshot_sha256: snapshotSha,
        signed: !!signature,
        showcase_state: nextState,
        already: false,
      };
    }),
  );
  if (!result.already) await logActivity(team.id, member.id, `Finalized the submission (${result.receipt_code})`).catch(() => {});
  return { data: result, receipt: { id: result.receipt_code, server_time: result.finalized_at } };
}

// ── Receipts ────────────────────────────────────────────────────────────────

export type ReceiptView = {
  code: string;
  status: SubmissionStatus;
  source: SubmissionRow["source"];
  team: { slug: string; name: string };
  projectSlug: string;
  finalizedAt: Date;
  receivedAt: Date | null;
  witness: string | null;
  incidentRef: string | null;
  snapshot: Record<string, unknown>;
  snapshotSha256: string;
  signature: string | null;
  officer: string | null;
};

/** Team members, judges and organizers may open a receipt; everyone else gets NOT_FOUND. */
export async function getReceipt(code: string): Promise<ReceiptView> {
  const normal = code.trim().toUpperCase();
  if (!/^S-[0-9A-Z]{4,8}$/.test(normal)) throw new AppError("NOT_FOUND");
  const [row] = await query<SubmissionRow & { team_slug: string; team_name: string; project_slug: string; officer: string | null }>(
    `select s.*, t.slug as team_slug, t.name as team_name, p.slug as project_slug, st.name as officer
       from submissions s join teams t on t.id = s.team_id join projects p on p.id = s.project_id
       left join staff_accounts st on st.id = s.finalized_by_staff
      where s.receipt_code = $1`,
    [normal],
  );
  if (!row) throw new AppError("NOT_FOUND");
  const [member, staff] = await Promise.all([getMember(), getStaff()]);
  const allowed = (member && member.team_id === Number(row.team_id)) || hasRole(staff, "judge", "organizer");
  if (!allowed) throw new AppError("NOT_FOUND");
  return {
    code: row.receipt_code!,
    status: row.status,
    source: row.source,
    team: { slug: row.team_slug, name: row.team_name },
    projectSlug: row.project_slug,
    finalizedAt: row.finalized_at!,
    receivedAt: row.received_at,
    witness: row.witness,
    incidentRef: row.incident_ref,
    snapshot: row.immutable_snapshot ?? {},
    snapshotSha256: row.snapshot_sha256!,
    signature: row.signature,
    officer: row.officer,
  };
}

export type VerifyResult = { hash: "match" | "mismatch"; signature: "valid" | "invalid" | "unsigned" | "no_key"; recomputed: string; checked_at: string };

/** Recompute the snapshot hash and check the HMAC. Read-only. */
export async function verifyReceipt(code: string): Promise<VerifyResult> {
  const r = await getReceipt(code);
  const recomputed = sha256(stableStringify(r.snapshot));
  const key = signingKey();
  let signature: VerifyResult["signature"] = "unsigned";
  if (r.signature) {
    if (!key) signature = "no_key";
    else {
      const a = Buffer.from(hmac(r.snapshotSha256, key));
      const b = Buffer.from(r.signature);
      signature = a.length === b.length && timingSafeEqual(a, b) ? "valid" : "invalid";
    }
  }
  const [{ now }] = await query<{ now: Date }>("select now() as now");
  return { hash: recomputed === r.snapshotSha256 ? "match" : "mismatch", signature, recomputed, checked_at: new Date(now).toISOString() };
}

// ── Ops ─────────────────────────────────────────────────────────────────────

export type OpsSubmissionRow = {
  team_id: number;
  team_slug: string;
  team_name: string;
  project_slug: string | null;
  project_name: string | null;
  project_type: string | null;
  showcase_state: ShowcaseState | null;
  submission_id: number | null;
  status: SubmissionStatus | null;
  receipt_code: string | null;
  source: string | null;
  finalized_at: Date | null;
  received_at: Date | null;
  commit_sha: string | null;
  updated_at: Date | null;
  preflight_ok: boolean | null;
};

/** Every team with its current submission, for /ops/submissions. Organizer only. */
export async function listSubmissionsForOps(staff: Staff): Promise<OpsSubmissionRow[]> {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  return query<OpsSubmissionRow>(
    `select t.id as team_id, t.slug as team_slug, t.name as team_name, p.slug as project_slug, p.name as project_name, p.project_type,
            p.showcase_state, s.id as submission_id, s.status, s.receipt_code, s.source, s.finalized_at, s.received_at,
            coalesce(s.immutable_snapshot #>> '{submission,commit_sha}', s.draft ->> 'commit_sha') as commit_sha, s.updated_at,
            (s.preflight ->> 'ok')::boolean as preflight_ok
       from teams t
       left join projects p on p.team_id = t.id
       left join lateral (
         select * from submissions x where x.project_id = p.id order by (x.status <> 'withdrawn') desc, x.id desc limit 1
       ) s on true
      order by s.finalized_at desc nulls last, t.name`,
  );
}

/** Finalized → locked for every team (status only moves forward). The organizer decides when. */
export async function lockFinalized(staff: Staff) {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number }>("update submissions set status = 'locked' where status = 'finalized' returning id");
    await writeAudit(staffActor(staff), { action: "submission.lock_all", resourceType: "submission", resourceId: "all", payload: { count: rows.length } }, tx);
    return rows.length;
  });
}

const WithdrawInput = z.object({ team_slug: zx.slug, reason: zx.text(300) });

/** Organizer withdraws a team's submission. History stays; the team may start a new draft that supersedes it. */
export async function withdrawSubmission(staff: Staff, input: unknown) {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  const { team_slug, reason } = parse(WithdrawInput, input);
  return transaction(async (tx) => {
    const [p] = await rowsOf<{ id: number }>(tx, "select p.id from projects p join teams t on t.id = p.team_id where t.slug = $1", [team_slug]);
    if (!p) throw new AppError("NOT_FOUND");
    const cur = await currentSubmission(tx, p.id, true);
    if (!cur || cur.status === "withdrawn") throw new AppError("NOT_FOUND", { userMessage: "Nothing to withdraw." });
    await tx.query("update submissions set status = 'withdrawn' where id = $1", [cur.id]);
    // A withdrawn (e.g. disqualified) entry leaves the public showcase and gallery too.
    const { rows: ps } = await tx.query<{ showcase_state: ShowcaseState }>("select showcase_state from projects where id = $1 for update", [p.id]);
    const showcaseBefore = ps[0]?.showcase_state ?? null;
    if (showcaseBefore && showcaseBefore !== "hidden_by_moderation" && showcaseBefore !== "draft") {
      await tx.query("update projects set showcase_state = 'draft', updated_at = now() where id = $1", [p.id]);
    }
    await writeAudit(
      staffActor(staff),
      { action: "submission.withdraw", resourceType: "submission", resourceId: cur.id, reason, before: { status: cur.status, showcase_state: showcaseBefore }, after: { status: "withdrawn", showcase_state: showcaseBefore === "hidden_by_moderation" ? showcaseBefore : "draft" } },
      tx,
    );
    return Number(cur.id);
  });
}

/** "2026-10-24T17:58" in `tz` → the real instant. */
export function zonedToUtc(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new AppError("VALIDATION_FAILED", { userMessage: "Use the date and time picker." });
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (ms: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let utc = guess - offset(guess);
  const second = offset(utc);
  if (guess - second !== utc) utc = guess - second;
  return new Date(utc);
}

export const ManualReceiptInput = z
  .object({
    team_slug: zx.slug,
    received_at_local: z.string().trim().min(1, "When did you receive it?"),
    project_name: zx.text(80),
    project_type: z.enum(PROJECT_TYPES),
    repo_url: zx.text(500),
    commit_sha: z.preprocess(nul, zx.commitSha.optional()).transform((v) => v ?? null),
    artifact_hash: z.preprocess(nul, z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "SHA-256 is 64 hex characters").optional()).transform((v) => v ?? null),
    demo_url: optStr(500),
    harness: zx.text(1500),
    evidence_refs: optStr(2000),
    caveats: optStr(1500),
    submitter: zx.text(120),
    witness: zx.text(120),
    incident_ref: zx.text(60),
    participant_confirmed: zx.checkbox.refine((v) => v, "The participant must confirm the frozen contents"),
    idempotency_key: zx.idempotencyKey,
  })
  .refine((v) => v.commit_sha || v.artifact_hash, { message: "Give the exact commit SHA or the archive SHA-256", path: ["commit_sha"] });

/**
 * Backup receipt during an outage (fallback/05). Officer = the signed-in
 * organizer; an independent witness is required. finalized_at is the server's
 * now() when staff record it, and received_at is when the officer actually
 * took it: we never backdate the record, and a received time after the lock
 * is flagged for escalation rather than refused.
 */
export async function recordManualReceipt(staff: Staff, input: unknown, timezone: string) {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  const v = parse(ManualReceiptInput, input);
  if (v.witness.trim().toLowerCase() === staff.name.trim().toLowerCase()) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "The witness must be someone other than the officer." });
  }
  const receivedAt = zonedToUtc(v.received_at_local, timezone);

  const { result } = await idempotent(v.idempotency_key ?? null, `submission.manual:staff:${staff.id ?? "admin"}`, () =>
    transaction(async (tx) => {
      const clock = await lockState(tx);
      if (receivedAt.getTime() > new Date(clock.now).getTime() + 60_000) {
        throw new AppError("VALIDATION_FAILED", { userMessage: "The received time is in the future. Record the real time." });
      }
      const [team] = await rowsOf<{ id: number; slug: string; name: string }>(tx, "select id, slug, name from teams where slug = $1", [v.team_slug]);
      if (!team) throw new AppError("NOT_FOUND", { userMessage: "No team with that slug." });
      await tx.query(`insert into projects (team_id, name, slug) values ($1, $2, $3) on conflict (team_id) do nothing`, [team.id, team.name, team.slug]);
      const [project] = await rowsOf<{ id: number; slug: string }>(tx, "select id, slug from projects where team_id = $1", [team.id]);
      const current = await currentSubmission(tx, project.id, true);
      if (current && isFrozen(current.status)) {
        throw new AppError("CONFLICT", { userMessage: `This team already has receipt ${current.receipt_code}. Reconcile instead of issuing a second one.` });
      }
      // An open online draft is superseded (kept as history), never edited.
      if (current && current.status !== "withdrawn") await tx.query("update submissions set status = 'withdrawn' where id = $1", [current.id]);

      const code = await newReceiptCode(tx);
      const afterLock = receivedAt.getTime() > new Date(clock.locks_at).getTime();
      const snapshot = {
        schema: "kane-hack-os.submission@1",
        receipt_code: code,
        source: "manual_offline",
        team: { id: Number(team.id), slug: team.slug, name: team.name },
        project: { id: Number(project.id), slug: project.slug },
        recorded_at: new Date(clock.now).toISOString(),
        received_at: receivedAt.toISOString(),
        timezone,
        locks_at: new Date(clock.locks_at).toISOString(),
        received_after_lock: afterLock,
        submitter: v.submitter,
        officer: { staff_id: staff.id, name: staff.name },
        witness: v.witness,
        incident_ref: v.incident_ref,
        participant_confirmed: true,
        submission: {
          project_name: v.project_name,
          project_type: v.project_type,
          repo_url: v.repo_url,
          commit_sha: v.commit_sha,
          artifact_hash: v.artifact_hash,
          demo_url: v.demo_url,
          harness: v.harness,
          evidence_refs: v.evidence_refs,
          caveats: v.caveats,
        },
      };
      const snapshotSha = sha256(stableStringify(snapshot));
      const key = signingKey();
      const { rows } = await tx.query<{ id: number }>(
        `insert into submissions (project_id, team_id, status, draft, receipt_code, finalized_by_staff, finalized_at, received_at, witness, incident_ref,
                                  immutable_snapshot, snapshot_sha256, signature, source, supersedes_id, idempotency_key)
         values ($1, $2, 'finalized', $3, $4, $5, now(), $6, $7, $8, $9, $10, $11, 'manual_offline', $12, $13) returning id`,
        [
          project.id,
          team.id,
          JSON.stringify(snapshot.submission),
          code,
          staff.id,
          receivedAt.toISOString(),
          v.witness,
          v.incident_ref,
          JSON.stringify(snapshot),
          snapshotSha,
          key ? hmac(snapshotSha, key) : null,
          current?.id ?? null,
          v.idempotency_key ?? null,
        ],
      );
      await tx.query("update projects set state = 'submitted', updated_at = now() where id = $1", [project.id]);
      await writeAudit(
        staffActor(staff),
        {
          action: "submission.manual_receipt",
          resourceType: "submission",
          resourceId: rows[0].id,
          reason: v.incident_ref,
          after: { receipt_code: code, snapshot_sha256: snapshotSha },
          payload: { witness: v.witness, received_at: receivedAt.toISOString(), received_after_lock: afterLock },
        },
        tx,
      );
      return { receipt_code: code, submission_id: Number(rows[0].id), received_after_lock: afterLock, recorded_at: new Date(clock.now).toISOString() };
    }),
  );
  return result;
}

export type { MemberRow };

// ── Team page (team-page.ts) ────────────────────────────────────────────────

export type DraftPatch = Partial<Pick<SubmissionDraft, "repo_url" | "commit_sha" | "video_url" | "kane_run_ids">>;

/**
 * Inside the caller's transaction: merge page fields into the team's draft,
 * the same row the Submit tab edits. Nothing is written when nothing changes.
 * A change to a finalized submission is refused.
 */
export async function patchDraftTx(tx: PoolClient, project: ProjectRow, patch: DraftPatch, source: "web" | "mcp") {
  const current = await currentSubmission(tx, project.id, true);
  const live = current && current.status !== "withdrawn" ? current : null;
  const base = current ? normalizeDraft(current.draft) : prefill(project, await progressDone(tx, project.team_id));
  const changed = (Object.keys(patch) as (keyof DraftPatch)[]).filter((k) => stableStringify(patch[k]) !== stableStringify(base[k]));
  if (!changed.length) return { submissionId: live ? Number(live.id) : null, changed, before: {}, after: {} };
  if (live && isFrozen(live.status)) {
    throw new AppError("CONFLICT", { userMessage: `Already finalized as ${live.receipt_code}. The submission can't change.`, details: { receipt_code: live.receipt_code, fields: changed } });
  }
  const draft: SubmissionDraft = { ...base, ...patch };
  if (changed.includes("kane_run_ids") && draft.kane_run_ids.length) {
    const ok = await rowsOf<{ id: number }>(tx, "select id from kane_runs where project_id = $1 and id = any($2::bigint[])", [project.id, draft.kane_run_ids]);
    if (ok.length !== new Set(draft.kane_run_ids).size) throw new AppError("VALIDATION_FAILED", { userMessage: "One of the linked Kane runs isn't from this project." });
  }
  let id: number;
  if (live) {
    await tx.query("update submissions set draft = $2, status = 'draft', preflight = null where id = $1", [live.id, JSON.stringify(draft)]);
    id = Number(live.id);
  } else {
    const { rows } = await tx.query<{ id: number }>(
      `insert into submissions (project_id, team_id, status, draft, source, supersedes_id) values ($1, $2, 'draft', $3, $4, $5) returning id`,
      [project.id, project.team_id, JSON.stringify(draft), source, current?.id ?? null],
    );
    id = Number(rows[0].id);
  }
  if (changed.includes("repo_url")) await tx.query("update projects set repo_url = $2, updated_at = now() where id = $1", [project.id, draft.repo_url]);
  const pick = (d: SubmissionDraft) => Object.fromEntries(changed.map((k) => [k, d[k]]));
  return { submissionId: id, changed, before: pick(base), after: pick(draft) };
}
