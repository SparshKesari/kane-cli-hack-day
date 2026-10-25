import "server-only";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { getMember, getStaff, hasRole, staffActor, type Staff } from "./auth";
import { AppError, parse, transaction, writeAudit, z, zx, type Actor } from "./core";
import type { KaneRunRef, SubmissionDraft } from "./submission";

// The public showcase at /ship/{slug}. One reviewed project_story (blueprint
// templates/project-story.schema.json) powers the page, the OG card and the
// deck (studio-deck reads it through getPublishedStory). The story is built
// from the finalized submission; the submission itself stays a separate,
// immutable record.
//
// Page modes live on projects.showcase_state:
//   draft                 only the team and organizers can open it (preview)
//   unlisted              anyone with the link; not in the /ship gallery
//   public                link + gallery
//   hidden_by_moderation  organizers hid it; the team can't undo that
//
// Public DTOs leave out private fields: no emails, no receipt codes, no private
// idea text, and team members only when they consented to be credited.

// ── Shared constants ────────────────────────────────────────────────────────

export const PROJECT_TYPES = ["application", "agent", "extension", "plugin", "workflow", "ci_pipeline", "validation_harness", "tool", "other"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  application: "Application",
  agent: "AI agent",
  extension: "Browser extension",
  plugin: "Developer plugin",
  workflow: "Workflow",
  ci_pipeline: "CI/CD pipeline",
  validation_harness: "Validation harness",
  tool: "Tool",
  other: "Other",
};

export const SHOWCASE_STATES = ["draft", "unlisted", "public", "hidden_by_moderation"] as const;
export type ShowcaseState = (typeof SHOWCASE_STATES)[number];

/** Modes a team may pick for itself. Moderation is organizer-only. */
export const TEAM_SHOWCASE_STATES = ["public", "unlisted", "draft"] as const;

/** Consent category that governs being named on a public showcase / deck. */
export const CREDIT_CONSENT = "activity_publication";

/** Blob folder for a project's screenshots. Uploads must land under it. */
export const mediaPrefix = (projectId: number) => `showcase/p${projectId}/`;

/** Browser URL for a private screenshot, served through /ship/{slug}/media. */
export const mediaSrc = (slug: string, path: string) => `/ship/${slug}/media/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Where the browser loads a story visual. Only this project's private uploads go through
 * /ship/{slug}/media (it serves nothing else); an https link or a site path is used as is.
 * Anything else (http, protocol-relative, script, another project's upload) isn't shown.
 */
export const visualSrc = (slug: string, projectId: number, source: string): string | null => {
  if (source.startsWith(mediaPrefix(projectId))) return mediaSrc(slug, source);
  if (/^https:\/\/[^\s"'<>]+$/.test(source) || /^\/(?!\/)[\w./-]+$/.test(source)) return source;
  return null;
};

// ── Story shape (templates/project-story.schema.json) ───────────────────────

export type ProofConfidence = "verified" | "participant_reported" | "unverified";

export type ProjectStory = {
  schema_version: 1;
  project_id: string;
  slug: string;
  project_name: string;
  one_line_pitch: string;
  creation_type: string;
  problem: string;
  what_we_built: string;
  how_it_works: string[];
  harness: { summary: string; components: string[]; stages: string[] };
  proof: { claim: string; confidence: ProofConfidence; source: string; run_id: string | null; evidence_id: string | null; commit_sha: string | null }[];
  impact: { claim: string; measure: number | null; unit: string | null; baseline: number | null; source: string | null }[];
  limitations: string[];
  links: { github?: string; demo?: string; repo_commit?: string; ship_page?: string };
  team: { display_name: string; handle: string | null; publicly_credited: boolean }[];
  visuals: { kind: string; approved: boolean; source: string; alt_text?: string }[];
  consent_reviewed: boolean;
  status: "draft" | "approved" | "published";
};

/** Someone who said yes to being credited, as recorded in the publish consent receipt. */
export type CreditedMember = { member_id: number; display_name: string; handle: string | null; consent_recorded_at: string | null };

/**
 * A Kane run's honest public label. Teal VERIFIED only for a passing run that
 * came in through a verified channel; a failing run is a detection
 * (SUSPECTED), never a confirmed bug; everything else is participant reported.
 */
export function runConfidence(r: Pick<KaneRunRef, "status" | "source_verified">): "verified" | "detected" | "reported" {
  if (r.status === "failed" || r.status === "errored" || r.status === "blocked") return "detected";
  if (r.status === "passed" && r.source_verified) return "verified";
  return "reported";
}

const githubCommitUrl = (repo: string | null, sha: string | null) => {
  if (!repo || !sha) return undefined;
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(repo);
  return m ? `https://github.com/${m[1]}/${m[2]}/commit/${sha}` : undefined;
};

