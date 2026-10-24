import "server-only";
import { query } from "@/lib/db";
import { authenticateBearer, getMember, getStaff, hasRole, memberActor, staffActor, tokenActor, type MemberRow, type Staff } from "./auth";
import { AppError, idempotent, parse, sha256, siteUrl, stableStringify, withAudit, z, zx, type Actor, type EnvelopeAction, type Receipt, type toEnvelope } from "./core";
import { getDeckVersion } from "./deck";
import { teamByParam } from "./plan-v25";
import { listPublicEvidence, parsePublicEvidenceId, publicEvidenceId, type PublicEvidence } from "./public-evidence";
import { getProjectByTeam, type ProjectRow, type ShowcaseState } from "./showcase";
import { getLatestPublished } from "./story";
import { getSubmissionContext, isFrozen, lockState, lockedError, patchDraftTx, type DraftPatch, type SubmissionStatus } from "./submission";
import { getRoster } from "./teams";

// The team submission page (docs/api/TEAM_PAGE.md): GET/PUT /api/v1/teams/{id|slug}/page
// and the MCP tools team_page_get / team_page_update. The page is /ship/{slug}.
// Repo, commit, video and Kane runs are written to the submission draft (submission.ts).
// The deck is a reference into deck_versions. Only the one-pager, evidence ids and share
// links live in team_pages (db/038). This API never publishes or changes visibility.

export const ONE_PAGER_MAX_BYTES = 262_144;
export const SHARE_LINK_TTL_DAYS = 7;
const MAX_EVIDENCE = 50;
const MAX_RUNS = 50;
const MAX_SHARE_LINKS = 20;
const VIDEO_HOSTS = ["youtube.com", "youtu.be", "loom.com", "vimeo.com"];
const SHARE_HOSTS = ["lambdatest.com", "testmuai.com"];
const GITHUB_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/i;

/** Headers for /ship/{slug}/one-pager. Its sandbox CSP and Referrer-Policy are set in next.config.ts, which overrides route headers. */
export const ONE_PAGER_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
};

// ── Input ────────────────────────────────────────────────────────────────────

const VideoInput = z
  .object({
    public_evidence_id: z.string().trim().max(24).optional(),
    url: zx.httpsUrl.refine(onHosts(VIDEO_HOSTS), "Video links must be https on youtube.com, youtu.be, loom.com or vimeo.com").optional(),
  })
  .strict()
  .refine((v) => (v.public_evidence_id === undefined) !== (v.url === undefined), "Send either public_evidence_id or url");

const DeckInput = z
  .object({ deck_id: z.number().int().positive().optional(), version: z.number().int().positive().optional(), hosted: z.literal(true).optional() })
  .strict()
  .refine((d) => (d.version !== undefined) !== (d.hosted === true), "Send either version (a saved deck version) or hosted: true");

const RunId = z
  .union([z.number().int().positive(), z.string().trim().regex(/^(?:KR-)?\d{1,18}$/i, "Kane run ids look like KR-12")])
  .transform((v) => (typeof v === "number" ? v : Number(v.replace(/^KR-/i, ""))));

const PageInput = z
  .object({
    repo_url: zx.httpsUrl.refine((u) => GITHUB_REPO.test(u), "Must be a https://github.com/{owner}/{repo} link").nullable().optional(),
    commit_sha: zx.commitSha.nullable().optional(),
    one_pager_html: z
      .string()
      .refine((s) => Buffer.byteLength(s, "utf8") <= ONE_PAGER_MAX_BYTES, "The one-pager is limited to 256 KB")
      .nullable()
      .optional(),
    video: VideoInput.nullable().optional(),
    deck: DeckInput.nullable().optional(),
    evidence_ids: z.array(z.string().trim().max(24)).max(MAX_EVIDENCE, `Up to ${MAX_EVIDENCE} evidence objects`).nullable().optional(),
    kane_run_ids: z.array(RunId).max(MAX_RUNS, `Up to ${MAX_RUNS} Kane runs`).nullable().optional(),
    share_links: z
      .array(zx.httpsUrl.refine(onHosts(SHARE_HOSTS), "Share links must be https on lambdatest.com or testmuai.com"))
      .max(MAX_SHARE_LINKS, `Up to ${MAX_SHARE_LINKS} share links`)
      .nullable()
      .optional(),
    expected_version: z.number().int().min(0).optional(),
    idempotency_key: zx.idempotencyKey,
  })
  .strict();

