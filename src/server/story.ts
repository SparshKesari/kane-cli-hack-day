import "server-only";
import { query } from "@/lib/db";
import { isEnabled } from "@/lib/flags";
import { reviewStory, type EvidenceOption, type RunOption, type StoryReview } from "@/components/ship-templates/review";
import {
  blankStory,
  isShipTemplate,
  storySchema,
  toPublicStory,
  DEFAULT_TEMPLATE,
  type Badges,
  type PublicProof,
  type PublicStory,
  type ShipTemplateId,
  type Story,
} from "@/components/ship-templates/model";
import { authenticateBearer, getMember, getStaff, memberActor, tokenActor, type MemberRow, type Staff } from "./auth";
import { AppError, idempotent, parse, serverNow, siteUrl, withAudit, z, type Actor, type Receipt } from "./core";
import { mediaPrefix, mediaSrc } from "./showcase";

// Project stories: the one reviewed story that powers the Ship Page, deck,
// video, README and social copy (SPEC §7, T-SHIP-01/02/05/09).
//
//   - Every save inserts a new version (optimistic concurrency on
//     expected_version); versions are immutable (db/026 trigger).
//   - The claim/evidence review binds each proof claim to a real Kane run or
//     evidence artifact of *this* project. "verified" without that is refused;
//     unsupported metrics block publishing.
//   - Publishing needs a team member's explicit approval and a consent receipt:
//     everyone credited by name has consented, handles only with mention consent.
//   - Public readers get a DTO (toPublicStory), never the raw row.

// ── Projects and access ──────────────────────────────────────────────────────

export type ProjectRow = {
  id: number;
  team_id: number;
  slug: string;
  name: string;
  summary: string | null;
  project_type: string;
  repo_url: string | null;
  live_url: string | null;
  showcase_state: "draft" | "unlisted" | "public" | "hidden_by_moderation";
};

const PROJECT_COLS = "id, team_id, slug, name, summary, project_type, repo_url, live_url, showcase_state";

export async function getProjectById(id: number) {
  const [p] = await query<ProjectRow>(`select ${PROJECT_COLS} from projects where id = $1`, [id]);
  return p ?? null;
}

export async function getProjectBySlug(slug: string) {
  const [p] = await query<ProjectRow>(`select ${PROJECT_COLS} from projects where slug = $1`, [slug]);
  return p ?? null;
}

export async function getProjectForTeam(teamId: number) {
  const [p] = await query<ProjectRow>(`select ${PROJECT_COLS} from projects where team_id = $1`, [teamId]);
  return p ?? null;
}

/** Who is acting on a project, after the team-scope check. `member` is null for read-only staff. */
export type ProjectAccess = { project: ProjectRow; member: MemberRow | null; staff: Staff | null; actor: Actor; canWrite: boolean };

/**
 * Resolve the caller for project `projectId`: a bearer token (CLI/MCP) or the
 * browser's member cookie, on the project's team. Organizer/admin staff may
 * read. Writes need a member of the team; staff never write as a member.
 */
export async function authorizeProject(projectId: number, opts: { req?: Request; write?: boolean } = {}): Promise<ProjectAccess> {
  const project = await getProjectById(projectId);
  if (!project) throw new AppError("NOT_FOUND");
  if (opts.req?.headers.get("authorization")) {
    const bearer = await authenticateBearer(opts.req);
    if (!bearer) throw new AppError("UNAUTHENTICATED");
    if (bearer.member.team_id !== project.team_id) throw new AppError("FORBIDDEN");
    return { project, member: bearer.member, staff: null, actor: tokenActor(bearer), canWrite: true };
  }
  const member = await getMember();
  if (member && member.team_id === project.team_id) return { project, member, staff: null, actor: memberActor(member), canWrite: true };
  if (!opts.write) {
    const staff = await getStaff();
    if (staff && (staff.role === "organizer" || staff.role === "admin")) {
      return { project, member: null, staff, actor: { type: "staff", id: staff.id, role: staff.role, label: staff.name }, canWrite: false };
    }
  }
  throw new AppError(member ? "FORBIDDEN" : "UNAUTHENTICATED");
}