/** Build the canonical story from a submission draft. Pure; no I/O. */
/** Trimmed to at most `max` characters, cut at a word with "…" when longer. */
const clipAtWord = (text: string | null | undefined, max: number) => {
  const t = text?.trim() ?? "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length).trimEnd()}…`;
};

export function buildStory(input: {
  projectId: number;
  slug: string;
  draft: SubmissionDraft;
  runs: KaneRunRef[];
  credited: CreditedMember[];
  status: ProjectStory["status"];
}): ProjectStory {
  const { draft: d, runs } = input;
  const linked = runs.filter((r) => d.kane_run_ids.includes(r.id));
  const proof: ProjectStory["proof"] = [
    ...linked.map((r) => {
      const c = runConfidence(r);
      const what = r.objective?.trim() || `Kane run ${r.upstream_execution_id}`;
      return {
        claim: c === "detected" ? `Kane detected a failure: ${what}` : c === "verified" ? `Kane run passed: ${what}` : `Kane run reported (${r.status}): ${what}`,
        // A detection is still evidence, but never a "verified" success.
        confidence: (c === "verified" ? "verified" : "participant_reported") as ProofConfidence,
        source: `kane_run:${r.source}`,
        run_id: String(r.id),
        evidence_id: r.evidence_artifact_id ? String(r.evidence_artifact_id) : null,
        commit_sha: r.commit_sha,
      };
    }),
    ...d.evidence_refs.map((url) => ({
      claim: "Evidence linked by the team",
      confidence: "participant_reported" as const,
      source: url,
      run_id: null,
      evidence_id: null,
      commit_sha: d.commit_sha,
    })),
  ];
  const visuals: ProjectStory["visuals"] = [
    ...d.screenshots.map((s) => ({ kind: "screenshot", approved: true, source: s.path, alt_text: s.alt || `${d.project_name ?? "Project"} screenshot` })),
    ...(d.video_url ? [{ kind: "video", approved: true, source: d.video_url, alt_text: `${d.project_name ?? "Project"} demo video` }] : []),
  ];
  return {
    schema_version: 1,
    project_id: String(input.projectId),
    slug: input.slug,
    project_name: d.project_name ?? "Untitled project",
    one_line_pitch: d.one_line_pitch ?? "",
    creation_type: d.project_type,
    problem: d.problem ?? "",
    // The final form's description (since 16:40 PT on the day), else an older draft's text.
    what_we_built: clipAtWord(d.project_description, 2000) || d.what_we_built || "",
    how_it_works: d.how_it_works,
    harness: { summary: d.harness_summary ?? "", components: d.kane_components, stages: d.harness_stages.filter(Boolean) },
    proof,
    // A number without a source is shown as qualitative, so drop the number here.
    impact: d.impact.map((i) => ({ ...i, measure: i.source ? i.measure : null, baseline: i.source ? i.baseline : null })),
    limitations: d.limitations,
    links: {
      ...(d.repo_url ? { github: d.repo_url } : {}),
      ...(d.demo_url ? { demo: d.demo_url } : {}),
      ...(githubCommitUrl(d.repo_url, d.commit_sha) ? { repo_commit: githubCommitUrl(d.repo_url, d.commit_sha) } : {}),
      ship_page: `/ship/${input.slug}`,
    },
    // Only people who consented are in the story at all, so no renderer can leak a name.
    team: input.credited.map((c) => ({ display_name: c.display_name, handle: c.handle, publicly_credited: true })),
    visuals,
    consent_reviewed: true,
    status: input.status,
  };
}

