import "server-only";
import { query } from "@/lib/db";
import { judging, prizes } from "@/data/hackday";
import { AppError, idempotent, parse, serverNow, withAudit, writeAudit, z, zx, type Receipt } from "./core";
import { staffActor, type Staff } from "./auth";

// Judging (judgingCriteria in src/data/hackday.ts). Four categories, each scored with a
// 0–5 anchor worth anchor × weight / 5 points. Scores are human decisions:
// nothing here fills a mark from AI, and a committed score is frozen (the
// judge_scores trigger refuses any later change). An organizer lock ends all
// scoring; awards can be recorded only after it.
//
// Rounds (hackday.ts `evaluations`): mid = feedback only, never scored;
// final = scored at the tables, ranks the demo queue (top 7); stage = scored
// demo round that decides the podium.
//
// Lock, demo queue and awards live in `settings` (judging:*), each change audited.

export const RUBRIC = judging.rubric;
export const RUBRIC_VERSION = judging.rubricVersion;
export const ANCHORS = judging.anchors;
export const DEMO_SLOTS = 7;

export type Round = "mid" | "final" | "stage";
export const ROUNDS: Record<Round, { label: string; scored: boolean; note: string }> = {
  mid: { label: "Mid evaluation", scored: false, note: "Feedback only. Nothing is scored." },
  final: { label: "Final evaluation", scored: true, note: "Scored at the tables. Ranks the top 7 for the stage." },
  stage: { label: "Stage demo", scored: true, note: "Scored on stage. Decides the podium." },
};
export const isRound = (s: unknown): s is Round => s === "mid" || s === "final" || s === "stage";

export const pointsFor = (anchor: number, weight: number) => Math.round(((anchor * weight) / 5) * 100) / 100;

export type CategoryScore = { anchor: number | null; points: number | null; weight: number; evidence: string | null };
export type ScoreRow = {
  id: number;
  submission_id: number;
  judge_id: number;
  round: Round;
  category_scores: Record<string, CategoryScore>;
  total: string | null;
  comments: string | null;
  uncertainty: string | null;
  frozen: boolean;
  committed_at: Date | null;
  updated_at: Date;
};

// Finalized = the official, frozen submission. The table rounds (mid 14:00,
// final 16:00) happen before the 18:00 submission lock, so judges may also
// score a team's in-progress submission record; the UI marks it NOT FINAL and
// the stage round, demo queue and awards accept finalized submissions only.
export const FINAL_STATUSES = ["finalized", "locked", "organizer_exception"];
const LIVE_STATUSES = ["draft", "preflighted", "awaiting_confirmation", ...FINAL_STATUSES];
export const isFinal = (status: string) => FINAL_STATUSES.includes(status);

// ── Settings-backed state ────────────────────────────────────────────────────

type Stamp = { at: string; by: string };
export type Award = { award: string; submission_id: number; at: string; by: string };
export type JudgingState = {
  locked: Stamp | null;
  demoQueue: { ids: number[]; at: string; by: string } | null;
  awards: Award[];
};

const KEYS = { locked: "judging:locked", queue: "judging:demo_queue", awards: "judging:awards" };

function json<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export async function getJudgingState(): Promise<JudgingState> {
  const rows = await query<{ key: string; value: string }>("select key, value from settings where key = any($1)", [Object.values(KEYS)]);
  const v = new Map(rows.map((r) => [r.key, r.value]));
  return {
    locked: json<Stamp | null>(v.get(KEYS.locked), null),
    demoQueue: json<JudgingState["demoQueue"]>(v.get(KEYS.queue), null),
    awards: json<Award[]>(v.get(KEYS.awards), []),
  };
}

/** Award names: the podium from hackday.ts plus an honourable mention. */
export const AWARD_OPTIONS = [...prizes.podium.map((p) => `${p.place} · ${p.prize}`), "Honourable mention"];

// ── Reads ────────────────────────────────────────────────────────────────────