/** The studio for /studio/[slug]: the team's project, with write access for members. */
export async function authorizeStudio(slug: string, opts: { write?: boolean } = {}) {
  const [t] = await query<{ id: number; slug: string; name: string }>("select id, slug, name from teams where slug = $1", [slug]);
  if (!t) throw new AppError("NOT_FOUND");
  const project = await getProjectForTeam(t.id);
  if (!project) throw new AppError("NOT_FOUND", { userMessage: "This team has no project record yet. Ask an organizer." });
  const access = await authorizeProject(project.id, { write: opts.write });
  return { ...access, team: t };
}

export function requireWrite(a: ProjectAccess): asserts a is ProjectAccess & { member: MemberRow } {
  if (!a.canWrite || !a.member) throw new AppError("FORBIDDEN", { userMessage: "Only members of this team can change its studio." });
}

// ── Team, runs and evidence (read-only views of other areas' tables) ─────────

export type TeamPerson = {
  id: number;
  name: string;
  handle: string | null;
  /** Latest consent to be credited publicly (activity_publication or social_mention). */
  creditConsent: boolean;
  /** Latest consent to be @-mentioned (social_mention). */
  mentionConsent: boolean;
};

export async function getTeamPeople(teamId: number): Promise<TeamPerson[]> {
  const rows = await query<{ id: number; name: string; handle: string | null; activity: boolean | null; mention: boolean | null }>(
    `select m.id, coalesce(nullif(m.display_name, ''), m.name) as name, nullif(m.x_handle, '') as handle,
            (select c.granted from member_consent_current c where c.member_id = m.id and c.category = 'activity_publication') as activity,
            (select c.granted from member_consent_current c where c.member_id = m.id and c.category = 'social_mention') as mention
       from members m
      where m.team_id = $1 and m.deleted_at is null
      order by m.id`,
    [teamId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle, creditConsent: r.activity === true || r.mention === true, mentionConsent: r.mention === true }));
}

export async function getProofSources(projectId: number): Promise<{ runs: RunOption[]; evidence: EvidenceOption[] }> {
  const [runs, evidence] = await Promise.all([
    query<{ id: number; status: string; source_verified: boolean; verification_state: string; commit_sha: string | null; objective: string | null; finished_at: Date | null }>(
      `select id, status, source_verified, verification_state, commit_sha, objective, finished_at
         from kane_runs where project_id = $1 order by received_at desc limit 50`,
      [projectId],
    ).catch(() => []),
    query<{ id: number; kind: string; sha256: string; verified_at: Date | null; source_run_id: number | null }>(
      `select id, kind, sha256, verified_at, source_run_id from evidence_artifacts
        where project_id = $1 and redaction_state <> 'quarantined' order by uploaded_at desc limit 50`,
      [projectId],
    ).catch(() => []),
  ]);
  return {
    runs: runs.map((r) => ({
      id: String(r.id),
      status: r.status,
      sourceVerified: r.source_verified,
      verificationState: r.verification_state,
      commitSha: r.commit_sha,
      objective: r.objective,
      finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    })),
    evidence: evidence.map((e) => ({ id: String(e.id), kind: e.kind, sha: e.sha256.slice(0, 12), verified: !!e.verified_at, runId: e.source_run_id ? String(e.source_run_id) : null })),
  };
}

export async function getBadges(projectId: number): Promise<Badges> {
  const [row] = await query<{ shipped: boolean; kane: boolean }>(
    `select exists (select 1 from submissions s where s.project_id = $1 and s.status in ('finalized','locked')) as shipped,
            exists (select 1 from kane_runs k where k.project_id = $1 and k.source_verified and k.verification_state = 'verified' and k.status = 'passed') as kane`,
    [projectId],
  ).catch(() => [{ shipped: false, kane: false }]);
  return { shipped: !!row?.shipped, kaneVerified: !!row?.kane };
}