/**
 * Finalize, for a team that already approved and published a story in the Ship Studio: that
 * story stays the public page. Its text, proof and harness stand; the submission adds only the
 * screenshots and video the story doesn't have yet, and the links it left empty. Credits come
 * from the consent check finalize just ran, as for any finalize. Pure; no I/O.
 */
export function keepStudioStory(studio: ProjectStory, fromSubmission: ProjectStory): ProjectStory {
  const have = new Set(studio.visuals.map((v) => v.source));
  const links = { ...fromSubmission.links };
  for (const [k, v] of Object.entries(studio.links) as [keyof ProjectStory["links"], string | undefined][]) if (v && k !== "ship_page") links[k] = v;
  return {
    ...studio,
    schema_version: 1,
    project_id: fromSubmission.project_id,
    slug: fromSubmission.slug,
    links,
    team: fromSubmission.team,
    visuals: [...studio.visuals, ...fromSubmission.visuals.filter((v) => !have.has(v.source))].slice(0, 12),
    consent_reviewed: true,
    status: fromSubmission.status,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type ProjectRow = {
  id: number;
  team_id: number;
  slug: string;
  name: string;
  project_type: ProjectType;
  summary: string | null;
  repo_url: string | null;
  live_url: string | null;
  run_command: string | null;
  state: string;
  showcase_state: ShowcaseState;
  updated_at: Date;
};

const PROJECT_COLS = "id, team_id, slug, name, project_type, summary, repo_url, live_url, run_command, state, showcase_state, updated_at";

export async function getProjectBySlug(slug: string) {
  const [p] = await query<ProjectRow>(`select ${PROJECT_COLS} from projects where slug = $1`, [slug]);
  return p ?? null;
}

export async function getProjectByTeam(teamId: number) {
  const [p] = await query<ProjectRow>(`select ${PROJECT_COLS} from projects where team_id = $1`, [teamId]);
  return p ?? null;
}

/** /ship/{slug}: the project, or the slug it was renamed to, or nothing. */
export async function resolveShipSlug(slug: string): Promise<{ project: ProjectRow } | { redirectTo: string } | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const project = await getProjectBySlug(slug);
  if (project) return { project };
  const [r] = await query<{ slug: string }>("select p.slug from project_slug_redirects r join projects p on p.id = r.project_id where r.old_slug = $1", [slug]);
  return r ? { redirectTo: r.slug } : null;
}

type PublishedRow = {
  asset_id: number;
  asset_version: number;
  story_id: number;
  story_version: number;
  content: ProjectStory;
  consent_receipt: { credited?: CreditedMember[] };
  published_at: Date;
};

async function latestPublished(projectId: number) {
  const [row] = await query<PublishedRow>(
    `select a.id as asset_id, a.version as asset_version, s.id as story_id, s.version as story_version, s.content, a.consent_receipt, a.published_at
       from published_assets a join project_stories s on s.id = a.source_story_id
      where a.project_id = $1 and a.kind = 'ship_page'
      order by a.version desc limit 1`,
    [projectId],
  );
  return row ?? null;
}

/**
 * Members whose latest credit consent is "yes", and those who currently allow
 * an @mention. Consent is per person and can be withdrawn at any time. Studio
 * publishes credit on activity_publication or social_mention (story.ts), so
 * either counts here too.
 */
async function currentlyConsenting(memberIds: number[]) {
  if (!memberIds.length) return { credit: new Set<number>(), mention: new Set<number>() };
  const rows = await query<{ member_id: number; category: string }>(
    "select member_id, category from member_consent_current where member_id = any($1::bigint[]) and category in ($2, 'social_mention') and granted",
    [memberIds, CREDIT_CONSENT],
  );
  return { credit: new Set(rows.map((r) => Number(r.member_id))), mention: new Set(rows.filter((r) => r.category === "social_mention").map((r) => Number(r.member_id))) };
}

export type PublishedStory = {
  project: Pick<ProjectRow, "id" | "slug" | "name" | "project_type" | "showcase_state" | "team_id">;
  story: ProjectStory;
  storyId: number;
  storyVersion: number;
  publishedAt: Date;
  /** Credited people, re-checked against current consent. */
  credited: CreditedMember[];
};

/**
 * The latest published story for /ship/{slug}, for the page, OG card and the
 * deck (studio-deck). Returns null unless the page is public or unlisted, or
 * `includeHidden` is set (team/organizer previews; the caller checks access).
 * The story's team list is filtered by *current* consent, so a withdrawal
 * takes effect immediately without a republish.
 */
export async function getPublishedStory(slug: string, opts: { includeHidden?: boolean } = {}): Promise<PublishedStory | null> {
  const project = await getProjectBySlug(slug);
  if (!project) return null;
  if (!opts.includeHidden && project.showcase_state !== "public" && project.showcase_state !== "unlisted") return null;
  const pub = await latestPublished(project.id);
  if (!pub) return null;
  // Studio publishes (story.ts) record credited people as { member_id, name };
  // finalize records { member_id, display_name }. Accept both shapes.
  const receipt = (pub.consent_receipt?.credited ?? []).map((c) => {
    const raw = c as CreditedMember & { name?: string };
    return { ...raw, display_name: raw.display_name ?? raw.name ?? "", handle: raw.handle ?? null, consent_recorded_at: raw.consent_recorded_at ?? null };
  });
  const ok = await currentlyConsenting(receipt.map((c) => Number(c.member_id)));
  const credited = receipt.filter((c) => ok.credit.has(Number(c.member_id))).map((c) => ({ ...c, handle: ok.mention.has(Number(c.member_id)) ? c.handle : null }));
  const byName = new Map(credited.map((c) => [c.display_name, c]));
  return {
    project: { id: project.id, slug: project.slug, name: project.name, project_type: project.project_type, showcase_state: project.showcase_state, team_id: project.team_id },
    // Team list filtered by *current* consent; a handle only while social_mention is still granted.
    story: {
      ...pub.content,
      team: pub.content.team.filter((t) => byName.has(t.display_name) && t.publicly_credited !== false).map((t) => ({ ...t, handle: byName.get(t.display_name)!.handle ? t.handle : null })),
    },
    storyId: Number(pub.story_id),
    storyVersion: pub.story_version,
    publishedAt: pub.published_at,
    credited,
  };
}

export type EvidenceRun = KaneRunRef & { confidence: ReturnType<typeof runConfidence> };

async function runsByIds(projectId: number, ids: number[]): Promise<EvidenceRun[]> {
  if (!ids.length) return [];
  const rows = await query<KaneRunRef>(
    `select id, source, upstream_execution_id, status, exit_code, commit_sha, objective, source_verified, verification_state,
            evidence_artifact_id, report_url, coalesce(finished_at, started_at, received_at) as at
       from kane_runs where project_id = $1 and id = any($2::bigint[])
      order by coalesce(finished_at, started_at, received_at)`,
    [projectId, ids],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), confidence: runConfidence(r) }));
}