export type QueueItem = {
  id: number;
  receipt_code: string | null;
  status: string;
  source: string;
  finalized_at: Date | null;
  team_id: number;
  team_name: string;
  team_slug: string;
  table_label: string | null;
  project_name: string;
  project_slug: string;
  project_type: string;
  showcase_state: string;
  mine: { round: Round; frozen: boolean; total: string | null }[];
};

/** Every finalized submission, with this judge's own score state per round. */
export async function listJudgeQueue(judgeId: number | null): Promise<QueueItem[]> {
  return query<QueueItem>(
    `select s.id, s.receipt_code, s.status, s.source, s.finalized_at,
            t.id as team_id, t.name as team_name, t.slug as team_slug, t.table_label,
            p.name as project_name, p.slug as project_slug, p.project_type, p.showcase_state,
            coalesce((select json_agg(json_build_object('round', js.round, 'frozen', js.frozen, 'total', js.total))
                        from judge_scores js
                       where js.submission_id = s.id and js.judge_id = $1 and js.rubric_version = $2), '[]') as mine
       from submissions s
       join teams t on t.id = s.team_id
       join projects p on p.id = s.project_id
      where s.status = any($3)
      order by (s.status = any($4)) desc, t.table_label nulls last, t.name`,
    [judgeId ?? -1, RUBRIC_VERSION, LIVE_STATUSES, FINAL_STATUSES],
  );
}

export type Inspector = {
  submission: {
    id: number;
    receipt_code: string | null;
    status: string;
    source: string;
    finalized_at: Date | null;
    received_at: Date | null;
    snapshot_sha256: string | null;
    signed: boolean;
    snapshot: Record<string, unknown>;
    incident_ref: string | null;
    exception_ref: string | null;
  };
  team: { id: number; name: string; slug: string; table_label: string | null; members: string[] };
  project: { id: number; name: string; slug: string; project_type: string; summary: string | null; repo_url: string | null; live_url: string | null; run_command: string | null; showcase_state: string };
  runs: {
    id: number;
    source: string;
    status: string;
    exit_code: number | null;
    has_terminal_event: boolean;
    commit_sha: string | null;
    objective: string | null;
    summary: Record<string, unknown>;
    finished_at: Date | null;
    received_at: Date;
    source_verified: boolean;
    verification_state: string;
    report_url: string | null;
  }[];
  evidence: { id: number; kind: string; sha256: string; content_type: string | null; size_bytes: number | null; visibility: string; source_run_id: number | null; verified_at: Date | null; redaction_state: string; uploaded_at: Date }[];
  milestones: { id: number; title: string; claim: string; confidence: string; evidence_id: number | null; source_run_id: number | null; visibility: string; approved_at: Date | null }[];
  defects: { id: number; title: string; status: string; failure_class: string; source_run_id: number | null }[];
};

/** Keys in a snapshot that never reach a judge screen. */
const PRIVATE_KEY = /email|token|secret|password|private|phone/i;