// The claim/evidence review itself is pure (shared with the editor's live table).
export { reviewStory, type StoryReview, type ProofReview, type ImpactReview, type RunOption, type EvidenceOption } from "@/components/ship-templates/review";

// ── Story versions ───────────────────────────────────────────────────────────

export type StoryVersion = {
  id: number;
  version: number;
  content: Story;
  createdAt: string;
  createdBy: string | null;
  reviewedAt: string | null;
};

type StoryRow = { id: number; version: number; content: unknown; created_at: Date; created_by_name: string | null; reviewed_at: Date | null };

function toVersion(r: StoryRow): StoryVersion {
  const parsed = storySchema.safeParse(r.content);
  return {
    id: r.id,
    version: r.version,
    // A row that no longer parses (hand-edited) still opens; the editor re-validates on save.
    content: parsed.success ? parsed.data : (r.content as Story),
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by_name,
    reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
  };
}

const STORY_SELECT = `select s.id, s.version, s.content, s.created_at, s.reviewed_at, m.name as created_by_name
                        from project_stories s left join members m on m.id = s.created_by`;

export async function getStory(projectId: number, version?: number | null): Promise<StoryVersion | null> {
  const rows = await query<StoryRow>(
    version ? `${STORY_SELECT} where s.project_id = $1 and s.version = $2` : `${STORY_SELECT} where s.project_id = $1 order by s.version desc limit 1`,
    version ? [projectId, version] : [projectId],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function listStoryVersions(projectId: number) {
  const rows = await query<StoryRow>(`${STORY_SELECT} where s.project_id = $1 order by s.version desc limit 30`, [projectId]);
  return rows.map(toVersion);
}

/**
 * A first draft for a project with no story yet: name, public summary, links,
 * project type and the team (nobody credited until they opt in). Private idea
 * text is never copied in, so it can't leak through a publish.
 */
export async function seedStory(project: ProjectRow, people: TeamPerson[]): Promise<Story> {
  const [idea] = await query<{ public_summary: string | null }>("select public_summary from ideas where team_id = $1", [project.team_id]).catch(() => []);
  const s = blankStory(project);
  const type = project.project_type as Story["creation_type"];
  s.creation_type = storySchema.shape.creation_type.safeParse(type).success ? type : "other";
  s.one_line_pitch = (idea?.public_summary ?? project.summary ?? "").slice(0, 170);
  s.what_we_built = project.summary ?? "";
  s.links.github = project.repo_url?.startsWith("https://") ? project.repo_url : "";
  s.links.demo = project.live_url?.startsWith("https://") ? project.live_url : "";
  s.links.ship_page = siteUrl(`/ship/${project.slug}`);
  s.team = people.map((p) => ({ display_name: p.name, handle: p.handle, publicly_credited: false }));
  return s;
}

const saveInput = z.object({
  content: z.unknown(),
  expected_version: z.coerce.number().int().min(0),
  idempotency_key: z.string().trim().min(8).max(200).optional(),
});

/**
 * Save a new story version. Fails with CONFLICT if someone saved since
 * `expected_version`, VALIDATION_FAILED with the review's reasons if a claim
 * is forged or unsupported.
 */
export async function saveStory(access: ProjectAccess, input: unknown): Promise<{ data: StoryVersion & { review: StoryReview }; receipt: Receipt }> {
  requireWrite(access);
  const { content, expected_version, idempotency_key } = parse(saveInput, input);
  const { project, member, actor } = access;

  const raw = parse(storySchema, normalizeStoryInput(content, project));
  // Server-owned fields: never trust the client for these.
  const story: Story = { ...raw, project_id: String(project.id), slug: project.slug, status: "draft", links: { ...raw.links, ship_page: siteUrl(`/ship/${project.slug}`) } };
  const people = await getTeamPeople(project.team_id);
  story.team = reconcileTeam(story.team, people);

  const review = reviewStory(story, await getProofSources(project.id));
  if (review.saveErrors.length) {
    throw new AppError("VALIDATION_FAILED", { userMessage: review.saveErrors[0], details: { issues: review.saveErrors.map((m) => ({ path: "proof", message: m })) } });
  }

  const { result } = await idempotent(idempotency_key, `story.save:project:${project.id}`, () =>
    withAudit(actor, "story.save", "project_story", async (tx) => {
      const { rows: cur } = await tx.query<{ v: number }>("select coalesce(max(version), 0) as v from project_stories where project_id = $1", [project.id]);
      if (cur[0].v !== expected_version) {
        throw new AppError("CONFLICT", { userMessage: `Someone saved version ${cur[0].v} while you were editing version ${expected_version}. Reload to see their changes.` });
      }
      const { rows } = await tx.query<{ id: number; version: number; created_at: Date }>(
        `insert into project_stories (project_id, version, content, created_by) values ($1, $2, $3, $4) returning id, version, created_at`,
        [project.id, expected_version + 1, JSON.stringify(story), member.id],
      );
      const r = rows[0];
      return {
        result: { id: r.id, version: r.version, createdAt: r.created_at.toISOString() },
        resourceId: r.id,
        after: story,
        payload: { project_id: project.id, version: r.version, proof: story.proof.length, blockers: review.publishBlockers.length },
      };
    }),
  );
  const now = await serverNow();
  return {
    data: { id: result.id, version: result.version, content: story, createdAt: result.createdAt, createdBy: member.name, reviewedAt: null, review },
    receipt: { id: `STORY-${project.id}-v${result.version}`, server_time: now.toISOString() },
  };
}

/** Accepts the story as an object or a JSON string (form posts), fills server fields. */
function normalizeStoryInput(content: unknown, project: ProjectRow) {
  let c = content;
  if (typeof c === "string") {
    try {
      c = JSON.parse(c);
    } catch {
      throw new AppError("VALIDATION_FAILED", { userMessage: "The story isn't valid JSON." });
    }
  }
  if (!c || typeof c !== "object") throw new AppError("VALIDATION_FAILED", { userMessage: "Missing story content." });
  return { ...(c as object), schema_version: 1, project_id: String(project.id), slug: project.slug, status: "draft" };
}

/**
 * Keep story.team in step with the real team: names come from the members
 * table (not free text), the credit toggle carries over by name, and handles
 * are only kept for people who consented to mentions.
 */
function reconcileTeam(team: Story["team"], people: TeamPerson[]): Story["team"] {
  const credit = new Map(team.map((t) => [t.display_name.trim().toLowerCase(), t.publicly_credited]));
  return people.map((p) => ({
    display_name: p.name,
    handle: p.mentionConsent ? p.handle : null,
    publicly_credited: credit.get(p.name.trim().toLowerCase()) ?? false,
  }));
}

// ── Template choice (T-SHIP-09) ──────────────────────────────────────────────

export async function getShipTemplate(projectId: number): Promise<ShipTemplateId> {
  const [row] = await query<{ ship_template: string }>("select ship_template from studio_settings where project_id = $1", [projectId]).catch(() => []);
  return isShipTemplate(row?.ship_template) ? row.ship_template : DEFAULT_TEMPLATE;
}

export async function setShipTemplate(access: ProjectAccess, input: unknown): Promise<{ data: { template: ShipTemplateId }; receipt: Receipt }> {
  requireWrite(access);
  const { template } = parse(z.object({ template: z.string().refine(isShipTemplate, "Unknown template") }), input);
  const t = template as ShipTemplateId;
  await withAudit(access.actor, "studio.template", "project", async (tx) => {
    const { rows } = await tx.query<{ ship_template: string }>("select ship_template from studio_settings where project_id = $1", [access.project.id]);
    await tx.query(
      `insert into studio_settings (project_id, ship_template, updated_by) values ($1, $2, $3)
       on conflict (project_id) do update set ship_template = excluded.ship_template, updated_by = excluded.updated_by, updated_at = now()`,
      [access.project.id, t, access.member.id],
    );
    return { result: null, resourceId: access.project.id, before: rows[0]?.ship_template ?? DEFAULT_TEMPLATE, after: t };
  });
  // The template is a display choice: claims, consents and the published version are untouched.
  return { data: { template: t }, receipt: { id: `TPL-${access.project.id}-${t}`, server_time: (await serverNow()).toISOString() } };
}

// ── Publishing (T-SHIP-05) ───────────────────────────────────────────────────

export type ConsentReceipt = {
  policy: string;
  story_version: number;
  approved_by: { member_id: number; name: string };
  approved_at: string;
  credited: { member_id: number; name: string; handle: string | null }[];
  uncredited_count: number;
  checks: string[];
};

export type PublishedRef = { id: number; version: number; publishedAt: string; storyId: number | null; state: string; consent: ConsentReceipt };

export async function getLatestPublished(projectId: number, kind: "ship_page" | "deck" | "video" = "ship_page"): Promise<PublishedRef | null> {
  const [r] = await query<{ id: number; version: number; published_at: Date; source_story_id: number | null; state: string; consent_receipt: ConsentReceipt }>(
    `select id, version, published_at, source_story_id, state, consent_receipt from published_assets
      where project_id = $1 and kind = $2 order by version desc limit 1`,
    [projectId, kind],
  );
  return r ? { id: r.id, version: r.version, publishedAt: r.published_at.toISOString(), storyId: r.source_story_id, state: r.state, consent: r.consent_receipt } : null;
}

/** Who can be credited right now, and why not. Used by the publish panel and publishShowcase. */
export function consentCheck(story: Story, people: TeamPerson[]) {
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p]));
  const credited: { member_id: number; name: string; handle: string | null }[] = [];
  const missing: string[] = [];
  for (const t of story.team) {
    if (!t.publicly_credited) continue;
    const p = byName.get(t.display_name.trim().toLowerCase());
    if (!p) missing.push(`${t.display_name} isn't on the team any more. Untick their credit.`);
    else if (!p.creditConsent) missing.push(`${p.name} hasn't consented to public credit. They can opt in from their own account, or you can untick their credit.`);
    else credited.push({ member_id: p.id, name: p.name, handle: p.mentionConsent ? p.handle : null });
  }
  return { credited, missing, uncredited: story.team.length - credited.length - missing.length };
}