/** Who is looking at a ship page: the team (preview rights), organizers, or the public. */
export async function shipViewer(teamId: number) {
  const [member, staff] = await Promise.all([getMember(), getStaff()]);
  const isTeam = !!member && member.team_id === teamId;
  const isOrganizer = hasRole(staff, "organizer");
  return { member: isTeam ? member : null, staff: isOrganizer ? staff : null, canPreview: isTeam || isOrganizer };
}

export type ShowcaseView = {
  project: ProjectRow;
  story: ProjectStory;
  mode: ShowcaseState;
  /** true: built live from the unfinalized draft (team preview only). */
  preview: boolean;
  publishedAt: Date | null;
  storyVersion: number | null;
  runs: EvidenceRun[];
  finalizedAt: Date | null;
  viewer: { canPreview: boolean; isTeam: boolean; isOrganizer: boolean };
  /**
   * Submission fields the story schema doesn't carry (D2: the page shows every
   * asset the team submitted). Only from a finalized submission, or the team's
   * own draft preview; never from an unfinalized draft on a public page.
   */
  extras: SubmissionExtras | null;
};

export type SubmissionExtras = {
  run_command: string | null;
  devpost_url: string | null;
  showcase_url: string | null;
  deck_url: string | null;
  /** Launch posts: LinkedIn, X, Hacker News and older drafts' social links, each once. */
  social_links: string[];
  blog_links: string[];
};