/** The proof inspector: receipt, Kane runs, judge-visible evidence and milestones for one submission. */
export async function getInspector(submissionId: number): Promise<Inspector> {
  const [s] = await query<{
    id: number;
    receipt_code: string | null;
    status: string;
    source: string;
    finalized_at: Date | null;
    received_at: Date | null;
    snapshot_sha256: string | null;
    signature: string | null;
    immutable_snapshot: Record<string, unknown> | null;
    draft: Record<string, unknown> | null;
    incident_ref: string | null;
    exception_ref: string | null;
    project_id: number;
    team_id: number;
  }>(
    `select id, receipt_code, status, source, finalized_at, received_at, snapshot_sha256, signature, immutable_snapshot, draft,
            incident_ref, exception_ref, project_id, team_id
       from submissions where id = $1 and status = any($2)`,
    [submissionId, LIVE_STATUSES],
  );
  if (!s) throw new AppError("NOT_FOUND", { userMessage: "No submission with that id." });

  const [teamRows, projectRows, runs, evidence, milestones, defects] = await Promise.all([
    query<Inspector["team"]>(
      `select t.id, t.name, t.slug, t.table_label,
              coalesce((select array_agg(coalesce(m.display_name, m.name) order by tm.joined_at)
                          from team_memberships tm join members m on m.id = tm.member_id
                         where tm.team_id = t.id and tm.left_at is null and m.deleted_at is null), '{}') as members
         from teams t where t.id = $1`,
      [s.team_id],
    ),
    query<Inspector["project"]>(
      "select id, name, slug, project_type, summary, repo_url, live_url, run_command, showcase_state from projects where id = $1",
      [s.project_id],
    ),
    query<Inspector["runs"][number]>(
      `select id, source, status, exit_code, has_terminal_event, commit_sha, objective, summary, finished_at, received_at,
              source_verified, verification_state, report_url
         from kane_runs where project_id = $1 order by coalesce(finished_at, received_at) desc limit 60`,
      [s.project_id],
    ),
    query<Inspector["evidence"][number]>(
      `select id, kind, sha256, content_type, size_bytes, visibility, source_run_id, verified_at, redaction_state, uploaded_at
         from evidence_artifacts
        where project_id = $1 and visibility in ('judges','public') and redaction_state <> 'quarantined'
        order by uploaded_at desc`,
      [s.project_id],
    ),
    query<Inspector["milestones"][number]>(
      `select id, title, claim, confidence, evidence_id, source_run_id, visibility, approved_at
         from milestones where project_id = $1 and visibility in ('judges','public') order by created_at desc`,
      [s.project_id],
    ),
    query<Inspector["defects"][number]>(
      "select id, title, status, failure_class, source_run_id from defects where project_id = $1 order by created_at desc",
      [s.project_id],
    ),
  ]);

  // Finalized: the frozen snapshot. In progress: the editable draft, shown as NOT FINAL.
  const source = isFinal(s.status) ? (s.immutable_snapshot ?? {}) : (s.draft ?? {});
  const snapshot = Object.fromEntries(Object.entries(source).filter(([k]) => !PRIVATE_KEY.test(k)));
  return {
    submission: {
      id: s.id,
      receipt_code: s.receipt_code,
      status: s.status,
      source: s.source,
      finalized_at: s.finalized_at,
      received_at: s.received_at,
      snapshot_sha256: s.snapshot_sha256,
      signed: !!s.signature,
      snapshot,
      incident_ref: s.incident_ref,
      exception_ref: s.exception_ref,
    },
    team: teamRows[0],
    project: projectRows[0],
    runs,
    evidence,
    milestones,
    defects,
  };
}

/** This judge's scores for one submission, by round. */
export async function getMyScores(submissionId: number, judgeId: number | null) {
  if (judgeId == null) return {} as Partial<Record<Round, ScoreRow>>;
  const rows = await query<ScoreRow>(
    `select id, submission_id, judge_id, round, category_scores, total, comments, uncertainty, frozen, committed_at, updated_at
       from judge_scores where submission_id = $1 and judge_id = $2 and rubric_version = $3`,
    [submissionId, judgeId, RUBRIC_VERSION],
  );
  return Object.fromEntries(rows.map((r) => [r.round, r])) as Partial<Record<Round, ScoreRow>>;
}

/** Evidence a judge may open (judges/public, not quarantined). */
export async function getJudgeEvidence(id: number) {
  const [row] = await query<{ object_key: string; content_type: string | null; kind: string; sha256: string }>(
    `select object_key, content_type, kind, sha256 from evidence_artifacts
      where id = $1 and visibility in ('judges','public') and redaction_state <> 'quarantined'`,
    [id],
  );
  return row ?? null;
}

// ── Score: save a draft, or commit (frozen forever) ─────────────────────────

const anchorField = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : Number(v)),
  z.number().int().min(0).max(5).nullable(),
);