const publishInput = z.object({
  story_version: z.coerce.number().int().positive(),
  confirm_phrase: z.string().trim(),
  idempotency_key: z.string().trim().min(8).max(200).optional(),
});

/**
 * Publish an approved story version as the public Ship Page. Needs a member
 * of the team, the slug typed to confirm, no review blockers and a clean
 * consent check. Inserts an immutable published_assets row (pinned to the
 * live submission when there is one) and stamps the story as reviewed.
 */
export async function publishShowcase(access: ProjectAccess, input: unknown): Promise<{ data: PublishedRef; receipt: Receipt }> {
  requireWrite(access);
  if (!(await isEnabled("ship_pages"))) throw new AppError("FEATURE_DISABLED", { userMessage: "Public Ship Pages are switched off right now. Your story is saved." });
  // Publishing puts names and claims on a public page: a person does it in the
  // browser. Agents (bearer / MCP) get the link instead.
  if (access.actor.type === "token") {
    throw new AppError("FORBIDDEN", { userMessage: `Publishing is done by a teammate in the browser: ${siteUrl(`/studio/${access.project.slug}#publish`)}` });
  }
  const { story_version, confirm_phrase, idempotency_key } = parse(publishInput, input);
  const { project, member, actor } = access;
  if (confirm_phrase.toLowerCase() !== project.slug.toLowerCase()) {
    throw new AppError("VALIDATION_FAILED", { userMessage: `Type the project slug “${project.slug}” to confirm.` });
  }
  if (project.showcase_state === "hidden_by_moderation") throw new AppError("FORBIDDEN", { userMessage: "This Ship Page is hidden by an organizer. Ask at the help desk." });

  const sv = await getStory(project.id, story_version);
  if (!sv) throw new AppError("NOT_FOUND", { userMessage: `Story version ${story_version} doesn't exist.` });
  const story = parse(storySchema, sv.content);
  const review = reviewStory(story, await getProofSources(project.id));
  if (review.publishBlockers.length) {
    throw new AppError("VALIDATION_FAILED", { userMessage: review.publishBlockers[0], details: { issues: review.publishBlockers.map((m) => ({ path: "story", message: m })) } });
  }
  const people = await getTeamPeople(project.team_id);
  const consent = consentCheck(story, people);
  if (consent.missing.length) throw new AppError("CONSENT_REQUIRED", { userMessage: consent.missing[0], details: { issues: consent.missing.map((m) => ({ path: "team", message: m })) } });

  const { result } = await idempotent(idempotency_key, `showcase.publish:project:${project.id}`, () =>
    withAudit(actor, "showcase.publish", "published_asset", async (tx) => {
      // The submission deadline time no longer locks the Ship Page (event day, 2026-10-24).
      const { rows: now } = await tx.query<{ now: Date }>("select now() as now");
      const { rows: cur } = await tx.query<{ showcase_state: ProjectRow["showcase_state"] }>("select showcase_state from projects where id = $1 for update", [project.id]);
      if (cur[0]?.showcase_state === "hidden_by_moderation") throw new AppError("FORBIDDEN", { userMessage: "This Ship Page is hidden by an organizer. Ask at the help desk." });
      const { rows: sub } = await tx.query<{ id: number }>(
        "select id from submissions where project_id = $1 and status in ('finalized','locked','awaiting_confirmation','preflighted','draft') order by id desc limit 1",
        [project.id],
      );
      const { rows: next } = await tx.query<{ v: number }>("select coalesce(max(version), 0) + 1 as v from published_assets where project_id = $1 and kind = 'ship_page'", [project.id]);
      const receipt: ConsentReceipt = {
        policy: "Named credit needs that person's own activity_publication or social_mention consent; an @handle needs social_mention. Uncredited teammates are not named.",
        story_version,
        approved_by: { member_id: member.id, name: member.name },
        approved_at: now[0].now.toISOString(),
        credited: consent.credited,
        uncredited_count: consent.uncredited,
        checks: ["claims reviewed against this project's Kane runs and evidence", "consent_reviewed ticked by the team", `confirmed by typing “${project.slug}”`],
      };
      const { rows } = await tx.query<{ id: number; version: number; published_at: Date }>(
        `insert into published_assets (project_id, kind, version, source_story_id, state, consent_receipt, published_by, submission_id)
         values ($1, 'ship_page', $2, $3, 'public', $4, $5, $6) returning id, version, published_at`,
        [project.id, next[0].v, sv.id, JSON.stringify(receipt), member.id, sub[0]?.id ?? null],
      );
      await tx.query("update project_stories set reviewed_by = $2, reviewed_at = now() where id = $1", [sv.id, member.id]);
      // /ship/{slug} is gated on projects.showcase_state, so publishing makes the page public.
      if (cur[0]?.showcase_state !== "public") {
        await tx.query("update projects set showcase_state = 'public', updated_at = now() where id = $1", [project.id]);
      }
      const r = rows[0];
      return {
        result: { id: r.id, version: r.version, publishedAt: r.published_at.toISOString(), storyId: sv.id, state: "public", consent: receipt } satisfies PublishedRef,
        resourceId: r.id,
        before: { showcase_state: cur[0]?.showcase_state ?? null },
        after: { story_version, credited: consent.credited.map((c) => c.member_id), showcase_state: "public" },
        payload: { project_id: project.id, story_version, version: r.version, submission_id: sub[0]?.id ?? null },
      };
    }),
  );
  return { data: result, receipt: { id: `SHIP-${project.slug}-v${result.version}`, server_time: result.publishedAt } };
}

// ── Reading for public pages ─────────────────────────────────────────────────

async function runFacts(projectId: number, ids: string[]): Promise<Record<string, PublicProof["run"]>> {
  const nums = ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!nums.length) return {};
  const rows = await query<{ id: number; status: string; finished_at: Date | null; objective: string | null }>(
    "select id, status, finished_at, objective from kane_runs where project_id = $1 and id = any($2::bigint[])",
    [projectId, nums],
  ).catch(() => []);
  return Object.fromEntries(rows.map((r) => [String(r.id), { status: r.status, finished_at: r.finished_at ? r.finished_at.toISOString() : null, objective: r.objective }]));
}

/**
 * Credited people from a publish receipt, re-checked against *current*
 * consent so a withdrawal takes effect without a republish. Accepts both the
 * studio receipt shape ({ name }) and the finalize one ({ display_name }).
 */
async function stillCredited(list: { member_id: number; name?: string; display_name?: string; handle?: string | null }[]) {
  const ids = list.map((c) => Number(c.member_id)).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) return [];
  const rows = await query<{ member_id: number; category: string }>(
    "select member_id, category from member_consent_current where member_id = any($1::bigint[]) and category in ('activity_publication','social_mention') and granted",
    [ids],
  ).catch(() => []);
  const ok = new Set(rows.map((r) => Number(r.member_id)));
  const mention = new Set(rows.filter((r) => r.category === "social_mention").map((r) => Number(r.member_id)));
  // An @handle needs social_mention, same as at publish time.
  return list
    .filter((c) => ok.has(Number(c.member_id)))
    .map((c) => ({ name: c.name ?? c.display_name ?? "", handle: mention.has(Number(c.member_id)) ? (c.handle ?? null) : null }));
}