/**
 * A page published from the final form before its description reached the story (from 16:40 PT
 * on the day until this change) has an empty "what we built". Show the finalized submission's
 * description there. Display only: the published record is unchanged, and a draft that isn't
 * finalized never reaches a public page.
 */
export function withSubmittedDescription(story: ProjectStory, draft: SubmissionDraft, finalizedAt: Date | null): ProjectStory {
  if (story.what_we_built || !finalizedAt) return story;
  const text = clipAtWord(draft.project_description, 2000);
  return text ? { ...story, what_we_built: text } : story;
}

export const submissionExtras = (d: SubmissionDraft): SubmissionExtras | null => {
  const https = (u: string | null | undefined) => (u && /^https:\/\/[^\s]+$/.test(u) ? u : null);
  const list = (...urls: (string | null | undefined)[]) => [...new Set(urls.map(https).filter((u): u is string => !!u))];
  const x = {
    run_command: d.run_command?.trim() || null,
    devpost_url: https(d.devpost_url),
    showcase_url: https(d.showcase_url),
    deck_url: https(d.deck_url),
    social_links: list(...(d.social_links ?? []), ...(d.linkedin_posts ?? []), ...(d.x_posts ?? []), d.hn_url),
    blog_links: list(...(d.blog_links ?? [])),
  };
  return x.run_command || x.devpost_url || x.showcase_url || x.deck_url || x.social_links.length || x.blog_links.length ? x : null;
};

/**
 * Everything /ship/{slug} renders. Visitors get public/unlisted pages only;
 * the team and organizers also see draft and hidden pages (with a banner),
 * and, before finalize, a live preview built from the current draft.
 * `loadDraft` comes from the submission service, passed in to keep the
 * modules independent.
 */
export async function getShowcase(
  project: ProjectRow,
  loadDraft: (teamId: number) => Promise<{ draft: SubmissionDraft; runs: KaneRunRef[]; credited: CreditedMember[]; finalizedAt: Date | null } | null>,
): Promise<ShowcaseView | null> {
  const viewer = await shipViewer(project.team_id);
  const visible = project.showcase_state === "public" || project.showcase_state === "unlisted";
  if (!visible && !viewer.canPreview) return null;

  const [pub, sub] = await Promise.all([getPublishedStory(project.slug, { includeHidden: true }), loadDraft(project.team_id)]);
  const v = { canPreview: viewer.canPreview, isTeam: !!viewer.member, isOrganizer: !!viewer.staff };

  if (pub) {
    const ids = pub.story.proof.map((p) => Number(p.run_id)).filter((n) => Number.isInteger(n) && n > 0);
    return {
      project,
      story: sub ? withSubmittedDescription(pub.story, sub.draft, sub.finalizedAt) : pub.story,
      mode: project.showcase_state,
      preview: false,
      publishedAt: pub.publishedAt,
      storyVersion: pub.storyVersion,
      runs: await runsByIds(project.id, ids),
      finalizedAt: sub?.finalizedAt ?? null,
      viewer: v,
      extras: sub?.finalizedAt ? submissionExtras(sub.draft) : null,
    };
  }
  // Nothing published yet: only the team / organizers get a draft preview.
  if (!viewer.canPreview || !sub) return null;
  const story = buildStory({ projectId: project.id, slug: project.slug, draft: sub.draft, runs: sub.runs, credited: sub.credited, status: "draft" });
  return {
    project,
    story,
    mode: "draft",
    preview: true,
    publishedAt: null,
    storyVersion: null,
    runs: await runsByIds(project.id, sub.draft.kane_run_ids),
    finalizedAt: sub.finalizedAt,
    viewer: v,
    extras: submissionExtras(sub.draft),
  };
}

export type GalleryCard = {
  slug: string;
  name: string;
  pitch: string;
  type: ProjectType;
  teamName: string;
  cover: string | null;
  coverAlt: string;
  verifiedRuns: number;
  publishedAt: Date;
};