export const scoreSchema = z.object({
  submission_id: zx.id,
  round: z.enum(["mid", "final", "stage"]),
  intent: z.enum(["save", "commit"]),
  anchors: z.record(z.string(), anchorField).default({}),
  evidence: z.record(z.string(), zx.optText(1000)).default({}),
  comments: zx.optText(4000),
  uncertainty: zx.optText(2000),
  idempotency_key: zx.idempotencyKey,
});
export type ScoreInput = z.input<typeof scoreSchema>;

/** Category scores and total from the anchors. Total is null until every category has an anchor. */
export function computeScores(anchors: Record<string, number | null>, evidence: Record<string, string | null>) {
  const categories: Record<string, CategoryScore> = {};
  let total = 0;
  let complete = true;
  for (const r of RUBRIC) {
    const anchor = anchors[r.key] ?? null;
    const points = anchor === null ? null : pointsFor(anchor, r.points);
    if (points === null) complete = false;
    else total += points;
    categories[r.key] = { anchor, points, weight: r.points, evidence: evidence[r.key] ?? null };
  }
  return { categories, total: complete ? Math.round(total * 100) / 100 : null };
}

async function rejectAudited(staff: Staff, submissionId: number, round: string, reason: string, err: AppError): Promise<never> {
  // The refused attempt is itself an audit event (adversarial list: edits after freeze).
  await writeAudit(staffActor(staff), { action: "judge.score_rejected", resourceType: "submission", resourceId: submissionId, reason, payload: { round } }).catch(() => {});
  throw err;
}

/**
 * Save or commit one judge's score for one round. Commit freezes it: the
 * judge_scores trigger refuses any later change. Refused attempts (after a
 * commit, or after the organizer lock) are audited.
 */
export async function saveJudgeScore(staff: Staff, raw: unknown): Promise<{ data: ScoreRow; receipt: Receipt }> {
  if (staff.role !== "judge" && staff.role !== "admin" && staff.role !== "organizer") throw new AppError("FORBIDDEN");
  if (staff.id == null) {
    throw new AppError("FORBIDDEN", { userMessage: "Scores need a named judge account. Sign in with your staff email and one-time code." });
  }
  const input = parse(scoreSchema, raw);
  const round = input.round;
  const scored = ROUNDS[round].scored;
  const commit = input.intent === "commit";

  const state = await getJudgingState();
  if (state.locked) {
    await rejectAudited(staff, input.submission_id, round, "judging locked", new AppError("DEADLINE_PASSED", { userMessage: "Judging is locked. Scores can no longer change." }));
  }
  const [prior] = await query<{ frozen: boolean }>(
    "select frozen from judge_scores where submission_id = $1 and judge_id = $2 and rubric_version = $3 and round = $4",
    [input.submission_id, staff.id, RUBRIC_VERSION, round],
  );
  if (prior?.frozen) {
    await rejectAudited(staff, input.submission_id, round, "score already committed", new AppError("CONFLICT", { userMessage: "You already committed this score. Committed scores can't change." }));
  }

  const { categories, total } = scored ? computeScores(input.anchors, input.evidence) : { categories: {}, total: null };

  if (commit) {
    const problems: { path: string; message: string }[] = [];
    if (scored) {
      for (const r of RUBRIC) {
        if (categories[r.key].anchor === null) problems.push({ path: `anchors.${r.key}`, message: `Pick an anchor for ${r.name}.` });
      }
      const missingEvidence = RUBRIC.filter((r) => !categories[r.key].evidence);
      if (missingEvidence.length && !input.uncertainty) {
        problems.push({
          path: "uncertainty",
          message: `Cite evidence for ${missingEvidence.map((r) => r.label).join(", ")}, or explain what you couldn't verify.`,
        });
      }
    } else if (!input.comments) {
      problems.push({ path: "comments", message: "Mid evaluation is feedback only: write the feedback before committing." });
    }
    if (problems.length) throw new AppError("VALIDATION_FAILED", { userMessage: problems[0].message, details: { issues: problems } });
  }

  const actor = staffActor(staff);
  const { result } = await idempotent(input.idempotency_key, `judge.score:${staff.id}:${input.submission_id}:${round}`, () =>
    withAudit<ScoreRow>(actor, commit ? "judge.score_commit" : "judge.score_save", "judge_score", async (tx) => {
      // Re-check the lock and the submission inside the transaction.
      const lock = await tx.query("select 1 from settings where key = $1", [KEYS.locked]);
      if (lock.rowCount) throw new AppError("DEADLINE_PASSED", { userMessage: "Judging is locked. Scores can no longer change." });
      const sub = await tx.query<{ status: string }>("select status from submissions where id = $1 and status = any($2)", [input.submission_id, LIVE_STATUSES]);
      if (!sub.rowCount) throw new AppError("NOT_FOUND", { userMessage: "No submission with that id." });
      if (round === "stage" && !isFinal(sub.rows[0].status)) {
        throw new AppError("CONFLICT", { userMessage: "The stage round scores finalized submissions only." });
      }

      const { rows } = await tx.query<ScoreRow>(
        `insert into judge_scores (submission_id, judge_id, rubric_version, round, category_scores, total, comments, uncertainty, frozen, committed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $9 then now() end)
         on conflict (submission_id, judge_id, rubric_version, round) do update
           set category_scores = excluded.category_scores, total = excluded.total, comments = excluded.comments,
               uncertainty = excluded.uncertainty, frozen = excluded.frozen, committed_at = excluded.committed_at
         returning id, submission_id, judge_id, round, category_scores, total, comments, uncertainty, frozen, committed_at, updated_at`,
        [input.submission_id, staff.id, RUBRIC_VERSION, round, JSON.stringify(categories), total, input.comments, input.uncertainty, commit],
      );
      const row = rows[0];
      return { result: row, resourceId: row.id, after: { round, total, frozen: row.frozen }, payload: { submission_id: input.submission_id, round } };
    }),
  );
  return { data: result, receipt: { id: `J-${result.id}`, server_time: new Date(result.committed_at ?? result.updated_at ?? (await serverNow())).toISOString() } };
}