/**
 * The published Ship Page story for `slug` (or a project id), as a public
 * DTO, or null when nothing is published or the page is hidden. This is the
 * one function /ship/[slug] and the deck read.
 */
export async function getPublishedStory(slugOrId: string | number): Promise<{ story: PublicStory; template: ShipTemplateId; projectId: number } | null> {
  const project = typeof slugOrId === "number" ? await getProjectById(slugOrId) : await getProjectBySlug(slugOrId);
  // Same visibility rule as /ship/{slug} (showcase.ts): only public or
  // unlisted pages are readable; a team that switched its page Off, or a
  // moderation hide, takes the deck down too.
  if (!project || (project.showcase_state !== "public" && project.showcase_state !== "unlisted")) return null;
  const pub = await getLatestPublished(project.id, "ship_page");
  if (!pub || pub.state === "hidden_by_moderation" || pub.state === "draft" || !pub.storyId) return null;
  const [row] = await query<StoryRow>(`${STORY_SELECT} where s.id = $1`, [pub.storyId]);
  if (!row) return null;
  const sv = toVersion(row);
  const [badges, template, deck, runs] = await Promise.all([
    getBadges(project.id),
    getShipTemplate(project.id),
    getLatestPublished(project.id, "deck"),
    runFacts(project.id, sv.content.proof.map((p) => p.run_id ?? "").filter(Boolean)),
  ]);
  // Finalize stores screenshots as private Blob paths; the public reads them through /ship/{slug}/media.
  const visuals = sv.content.visuals.map((v) => (v.source.startsWith(mediaPrefix(project.id)) ? { ...v, source: mediaSrc(project.slug, v.source) } : v));
  const story = toPublicStory(
    { ...sv.content, visuals, status: "published" },
    {
      shipPage: siteUrl(`/ship/${project.slug}`),
      credited: await stillCredited(pub.consent?.credited ?? []),
      proofRuns: runs,
      badges,
      version: pub.version,
      publishedAt: pub.publishedAt,
      // No deck asset → /ship/{slug}/deck serves the default deck from this story (deck.ts).
      hasDeck: !deck || (deck.state !== "hidden_by_moderation" && deck.state !== "draft"),
      preview: false,
    },
  );
  return { story, template, projectId: project.id };
}