// ── Callers and access ──────────────────────────────────────────────────────

/** A REST caller: a bearer token (agents), or the browser's member and staff cookies. */
export async function pageCaller(req: Request): Promise<PageCaller> {
  if (req.headers.get("authorization")) {
    const bearer = await authenticateBearer(req);
    if (!bearer) throw new AppError("UNAUTHENTICATED", { userMessage: "Missing or invalid token. Pair this machine again with `kanehack pair`." });
    return { member: bearer.member, staff: null, actor: tokenActor(bearer), source: "mcp" };
  }
  const [member, staff] = await Promise.all([getMember(), getStaff()]);
  return { member, staff, actor: null, source: "web" };
}

/** The MCP caller's own team unless another is named. */
export function mcpTeamRef(member: MemberRow, team?: string | null) {
  if (team) return team;
  if (!member.team_id) throw new AppError("FORBIDDEN", { userMessage: "Join or create a team first." });
  return String(member.team_id);
}

/** Current team members read and write. Staff read. Organizers write too (audited, also after the lock). */
async function pageAccess(teamId: number, caller: PageCaller, write: boolean): Promise<{ actor: Actor; organizer: boolean }> {
  if (caller.member && (await onRoster(teamId, caller.member.id))) return { actor: caller.actor ?? memberActor(caller.member), organizer: false };
  if (caller.staff && (!write || hasRole(caller.staff, "organizer"))) return { actor: staffActor(caller.staff), organizer: hasRole(caller.staff, "organizer") };
  if (caller.member || caller.staff) throw new AppError("FORBIDDEN", { userMessage: caller.member ? "You're not on this team." : "Only organizers can change a team's page." });
  throw new AppError("UNAUTHENTICATED");
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** GET: the page as it stands, for team members and staff. */
export async function getTeamPage(teamRef: string, caller: PageCaller): Promise<TeamPageView> {
  const team = await teamByParam(teamRef);
  await pageAccess(team.id, caller, false);
  return readTeamPage(team);
}

async function readTeamPage(team: TeamRef): Promise<TeamPageView> {
  const c = await getSubmissionContext(team.id);
  const project = c.project;
  const [row, ship, deckPub, evidence] = await Promise.all([
    pageRow(project.id),
    shipPublication(project),
    getLatestPublished(project.id, "deck"),
    listPublicEvidence(project.id).catch((): PublicEvidence[] | null => null),
  ]);
  const warnings: string[] = [];
  if (!evidence) warnings.push("Public evidence can't be resolved right now. The stored ids are unchanged.");
  const frozen = !!c.submission && isFrozen(c.submission.status);
  const d = c.draft;

  const byUrl = new Map((evidence ?? []).map((e) => [e.url, e]));
  const pe = d.video_url ? byUrl.get(d.video_url) : undefined;
  const video: PageVideo | null = !d.video_url
    ? null
    : pe && pe.kind === "video"
      ? { source: "public_evidence", public_evidence_id: pe.id, url: pe.url, kind: pe.kind, content_type: pe.content_type, sha256: pe.sha256 }
      : { source: "url", url: d.video_url };

  const byId = new Map((evidence ?? []).map((e) => [e.id, e]));
  const ids = row.evidence_ids.map((n) => publicEvidenceId(Number(n)));
  const resolved = ids.map((id) => byId.get(id)).filter((e): e is PublicEvidence => !!e);
  const unavailable = evidence ? ids.filter((id) => !byId.has(id)) : [];
  if (unavailable.length) warnings.push(`${unavailable.join(", ")} ${unavailable.length === 1 ? "is" : "are"} no longer public and won't show.`);

  const deckPublic = ship.published && (!deckPub || (deckPub.state !== "draft" && deckPub.state !== "hidden_by_moderation"));
  const deckVersion = row.deck?.version ? await getDeckVersion(project.id, row.deck.version) : null;
  const deck: PageDeck | null = row.deck
    ? {
        ...(row.deck.hosted ? { hosted: true as const } : { deck_id: project.id, version: row.deck.version!, status: deckVersion?.status ?? "missing" }),
        hosted_url: siteUrl(`/ship/${project.slug}/deck`),
        published_version: deckPub ? deckPub.version : null,
      }
    : null;
  if (row.deck?.version && !deckVersion) warnings.push(`Deck version ${row.deck.version} no longer exists.`);

  const onePagerPublic = !!row.one_pager_html && onePagerIsPublic(ship, row);
  const now = c.serverNow.getTime();
  const shareLinks = row.share_links.map((l) => ({ ...l, state: new Date(l.expires_at).getTime() > now ? ("expires" as const) : ("expired" as const) }));
  const statuses = {
    repo: !d.repo_url ? "missing" : !d.commit_sha ? "no_commit" : frozen ? "submitted" : "linked",
    one_pager: !row.one_pager_html ? "missing" : onePagerPublic ? "published" : ship.published ? "pending_publish" : "linked",
    video: !video ? "missing" : frozen ? "submitted" : "linked",
    deck: !deck ? "missing" : deckPublic ? "published" : "linked",
    evidence: resolved.length,
    published: ship.published,
  } as const;

  return {
    team_id: team.id,
    team_slug: team.slug,
    team_name: team.name,
    project_id: project.id,
    slug: project.slug,
    page_version: row.version,
    canonical_url: siteUrl(`/ship/${project.slug}`),
    visibility: project.showcase_state,
    repo_url: d.repo_url,
    commit_sha: d.commit_sha,
    video,
    deck,
    one_pager: row.one_pager_html ? { sha256: row.one_pager_sha256!, bytes: Buffer.byteLength(row.one_pager_html, "utf8"), saved_at: row.one_pager_saved_at!.toISOString(), public: onePagerPublic } : null,
    one_pager_url: row.one_pager_html ? siteUrl(`/ship/${project.slug}/one-pager`) : null,
    evidence_ids: ids,
    evidence: resolved.map((e) => ({ id: e.id, kind: e.kind, url: e.url, sha256: e.sha256, size_bytes: e.size_bytes, content_type: e.content_type, run_id: e.run_id, commit_sha: e.commit_sha })),
    unavailable_evidence_ids: unavailable,
    kane_run_ids: d.kane_run_ids,
    kane_runs: c.runs.filter((r) => d.kane_run_ids.includes(r.id)).map((r) => ({ id: r.id, ref: `KR-${r.id}`, status: r.status, source_verified: r.source_verified, commit_sha: r.commit_sha })),
    share_links: shareLinks,
    submission: c.submission ? { status: c.submission.status, receipt_code: c.submission.receipt_code, finalized_at: c.submission.finalized_at ? new Date(c.submission.finalized_at).toISOString() : null } : null,
    statuses,
    published: ship.published ? { published_at: ship.publishedAt!.toISOString() } : null,
    locked: c.locked,
    locks_at: c.locksAt.toISOString(),
    updated_at: row.updated_at ? row.updated_at.toISOString() : null,
    receipt: null,
    warnings,
  };
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * PUT: an idempotent upsert of the page. Omitted fields stay as they are and
 * null clears one. A stale expected_version is CONFLICT, a replayed
 * idempotency_key returns the original receipt, and after the lock only
 * organizers may write.
 */
export async function updateTeamPage(teamRef: string, caller: PageCaller, input: unknown): Promise<TeamPageView> {
  const team = await teamByParam(teamRef);
  const access = await pageAccess(team.id, caller, true);
  const body = parse(PageInput, input);
  const project = await getProjectByTeam(team.id);
  if (!project) throw new AppError("NOT_FOUND", { userMessage: "Your project record is missing. Ask an organizer." });

  const { result, replayed } = await idempotent(body.idempotency_key ?? null, `team_page.update:team:${team.id}`, async () => {
    const refs = await resolveRefs(project, body);
    return withAudit(access.actor, "team_page.update", "team_page", async (tx) => {
      const clock = await lockState(tx);
      if (clock.locked && !access.organizer) throw lockedError(clock);
      await tx.query("insert into team_pages (project_id) values ($1) on conflict (project_id) do nothing", [project.id]);
      const { rows } = await tx.query<PageRow>(`select ${PAGE_COLS} from team_pages where project_id = $1 for update`, [project.id]);
      const cur = rows[0];
      if (body.expected_version !== undefined && body.expected_version !== cur.version) {
        throw new AppError("CONFLICT", {
          userMessage: `The page is at version ${cur.version}, not ${body.expected_version}. Read it again, then retry with expected_version ${cur.version}.`,
          details: { current_version: cur.version, expected_version: body.expected_version },
        });
      }
      const draft = Object.keys(refs.draft).length ? await patchDraftTx(tx, project, refs.draft, caller.source) : { changed: [], before: {}, after: {} };
      const next = nextPageRow(cur, body, refs, new Date(clock.now));
      const changed = [...draft.changed.map((k) => (k === "video_url" ? "video" : k)), ...next.changed];
      const version = changed.length ? cur.version + 1 : cur.version;
      if (changed.length) {
        await tx.query(
          `update team_pages set version = $2, one_pager_html = $3, one_pager_sha256 = $4, one_pager_saved_at = $5, evidence_ids = $6, deck = $7, share_links = $8, updated_at = now()
            where project_id = $1`,
          [project.id, version, next.row.one_pager_html, next.row.one_pager_sha256, next.row.one_pager_saved_at, next.row.evidence_ids, next.row.deck ? JSON.stringify(next.row.deck) : null, JSON.stringify(next.row.share_links)],
        );
      }
      const receipt: PageReceipt = { id: `PAGE-${team.id}-v${version}`, server_time: new Date(clock.now).toISOString(), page_version: version, changed };
      return {
        result: receipt,
        resourceId: project.id,
        before: { ...draft.before, ...auditShape(cur) },
        after: { ...draft.after, ...auditShape(next.row) },
        payload: { team_id: team.id, page_version: version, changed, after_lock: clock.locked, by_organizer: access.organizer },
      };
    });
  });
  return { ...(await readTeamPage(team)), receipt: result, replayed };
}

/** Validate references against this team's own data, outside the write transaction. */
async function resolveRefs(project: ProjectRow, body: z.infer<typeof PageInput>): Promise<Refs> {
  const draft: DraftPatch = {};
  if (body.repo_url !== undefined) draft.repo_url = body.repo_url;
  if (body.commit_sha !== undefined) draft.commit_sha = body.commit_sha;
  if (body.kane_run_ids !== undefined) draft.kane_run_ids = [...new Set(body.kane_run_ids ?? [])];
  if (body.video !== undefined) draft.video_url = body.video ? await videoUrl(project.id, body.video) : null;

  let evidenceIds: number[] | undefined;
  if (body.evidence_ids !== undefined) {
    const parsed = (body.evidence_ids ?? []).map((ref) => ({ ref, id: parsePublicEvidenceId(ref) }));
    const bad = parsed.filter((p) => p.id === null).map((p) => p.ref);
    if (bad.length) throw refused("evidence_ids", `${bad.join(", ")} ${bad.length === 1 ? "isn't" : "aren't"} a public evidence id (PE-n).`, bad);
    evidenceIds = [...new Set(parsed.map((p) => p.id!))];
    const found = new Set((await listPublicEvidence(project.id, evidenceIds)).map((e) => e.id));
    const missing = evidenceIds.map(publicEvidenceId).filter((id) => !found.has(id));
    if (missing.length) throw refused("evidence_ids", `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} one of this team's public evidence objects.`, missing);
  }

  if (body.deck?.deck_id !== undefined && body.deck.deck_id !== project.id) throw refused("deck.deck_id", `This team's deck id is ${project.id}.`, [String(body.deck.deck_id)]);
  if (body.deck?.version !== undefined && !(await getDeckVersion(project.id, body.deck.version))) {
    throw refused("deck.version", `Deck version ${body.deck.version} doesn't exist. Save it with deck_update first.`, [String(body.deck.version)]);
  }
  const deck = body.deck === undefined ? undefined : body.deck ? (body.deck.hosted ? { hosted: true as const } : { deck_id: project.id, version: body.deck.version! }) : null;
  return { draft, evidenceIds, deck };
}

async function videoUrl(projectId: number, v: z.infer<typeof VideoInput>) {
  if (v.url) return v.url;
  const id = parsePublicEvidenceId(v.public_evidence_id!);
  const [pe] = id ? await listPublicEvidence(projectId, [id]) : [];
  if (!pe || pe.kind !== "video") throw refused("video.public_evidence_id", `${v.public_evidence_id} isn't one of this team's public video objects.`, [v.public_evidence_id!]);
  return pe.url;
}

/** The team_pages row after applying the body, and which API fields changed. */
function nextPageRow(cur: PageRow, body: z.infer<typeof PageInput>, refs: Refs, now: Date) {
  const row = { ...cur };
  const changed: string[] = [];
  if (body.one_pager_html !== undefined) {
    const html = body.one_pager_html?.trim() ? body.one_pager_html : null;
    const sha = html ? sha256(html) : null;
    if (sha !== cur.one_pager_sha256) {
      Object.assign(row, { one_pager_html: html, one_pager_sha256: sha, one_pager_saved_at: html ? now : null });
      changed.push("one_pager_html");
    }
  }
  if (refs.evidenceIds && stableStringify(refs.evidenceIds) !== stableStringify(cur.evidence_ids.map(Number))) {
    row.evidence_ids = refs.evidenceIds;
    changed.push("evidence_ids");
  }
  if (refs.deck !== undefined && stableStringify(refs.deck) !== stableStringify(cur.deck)) {
    row.deck = refs.deck;
    changed.push("deck");
  }
  if (body.share_links !== undefined) {
    const urls = [...new Set(body.share_links ?? [])];
    const old = new Map(cur.share_links.map((l) => [l.url, l]));
    const expires = new Date(now.getTime() + SHARE_LINK_TTL_DAYS * 86_400_000).toISOString();
    if (stableStringify(urls) !== stableStringify(cur.share_links.map((l) => l.url))) {
      row.share_links = urls.map((url) => old.get(url) ?? { url, added_at: now.toISOString(), expires_at: expires });
      changed.push("share_links");
    }
  }
  return { row, changed };
}

// ── One-pager (/ship/{slug}/one-pager) ──────────────────────────────────────

/**
 * The one-pager this viewer may load, or null. Visitors see it only on a
 * published, public or unlisted page, and only if it was saved before that
 * publish. Team members and staff always see the latest save.
 */
export async function servableOnePager(project: ProjectRow): Promise<string | null> {
  const row = await pageRow(project.id);
  if (!row.one_pager_html) return null;
  if (onePagerIsPublic(await shipPublication(project), row)) return row.one_pager_html;
  const [member, staff] = await Promise.all([getMember(), getStaff()]);
  if (staff || (member && (await onRoster(project.team_id, member.id)))) return row.one_pager_html;
  return null;
}

/** For the /ship page embed: the one-pager URL when this viewer can load it, and whether visitors can. */
export async function onePagerEmbed(project: ProjectRow, canPreview: boolean): Promise<{ src: string; public: boolean } | null> {
  const row = await pageRow(project.id);
  if (!row.one_pager_html) return null;
  const isPublic = onePagerIsPublic(await shipPublication(project), row);
  return isPublic || canPreview ? { src: `/ship/${project.slug}/one-pager`, public: isPublic } : null;
}

// ── Envelope ────────────────────────────────────────────────────────────────

/** The shared REST / MCP envelope for a page readback or write. */
export function teamPageEnvelope(v: TeamPageView): EnvelopeInput {
  const s = v.statuses;
  const actions = humanSteps(v);
  const head = !v.receipt ? `Page v${v.page_version}` : v.replayed ? `Already saved as ${v.receipt.id}` : v.receipt.changed.length ? `Saved ${v.receipt.id} (${v.receipt.changed.join(", ")})` : `No changes, still v${v.page_version}`;
  const summary = `repo ${s.repo} · one-pager ${s.one_pager} · video ${s.video} · deck ${s.deck} · evidence ${s.evidence} · ${s.published ? "published" : "not published"}`;
  return {
    status: actions.length ? "needs_action" : "ok",
    message: `${head} for ${v.team_name}: ${v.canonical_url} (${v.visibility}). ${summary}.`,
    data: v,
    actions,
    links: [
      { label: "Ship Page", url: v.canonical_url },
      ...(v.one_pager_url ? [{ label: "One-pager", url: v.one_pager_url }] : []),
      { label: "Submit tab", url: `/t/${v.team_slug}/submit` },
    ],
    warnings: v.warnings,
    uiType: "ship_preview",
    fallbackText: [`${head} · ${v.canonical_url} (${v.visibility})`, summary, ...actions.map((a) => `Needs a person: ${a.label} → ${a.href}`)].join("\n"),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_COLS = "project_id, version, one_pager_html, one_pager_sha256, one_pager_saved_at, evidence_ids, deck, share_links, updated_at";

async function pageRow(projectId: number): Promise<PageRow> {
  const [r] = await query<PageRow>(`select ${PAGE_COLS} from team_pages where project_id = $1`, [projectId]);
  return r ?? { project_id: projectId, version: 0, one_pager_html: null, one_pager_sha256: null, one_pager_saved_at: null, evidence_ids: [], deck: null, share_links: [], updated_at: null };
}

/** Is the Ship Page live for visitors: published, public or unlisted, and not hidden (story.ts getPublishedStory rule)? */
async function shipPublication(project: ProjectRow) {
  const pub = await getLatestPublished(project.id, "ship_page");
  const visible = project.showcase_state === "public" || project.showcase_state === "unlisted";
  const published = visible && !!pub && pub.state !== "draft" && pub.state !== "hidden_by_moderation";
  return { published, publishedAt: published ? new Date(pub!.publishedAt) : null };
}

/** A one-pager reaches visitors only through a human publish that came after it was saved. */
const onePagerIsPublic = (ship: { published: boolean; publishedAt: Date | null }, row: PageRow) =>
  ship.published && !!row.one_pager_saved_at && row.one_pager_saved_at.getTime() <= ship.publishedAt!.getTime();

async function onRoster(teamId: number, memberId: number) {
  return (await getRoster(teamId)).some((r) => Number(r.member_id) === Number(memberId));
}

function onHosts(hosts: string[]) {
  return (u: string) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return hosts.some((d) => h === d || h.endsWith(`.${d}`));
    } catch {
      return false;
    }
  };
}

/** What only a person in the browser can do next: finalize, and publish (this API never does either). */
function humanSteps(v: TeamPageView): EnvelopeAction[] {
  const steps: EnvelopeAction[] = [];
  if (!v.submission || !isFrozen(v.submission.status)) steps.push({ id: "finalize_in_browser", label: "Captain: finalize the submission in the browser", requires_human_confirmation: true, href: siteUrl(`/t/${v.team_slug}/submit#finalize`), tool: "submission_finalize" });
  if (!v.statuses.published || v.statuses.one_pager === "pending_publish") {
    steps.push({ id: "publish_in_browser", label: "A teammate publishes the Ship Page in the browser", requires_human_confirmation: true, href: siteUrl(`/studio/${v.team_slug}#publish`), tool: "showcase_publish" });
  }
  return steps;
}

const refused = (path: string, message: string, refusedIds: string[]) =>
  new AppError("VALIDATION_FAILED", { userMessage: message, details: { issues: [{ path, message }], refused: refusedIds } });

/** Audit keeps hashes and ids, never the one-pager itself. */
const auditShape = (r: Pick<PageRow, "one_pager_sha256" | "evidence_ids" | "deck" | "share_links">) => ({
  one_pager_sha256: r.one_pager_sha256,
  evidence_ids: r.evidence_ids.map(Number),
  deck: r.deck,
  share_links: r.share_links.map((l) => l.url),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type PageCaller = { member: MemberRow | null; staff: Staff | null; actor: Actor | null; source: "web" | "mcp" };

type TeamRef = { id: number; slug: string; name: string };

type ShareLink = { url: string; added_at: string; expires_at: string };

type PageRow = {
  project_id: number;
  version: number;
  one_pager_html: string | null;
  one_pager_sha256: string | null;
  one_pager_saved_at: Date | null;
  evidence_ids: (number | string)[];
  deck: { deck_id?: number; version?: number; hosted?: true } | null;
  share_links: ShareLink[];
  updated_at: Date | null;
};

type Refs = { draft: DraftPatch; evidenceIds?: number[]; deck?: { deck_id: number; version: number } | { hosted: true } | null };

export type PageReceipt = Receipt & { page_version: number; changed: string[] };

export type PageVideo =
  | { source: "public_evidence"; public_evidence_id: string; url: string; kind: string; content_type: string; sha256: string }
  | { source: "url"; url: string };

export type PageDeck = ({ hosted: true } | { deck_id: number; version: number; status: string }) & { hosted_url: string; published_version: number | null };

export type TeamPageView = {
  team_id: number;
  team_slug: string;
  team_name: string;
  project_id: number;
  slug: string;
  page_version: number;
  canonical_url: string;
  visibility: ShowcaseState;
  repo_url: string | null;
  commit_sha: string | null;
  video: PageVideo | null;
  deck: PageDeck | null;
  one_pager: { sha256: string; bytes: number; saved_at: string; public: boolean } | null;
  one_pager_url: string | null;
  evidence_ids: string[];
  evidence: { id: string; kind: string; url: string; sha256: string; size_bytes: number; content_type: string; run_id: number | null; commit_sha: string | null }[];
  unavailable_evidence_ids: string[];
  kane_run_ids: number[];
  kane_runs: { id: number; ref: string; status: string; source_verified: boolean; commit_sha: string | null }[];
  share_links: (ShareLink & { state: "expires" | "expired" })[];
  submission: { status: SubmissionStatus; receipt_code: string | null; finalized_at: string | null } | null;
  statuses: {
    repo: "missing" | "no_commit" | "linked" | "submitted";
    one_pager: "missing" | "linked" | "pending_publish" | "published";
    video: "missing" | "linked" | "submitted";
    deck: "missing" | "linked" | "published";
    evidence: number;
    published: boolean;
  };
  published: { published_at: string } | null;
  locked: boolean;
  locks_at: string;
  updated_at: string | null;
  receipt: PageReceipt | null;
  replayed?: boolean;
  warnings: string[];
};

type EnvelopeInput = Parameters<typeof toEnvelope>[0];