/** /ship gallery: public pages only (never unlisted, draft or hidden). */
export async function listGallery(type?: ProjectType | null): Promise<GalleryCard[]> {
  const rows = await query<{
    slug: string;
    name: string;
    project_type: ProjectType;
    team_name: string;
    project_id: number;
    content: ProjectStory;
    published_at: Date;
  }>(
    `select p.slug, p.name, p.project_type, t.name as team_name, p.id as project_id, s.content, a.published_at
       from projects p
       join teams t on t.id = p.team_id
       join lateral (
         select * from published_assets a where a.project_id = p.id and a.kind = 'ship_page' order by a.version desc limit 1
       ) a on true
       join project_stories s on s.id = a.source_story_id
      where p.showcase_state = 'public' and ($1::text is null or p.project_type = $1)
      order by a.published_at desc`,
    [type ?? null],
  );
  const runIds = rows.flatMap((r) => r.content.proof.map((p) => Number(p.run_id)).filter((n) => n > 0));
  const verified = runIds.length
    ? await query<{ project_id: number; n: number }>(
        `select project_id, count(*)::int as n from kane_runs
          where id = any($1::bigint[]) and status = 'passed' and source_verified group by project_id`,
        [runIds],
      )
    : [];
  const vmap = new Map(verified.map((v) => [Number(v.project_id), v.n]));
  return rows.map((r) => {
    const shot = r.content.visuals.find((v) => v.kind === "screenshot" && v.approved);
    return {
      slug: r.slug,
      name: r.content.project_name || r.name,
      pitch: r.content.one_line_pitch,
      type: r.project_type,
      teamName: r.team_name,
      cover: shot ? visualSrc(r.slug, Number(r.project_id), shot.source) : null,
      coverAlt: shot?.alt_text ?? "",
      verifiedRuns: vmap.get(Number(r.project_id)) ?? 0,
      publishedAt: r.published_at,
    };
  });
}

/**
 * May this viewer load `path` from the private Blob store for /ship/{slug}?
 * The path must belong to the project. The team and organizers can see their
 * uploads; the public only sees images that are in the published story of a
 * public/unlisted page.
 */
export async function canViewMedia(slug: string, path: string) {
  if (path.includes("..") || !/^[\w./-]+$/.test(path)) return false;
  const project = await getProjectBySlug(slug);
  if (!project || !path.startsWith(mediaPrefix(project.id))) return false;
  const viewer = await shipViewer(project.team_id);
  if (viewer.canPreview) return { cacheable: false };
  const pub = await getPublishedStory(slug);
  if (pub?.story.visuals.some((v) => v.kind === "screenshot" && v.approved && v.source === path)) return { cacheable: true };
  return false;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Inside the finalize transaction: write a new project_stories version and a
 * ship_page published_assets row pinned to it, with the consent receipt.
 */
export async function publishStoryTx(
  tx: PoolClient,
  input: { projectId: number; story: ProjectStory; memberId: number | null; credited: CreditedMember[]; state: ShowcaseState },
) {
  const { rows: sv } = await tx.query<{ id: number; version: number }>(
    `insert into project_stories (project_id, version, content, created_by, reviewed_by, reviewed_at)
     values ($1, coalesce((select max(version) from project_stories where project_id = $1), 0) + 1, $2, $3, $3, now())
     returning id, version`,
    [input.projectId, JSON.stringify(input.story), input.memberId],
  );
  const { rows: av } = await tx.query<{ id: number; version: number }>(
    `insert into published_assets (project_id, kind, version, source_story_id, state, consent_receipt, published_by)
     values ($1, 'ship_page', coalesce((select max(version) from published_assets where project_id = $1 and kind = 'ship_page'), 0) + 1, $2, $3, $4, $5)
     returning id, version`,
    [
      input.projectId,
      sv[0].id,
      input.state,
      JSON.stringify({ credited: input.credited, reviewed_at: new Date().toISOString(), basis: "finalize_confirmation" }),
      input.memberId,
    ],
  );
  return { storyId: Number(sv[0].id), storyVersion: sv[0].version, assetId: Number(av[0].id) };
}

const TeamStateInput = z.object({ state: z.enum(TEAM_SHOWCASE_STATES) });

/** Team opt-in/out: public, unlisted or off (draft). Can't override moderation. */
export async function setTeamShowcaseState(actor: Actor, projectId: number, input: unknown) {
  const { state } = parse(TeamStateInput, input);
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ showcase_state: ShowcaseState; slug: string }>("select showcase_state, slug from projects where id = $1 for update", [projectId]);
    const before = rows[0];
    if (!before) throw new AppError("NOT_FOUND");
    if (before.showcase_state === "hidden_by_moderation") {
      throw new AppError("FORBIDDEN", { userMessage: "Organizers have hidden this page. Ask at the help desk to restore it." });
    }
    await tx.query("update projects set showcase_state = $2, updated_at = now() where id = $1", [projectId, state]);
    await writeAudit(actor, { action: "showcase.set_state", resourceType: "project", resourceId: projectId, before: { state: before.showcase_state }, after: { state } }, tx);
    const { rows: t } = await tx.query<{ now: Date }>("select now()");
    return { state, receipt: { id: `project:${projectId}`, server_time: t[0].now.toISOString() } };
  });
}