/** A team-only preview of a story version as it would publish (showcase_preview). */
export async function previewStory(access: ProjectAccess, version?: number | null) {
  const { project } = access;
  const people = await getTeamPeople(project.team_id);
  const sv = await getStory(project.id, version);
  const content = sv?.content ?? (await seedStory(project, people));
  const [sources, badges, template, deck] = await Promise.all([getProofSources(project.id), getBadges(project.id), getShipTemplate(project.id), getLatestPublished(project.id, "deck")]);
  const review = reviewStory(content, sources);
  const consent = consentCheck(content, people);
  const runs = Object.fromEntries(sources.runs.map((r) => [r.id, { status: r.status, finished_at: r.finishedAt, objective: r.objective }]));
  const story = toPublicStory(content, {
    shipPage: siteUrl(`/ship/${project.slug}`),
    credited: consent.credited.map((c) => ({ name: c.name, handle: c.handle })),
    proofRuns: runs,
    badges,
    version: null,
    publishedAt: null,
    hasDeck: !!deck,
    preview: true,
  });
  return { story, template, review, consent, version: sv?.version ?? 0 };
}

/** showcase_preview for API/MCP: the warnings and blockers in plain text. */
export async function showcasePreview(access: ProjectAccess) {
  const p = await previewStory(access);
  const published = await getLatestPublished(access.project.id, "ship_page");
  return {
    project_id: access.project.id,
    slug: access.project.slug,
    story_version: p.version,
    template: p.template,
    preview_url: siteUrl(`/studio/${access.project.slug}/preview`),
    public_url: published ? siteUrl(`/ship/${access.project.slug}`) : null,
    publish_blockers: p.review.publishBlockers,
    consent_missing: p.consent.missing,
    warnings: p.review.warnings,
    missing_proof: p.review.proof.filter((r) => r.state !== "verified").map((r) => ({ claim: r.claim, state: r.state, note: r.note })),
  };
}