// ── Organizer: lock, demo queue, awards ──────────────────────────────────────

export const LOCK_PHRASE = "LOCK SCORES";

async function writeSetting(tx: { query: (q: string, p: unknown[]) => Promise<unknown> }, key: string, value: unknown) {
  await tx.query("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
}

const by = (staff: Staff) => `${staff.name} (${staff.role})`;

export async function lockJudging(staff: Staff, raw: unknown): Promise<{ data: Stamp; receipt: Receipt }> {
  const { confirm_phrase } = parse(z.object({ confirm_phrase: z.string().trim() }), raw);
  if (confirm_phrase.toUpperCase() !== LOCK_PHRASE) throw new AppError("VALIDATION_FAILED", { userMessage: `Type ${LOCK_PHRASE} to lock judging.` });
  const now = await serverNow();
  const stamp = { at: now.toISOString(), by: by(staff) };
  await withAudit(staffActor(staff), "judging.lock", "judging", async (tx) => {
    const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from judge_scores where rubric_version = $1 and not frozen", [RUBRIC_VERSION]);
    await writeSetting(tx, KEYS.locked, stamp);
    return { result: null, resourceId: "lock", after: stamp, payload: { uncommitted_drafts: rows[0].n } };
  });
  return { data: stamp, receipt: { id: "judging.lock", server_time: stamp.at } };
}

/** Reopening never touches committed scores (they stay frozen); it only allows uncommitted rounds to be finished. */
export async function reopenJudging(staff: Staff, raw: unknown): Promise<{ data: null; receipt: Receipt }> {
  const { reason } = parse(z.object({ reason: zx.text(500) }), raw);
  const state = await getJudgingState();
  if (state.awards.length) throw new AppError("CONFLICT", { userMessage: "Awards are already recorded. Remove them before reopening judging." });
  await withAudit(staffActor(staff), "judging.reopen", "judging", async (tx) => {
    await tx.query("delete from settings where key = $1", [KEYS.locked]);
    return { result: null, resourceId: "lock", before: state.locked, reason };
  });
  return { data: null, receipt: { id: "judging.reopen", server_time: (await serverNow()).toISOString() } };
}

export async function confirmDemoQueue(staff: Staff, raw: unknown): Promise<{ data: number[]; receipt: Receipt }> {
  const { ids } = parse(z.object({ ids: z.array(zx.id).min(1).max(DEMO_SLOTS) }), raw);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION_FAILED", { userMessage: "A team appears twice in the demo queue." });
  const live = await query<{ id: number }>("select id from submissions where id = any($1) and status = any($2)", [ids, FINAL_STATUSES]);
  if (live.length !== ids.length) throw new AppError("VALIDATION_FAILED", { userMessage: "Every queued team needs a finalized submission." });
  const now = await serverNow();
  const value = { ids, at: now.toISOString(), by: by(staff) };
  await withAudit(staffActor(staff), "judging.demo_queue", "judging", async (tx) => {
    await writeSetting(tx, KEYS.queue, value);
    return { result: null, resourceId: "demo_queue", after: value };
  });
  return { data: ids, receipt: { id: "judging.demo_queue", server_time: value.at } };
}

export async function setAward(staff: Staff, raw: unknown): Promise<{ data: Award[]; receipt: Receipt }> {
  const input = parse(z.object({ award: z.enum(AWARD_OPTIONS as [string, ...string[]]), submission_id: zx.id }), raw);
  {
    const state = await getJudgingState();
    if (!state.locked) throw new AppError("CONFLICT", { userMessage: "Lock judging before recording awards." });
    const live = await query("select 1 from submissions where id = $1 and status = any($2)", [input.submission_id, FINAL_STATUSES]);
    if (!live.length) throw new AppError("NOT_FOUND", { userMessage: "No finalized submission with that id." });
    const now = await serverNow();
    const isPodium = input.award !== "Honourable mention";
    // A podium place goes to one team; one team holds at most one podium place.
    const kept = state.awards.filter((a) => (isPodium ? a.award !== input.award && !(a.submission_id === input.submission_id && a.award !== "Honourable mention") : !(a.award === input.award && a.submission_id === input.submission_id)));
    const awards = [...kept, { award: input.award, submission_id: input.submission_id, at: now.toISOString(), by: by(staff) }];
    await withAudit(staffActor(staff), "judging.award", "judging", async (tx) => {
      await writeSetting(tx, KEYS.awards, awards);
      return { result: null, resourceId: input.submission_id, before: state.awards, after: awards, payload: { award: input.award } };
    });
    return { data: awards, receipt: { id: "judging.award", server_time: now.toISOString() } };
  }
}

export async function removeAward(staff: Staff, raw: unknown): Promise<{ data: Award[]; receipt: Receipt }> {
  const input = parse(z.object({ award: z.string().max(100), submission_id: zx.id }), raw);
  const state = await getJudgingState();
  const awards = state.awards.filter((a) => !(a.award === input.award && a.submission_id === input.submission_id));
  await withAudit(staffActor(staff), "judging.award_remove", "judging", async (tx) => {
    await writeSetting(tx, KEYS.awards, awards);
    return { result: null, resourceId: input.submission_id, before: state.awards, after: awards, payload: { award: input.award } };
  });
  return { data: awards, receipt: { id: "judging.award_remove", server_time: (await serverNow()).toISOString() } };
}

// ── Aggregate (organizer) ────────────────────────────────────────────────────

export type ScoreLine = {
  submission_id: number;
  judge_id: number;
  judge_name: string;
  round: Round;
  category_scores: Record<string, CategoryScore>;
  total: string | null;
  comments: string | null;
  uncertainty: string | null;
  frozen: boolean;
  committed_at: Date | null;
};

export type AggregateRow = {
  submission_id: number;
  receipt_code: string | null;
  status: string;
  team_name: string;
  team_slug: string;
  project_name: string;
  project_slug: string;
  project_type: string;
  final: { judges: number; mean: number | null; categories: Record<string, number | null> };
  stage: { judges: number; mean: number | null };
  midFeedback: number;
  drafts: number;
  rank: number | null;
};

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** Every score line (committed and drafts) for the CSV export and the aggregate. */
export async function listScoreLines(): Promise<ScoreLine[]> {
  return query<ScoreLine>(
    `select js.submission_id, js.judge_id, sa.name as judge_name, js.round, js.category_scores, js.total, js.comments, js.uncertainty, js.frozen, js.committed_at
       from judge_scores js join staff_accounts sa on sa.id = js.judge_id
      where js.rubric_version = $1
      order by js.submission_id, js.round, sa.name`,
    [RUBRIC_VERSION],
  );
}

/**
 * Per submission: mean committed final score (and per category), mean
 * committed stage score, counts. Only committed (frozen) scores count; drafts
 * are reported but never ranked. Ties break on validation evidence, then harness.
 */
export async function getAggregate(): Promise<{ rows: AggregateRow[]; lines: ScoreLine[] }> {
  const [subs, lines] = await Promise.all([
    query<Omit<AggregateRow, "final" | "stage" | "midFeedback" | "drafts" | "rank">>(
      `select s.id as submission_id, s.receipt_code, s.status, t.name as team_name, t.slug as team_slug,
              p.name as project_name, p.slug as project_slug, p.project_type
         from submissions s join teams t on t.id = s.team_id join projects p on p.id = s.project_id
        where s.status = any($1)`,
      [LIVE_STATUSES],
    ),
    listScoreLines(),
  ]);
  const bySub = new Map<number, ScoreLine[]>();
  for (const l of lines) bySub.set(l.submission_id, [...(bySub.get(l.submission_id) ?? []), l]);

  const rows: AggregateRow[] = subs.map((s) => {
    const ls = bySub.get(s.submission_id) ?? [];
    const final = ls.filter((l) => l.round === "final" && l.frozen && l.total !== null);
    const stage = ls.filter((l) => l.round === "stage" && l.frozen && l.total !== null);
    const categories = Object.fromEntries(
      RUBRIC.map((r) => [r.key, mean(final.map((l) => l.category_scores[r.key]?.points).filter((p): p is number => typeof p === "number"))]),
    );
    return {
      ...s,
      final: { judges: final.length, mean: mean(final.map((l) => Number(l.total))), categories },
      stage: { judges: stage.length, mean: mean(stage.map((l) => Number(l.total))) },
      midFeedback: ls.filter((l) => l.round === "mid" && l.frozen).length,
      drafts: ls.filter((l) => !l.frozen).length,
      rank: null,
    };
  });

  const ranked = rows
    .filter((r) => r.final.mean !== null)
    .sort(
      (a, b) =>
        b.final.mean! - a.final.mean! ||
        // Ties: Kane usage first, then completion (the two the room can't fake).
        (b.final.categories.kane_usage ?? 0) - (a.final.categories.kane_usage ?? 0) ||
        (b.final.categories.completion ?? 0) - (a.final.categories.completion ?? 0) ||
        a.team_name.localeCompare(b.team_name),
    );
  ranked.forEach((r, i) => (r.rank = i + 1));
  rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.team_name.localeCompare(b.team_name));
  return { rows, lines };
}

/** The demo queue: the organizer-confirmed list if there is one, else the current top 7 as a suggestion. */
export async function getDemoQueue() {
  const [state, { rows }] = await Promise.all([getJudgingState(), getAggregate()]);
  const byId = new Map(rows.map((r) => [r.submission_id, r]));
  const suggested = rows.filter((r) => r.rank !== null && isFinal(r.status)).slice(0, DEMO_SLOTS);
  if (state.demoQueue) {
    return { confirmed: true as const, at: state.demoQueue.at, by: state.demoQueue.by, items: state.demoQueue.ids.map((id) => byId.get(id)).filter((r): r is AggregateRow => !!r), suggested };
  }
  return { confirmed: false as const, at: null, by: null, items: suggested, suggested };
}