const ModerateInput = z.object({ slug: zx.slug, hide: zx.checkbox, reason: zx.text(300) });

/** Organizer hide / restore. Restoring returns the page to public if it has a published story, else draft. */
export async function moderateShowcase(staff: Staff, input: unknown) {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  const { slug, hide, reason } = parse(ModerateInput, input);
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; showcase_state: ShowcaseState }>("select id, showcase_state from projects where slug = $1 for update", [slug]);
    const p = rows[0];
    if (!p) throw new AppError("NOT_FOUND");
    const { rows: pub } = await tx.query("select 1 from published_assets where project_id = $1 and kind = 'ship_page' limit 1", [p.id]);
    const next: ShowcaseState = hide ? "hidden_by_moderation" : pub.length ? "public" : "draft";
    await tx.query("update projects set showcase_state = $2, updated_at = now() where id = $1", [p.id, next]);
    await writeAudit(staffActor(staff), { action: hide ? "showcase.hide" : "showcase.restore", resourceType: "project", resourceId: p.id, reason, before: { state: p.showcase_state }, after: { state: next } }, tx);
    return next;
  });
}

const RenameInput = z.object({ slug: zx.slug, new_slug: zx.slug });

/** Organizer renames /ship/{slug}; the old slug keeps redirecting. */
export async function renameShipSlug(staff: Staff, input: unknown) {
  if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN");
  const { slug, new_slug } = parse(RenameInput, input);
  if (slug === new_slug) throw new AppError("VALIDATION_FAILED", { userMessage: "That's already the slug." });
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number }>("select id from projects where slug = $1 for update", [slug]);
    const p = rows[0];
    if (!p) throw new AppError("NOT_FOUND");
    // Another team's slug is reserved for that team's own /ship page (registerTeam/ensureProject).
    const { rows: taken } = await tx.query(
      `select 1 from projects where slug = $1 union all select 1 from project_slug_redirects where old_slug = $1 and project_id <> $2
       union all select 1 from teams where slug = $1 and id <> (select team_id from projects where id = $2)`,
      [new_slug, p.id],
    );
    if (taken.length) throw new AppError("CONFLICT", { userMessage: "That slug is taken (or reserved by a redirect)." });
    // Taking back an old slug of the same project: drop its redirect first.
    await tx.query("delete from project_slug_redirects where old_slug = $1 and project_id = $2", [new_slug, p.id]);
    await tx.query("update projects set slug = $2, updated_at = now() where id = $1", [p.id, new_slug]);
    await tx.query(
      `insert into project_slug_redirects (old_slug, project_id, created_by) values ($1, $2, $3)
       on conflict (old_slug) do update set project_id = excluded.project_id, created_by = excluded.created_by, created_at = now()`,
      [slug, p.id, staff.id],
    );
    await writeAudit(staffActor(staff), { action: "showcase.rename_slug", resourceType: "project", resourceId: p.id, before: { slug }, after: { slug: new_slug } }, tx);
    return new_slug;
  });
}