// ── Vanity redirect (T-SHIP-10) ──────────────────────────────────────────────

/** Top-level paths a vanity /{slug} must never shadow. */
const RESERVED = new Set([
  "admin", "api", "content-hour", "help", "judge", "judging", "live", "login", "match", "mcp", "me", "ops", "pair", "passport",
  "photo", "photos", "print", "register", "resources", "ship", "studio", "submit", "t", "team", "webhooks", "activate", "idea", "docs", "health",
]);

/**
 * Where a vanity `/{slug}` should go: `/ship/{slug}` when that page is
 * published and the slug doesn't collide with a site route; otherwise null.
 * Wire it from proxy.ts (foundation) if the organisers want vanity URLs.
 */
export async function vanityTarget(slug: string): Promise<string | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || RESERVED.has(slug)) return null;
  const pub = await getPublishedStory(slug).catch(() => null);
  return pub ? `/ship/${slug}` : null;
}

/** For the hub/navbar: the member's studio, if they have a team. */
export async function studioPathFor(member: MemberRow | null) {
  if (!member?.team_id) return null;
  const [t] = await query<{ slug: string }>("select slug from teams where id = $1", [member.team_id]);
  return t ? `/studio/${t.slug}` : null;
}

// ── API helpers (/api/v1 studio routes) ──────────────────────────────────────

/** A positive integer path id, or NOT_FOUND. */
export function pathId(raw: string) {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError("NOT_FOUND");
  return n;
}

/**
 * The JSON body of a mutation (`{ ...fields }` or `{ data: { ...fields } }`),
 * with the `Idempotency-Key` header folded in as idempotency_key.
 */
export async function readMutation(req: Request): Promise<Record<string, unknown>> {
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION_FAILED", { userMessage: "The request body isn't valid JSON." });
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fields = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : obj;
  const key = req.headers.get("idempotency-key");
  return key && !fields.idempotency_key ? { ...fields, idempotency_key: key } : fields;
}

// Names the MCP server (kane-mcp) registers: showcase_preview / showcase_publish.
export const showcasePublish = publishShowcase;
