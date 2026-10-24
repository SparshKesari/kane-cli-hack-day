import "server-only";
import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { requireFlag } from "@/lib/flags";
import {
  AppError,
  idempotent,
  parse,
  sha256,
  withAudit,
  z,
  zx,
  type Actor,
  type Receipt,
} from "./core";
import {
  authenticateBearer,
  getMember,
  getStaff,
  hasRole,
  memberActor,
  staffActor,
  tokenActor,
  type BearerAuth,
  type MemberRow,
  type Staff,
} from "./auth";
import { EVIDENCE_KINDS, MAX_DIRECT_BYTES, MAX_SIGNED_BYTES, evidenceKindFor, inspectEvidence, type EvidenceKind } from "./kane-evidence";
import {
  decideStatus,
  defectSignature,
  findCredentialLike,
  parseKaneStream,
  stripLocalPaths,
  subjectKey,
  type ParsedMember,
  type ParsedStream,
  type RunStatus,
} from "./kane-ndjson";

// Kane runs, evidence, defects and milestones (E7). Called by the Proof tab's
// server actions, /api/v1/kane/*, /api/v1/projects/{id}/{milestones,defects},
// the GitHub webhook and the MCP tools, so every rule lives here:
//
//   - success comes from the exit code; a missing completion event is never a pass
//   - a run is source_verified only from a paired token, tied to the caller's
//     project, with a completion event and an exit code (trust gate, G5)
//   - a failing run opens a SUSPECTED defect; only a teammate confirms it, and
//     only a later passing run on a different commit re-verifies it
//   - credential-looking fields are refused; local paths are stripped
//   - evidence is private Blob, sha256-deduped per project, quarantined on
//     anything suspicious

// ── Who is calling ───────────────────────────────────────────────────────────

export type KaneCaller =
  | { kind: "bearer"; auth: BearerAuth }
  | { kind: "member"; member: MemberRow }
  | { kind: "staff"; staff: Staff };

/** Bearer token (CLI / MCP) first, then the member cookie, then staff. */
export async function resolveCaller(req: Request): Promise<KaneCaller> {
  if (req.headers.get("authorization")) {
    const auth = await authenticateBearer(req);
    if (!auth) throw new AppError("UNAUTHENTICATED", { userMessage: "Missing or invalid token. Pair this machine again with `kanehack pair`." });
    return { kind: "bearer", auth };
  }
  const member = await getMember();
  if (member) return { kind: "member", member };
  const staff = await getStaff();
  if (staff) return { kind: "staff", staff };
  throw new AppError("UNAUTHENTICATED");
}

export const callerMember = (c: KaneCaller): MemberRow | null => (c.kind === "bearer" ? c.auth.member : c.kind === "member" ? c.member : null);

export function callerActor(c: KaneCaller): Actor {
  if (c.kind === "bearer") return tokenActor(c.auth);
  if (c.kind === "member") return memberActor(c.member);
  return staffActor(c.staff);
}

export type ProjectRef = { id: number; team_id: number; slug: string; name: string; team_slug: string; team_name: string; repo_url: string | null; showcase_state: string };

const PROJECT_COLS = `p.id, p.team_id, p.slug, p.name, p.repo_url, p.showcase_state, t.slug as team_slug, t.name as team_name`;

export async function getProjectByTeam(teamId: number) {
  const [p] = await query<ProjectRef>(`select ${PROJECT_COLS} from projects p join teams t on t.id = p.team_id where p.team_id = $1`, [teamId]);
  return p ?? null;
}

async function getProjectById(id: number) {
  const [p] = await query<ProjectRef>(`select ${PROJECT_COLS} from projects p join teams t on t.id = p.team_id where p.id = $1`, [id]);
  return p ?? null;
}

/**
 * The project a caller may act on. Members and tokens: only their own team's
 * project (passing someone else's id is FORBIDDEN, never silently remapped).
 * Staff: read-only, any project, and only when `read` is set.
 */
export async function projectFor(c: KaneCaller, projectId?: number | null, opts: { read?: boolean } = {}): Promise<ProjectRef> {
  const m = callerMember(c);
  if (m) {
    if (!m.team_id) throw new AppError("FORBIDDEN", { userMessage: "Join or create a team first; Kane runs belong to a team project." });
    const p = await getProjectByTeam(m.team_id);
    if (!p) throw new AppError("NOT_FOUND", { userMessage: "Your team has no project yet." });
    if (projectId && projectId !== p.id) throw new AppError("FORBIDDEN", { userMessage: "That project belongs to another team." });
    return p;
  }
  if (c.kind === "staff" && opts.read && hasRole(c.staff, "judge", "organizer", "mentor")) {
    if (!projectId) throw new AppError("VALIDATION_FAILED", { userMessage: "project_id is required." });
    const p = await getProjectById(projectId);
    if (!p) throw new AppError("NOT_FOUND");
    return p;
  }
  throw new AppError("FORBIDDEN");
}

// ── Run ingest (T-KANE-02, T-KANE-05, T-KANE-06) ─────────────────────────────

const FORBIDDEN_KEYS = /^(transcript|messages|chat|prompt|conversation|source_code|diff|env|environment|headers)$/i;

const memberSchema = z.object({
  upstream_member_id: zx.text(120),
  name: zx.text(200),
  status: z.enum(["passed", "failed", "blocked", "skipped", "errored"]),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  failure: z.string().max(400).nullable().optional(),
});

const summarySchema = z
  .object({
    family: z.enum(["run", "testmd", "testrun", "assurance", "unknown"]).default("unknown"),
    terminal: z.object({ type: z.enum(["run_end", "test_md_done", "testrun_done", "remote_done", "done"]), status: z.string().max(40).nullable() }).nullable().default(null),
    execution_id: z.string().max(120).nullable().optional(),
    summary: z.record(z.string(), z.unknown()).default({}),
    members: z.array(memberSchema).max(500).default([]),
    coverage: z.object({ designed: z.number().nullable(), proven: z.number().nullable(), total: z.number().nullable() }).nullable().default(null),
  })
  .strip();

export const recordRunSchema = z.object({
  project_id: zx.id.optional(),
  source_execution_id: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:@/-]+$/, "Letters, digits and . _ : @ / - only"),
  batch_execution_id: z.string().trim().max(120).optional(),
  /** Process exit code. Required for a pass; omitted = the run is still going. */
  exit_code: z.number().int().min(-1).max(255).nullable().optional(),
  command: z.enum(["run", "testmd", "testrun", "cover", "other"]).optional(),
  objective: z.string().trim().max(500).optional(),
  commit_sha: zx.commitSha.optional(),
  /** Raw `--agent` stdout; the server parses it. Max 2 MB. */
  ndjson: z.string().max(2_000_000).optional(),
  /** Or the CLI's parsed summary (packages/kanehack does this). */
  run_summary: summarySchema.optional(),
  evidence_sha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
  finished_at: z.string().datetime({ offset: true }).optional(),
  report_url: zx.httpsUrl.optional(),
});
export type RecordRunInput = z.infer<typeof recordRunSchema>;

export type RunReceipt = Receipt & {
  run_id: number;
  status: RunStatus;
  verification_state: "reported" | "verified" | "manual_unverified";
  source_verified: boolean;
  has_terminal_event: boolean;
  defects_opened: number;
  defects_reverified: number;
  warnings: string[];
  url: string;
};

/** Refuse credentials and transcripts before anything is parsed or stored. */
export function guardRunInput(raw: unknown) {
  const hits = findCredentialLike(raw);
  if (hits.length) {
    throw new AppError("VALIDATION_FAILED", {
      userMessage: "That run report contains something that looks like a credential. Remove it and report again; Kane run reports never need secrets.",
      details: { fields: hits.slice(0, 10) },
    });
  }
  if (raw && typeof raw === "object") {
    const bad = Object.keys(raw).filter((k) => FORBIDDEN_KEYS.test(k));
    if (bad.length) throw new AppError("VALIDATION_FAILED", { userMessage: "Transcripts, prompts, source and environment dumps are not accepted.", details: { fields: bad } });
  }
}

function toParsed(input: RecordRunInput): ParsedStream {
  if (input.ndjson) return parseKaneStream(input.ndjson);
  const s = input.run_summary;
  const empty = parseKaneStream("");
  if (!s) return empty;
  const sum = s.summary as Record<string, unknown>;
  const pickStr = (k: string, max = 280) => (typeof sum[k] === "string" ? String(sum[k]).slice(0, max) : null);
  const pickNum = (k: string) => (typeof sum[k] === "number" && Number.isFinite(sum[k]) ? (sum[k] as number) : null);
  return {
    ...empty,
    family: s.family,
    terminal: s.terminal,
    execution_id: s.execution_id ?? null,
    summary: {
      ...empty.summary,
      status: pickStr("status", 40),
      one_liner: pickStr("one_liner"),
      reason: pickStr("reason"),
      duration_s: pickNum("duration_s"),
      credits: pickNum("credits"),
      totals: sum.totals && typeof sum.totals === "object" ? (sum.totals as Record<string, number>) : null,
      test_url: pickStr("test_url", 500),
      share_url: pickStr("share_url", 500),
      result_code: pickStr("result_code", 20),
    },
    members: s.members.map(
      (m): ParsedMember => ({ upstream_member_id: m.upstream_member_id, name: m.name, status: m.status, duration_ms: m.duration_ms ?? null, failure: m.failure ?? null, subject_key: subjectKey("test", m.name) }),
    ),
    coverage: s.coverage,
  };
}

const SOURCE_BY_CALLER = { bearer: "kanehack_cli", member: "manual", staff: "manual" } as const;

/**
 * Record a Kane run reported by the CLI or an MCP tool. Idempotent on
 * (source, execution id): the same report twice returns the first receipt;
 * a "running" report can later be completed once.
 */
export async function recordRun(c: KaneCaller, raw: unknown, opts: { via?: "kanehack_cli" | "mcp"; idempotencyKey?: string | null; requestId?: string } = {}): Promise<{ receipt: RunReceipt; replayed: boolean }> {
  await requireFlag("kane_ingest");
  guardRunInput(raw);
  const input = parse(recordRunSchema, raw);
  if (c.kind === "staff") throw new AppError("FORBIDDEN", { userMessage: "Staff can't report runs for a team." });
  const project = await projectFor(c, input.project_id);
  const member = callerMember(c)!;
  const source = c.kind === "bearer" ? (opts.via ?? "kanehack_cli") : SOURCE_BY_CALLER[c.kind];

  // Rate limit: 30 reports a minute per team is far above any honest loop.
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from kane_runs where team_id = $1 and received_at > now() - interval '1 minute'", [project.team_id]);
  if (n >= 30) throw new AppError("RATE_LIMITED");

  const run = () => ingest(c, member, project, source, input, opts.requestId);
  const { result, replayed } = await idempotent(opts.idempotencyKey ?? null, `kane.run:team:${project.team_id}`, run);
  return { receipt: result, replayed: replayed || result.warnings.includes("duplicate") };
}

async function ingest(c: KaneCaller, member: MemberRow, project: ProjectRef, source: string, input: RecordRunInput, requestId?: string): Promise<RunReceipt> {
  const parsed = toParsed(input);
  const hasTerminal = !!parsed.terminal;
  const exitCode = input.exit_code ?? null;
  const decided = decideStatus(exitCode, hasTerminal);
  const warnings: string[] = decided.warning ? [decided.warning] : [];
  if (parsed.invalid_lines > 0) warnings.push(`${parsed.invalid_lines} NDJSON line(s) could not be read.`);

  // The stream and the exit code disagree: believe the exit code, but don't trust the run.
  const terminalStatus = parsed.terminal?.status ?? null;
  const mismatch =
    hasTerminal && exitCode !== null && ((exitCode === 0 && terminalStatus !== null && terminalStatus !== "passed") || (exitCode === 1 && terminalStatus === "passed"));
  if (mismatch) warnings.push(`Exit code ${exitCode} disagrees with the completion event (${terminalStatus}).`);

  // Trust gate (T-KANE-05).
  const trust: string[] = [];
  const paired = c.kind === "bearer";
  trust.push(paired ? "Reported from a paired token" : "Not reported from a paired token");
  trust.push(hasTerminal ? `Completion event: ${parsed.terminal!.type}` : "No completion event");
  trust.push(exitCode !== null ? `Exit code ${exitCode}` : "No exit code");
  if (mismatch) trust.push("Exit code and completion event disagree");
  trust.push(`Tied to project ${project.slug}`);
  const sourceVerified = paired && hasTerminal && exitCode !== null && !mismatch;

  const objective = input.objective ?? parsed.summary.one_liner ?? null;
  const subjects = new Set<string>();
  if (parsed.family === "testrun") parsed.members.forEach((m) => subjects.add(m.subject_key));
  else if (objective) subjects.add(subjectKey(parsed.family === "testmd" || input.command === "testmd" ? "test" : "run", objective));

  const summary = stripLocalPaths({
    family: parsed.family,
    terminal: parsed.terminal,
    ...parsed.summary,
    coverage: parsed.coverage,
    member_count: parsed.members.length,
    lines: parsed.lines || undefined,
  });

  const actor = callerActor(c);
  return withAudit<RunReceipt>(
    actor,
    "kane.run.record",
    "kane_run",
    async (tx) => {
      // Dedupe on (source, upstream id).
      const { rows: existing } = await tx.query<{ id: number; project_id: number; status: RunStatus; verification_state: RunReceipt["verification_state"]; source_verified: boolean; has_terminal_event: boolean; received_at: Date }>(
        "select id, project_id, status, verification_state, source_verified, has_terminal_event, received_at from kane_runs where source = $1 and upstream_execution_id = $2 for update",
        [source, input.source_execution_id],
      );
      const prior = existing[0];
      if (prior && prior.project_id !== project.id) throw new AppError("CONFLICT", { userMessage: "That execution id was already reported by another team." });
      if (prior && !(prior.status === "running" && decided.status !== "running")) {
        return {
          result: receiptOf(prior.id, prior.status, prior.verification_state, prior.source_verified, prior.has_terminal_event, 0, 0, ["duplicate", "This run was already recorded; returning the original receipt."], prior.received_at),
          resourceId: prior.id,
          reason: "duplicate",
        };
      }

      const evidence = input.evidence_sha256
        ? (await tx.query<{ id: number }>("select id from evidence_artifacts where project_id = $1 and sha256 = $2", [project.id, input.evidence_sha256])).rows[0]
        : undefined;

      const values = [
        project.id,
        project.team_id,
        member.id,
        c.kind === "bearer" ? c.auth.tokenId : null,
        source,
        input.source_execution_id,
        input.batch_execution_id ?? (parsed.family === "testrun" ? parsed.execution_id : null),
        decided.status,
        exitCode,
        hasTerminal,
        input.commit_sha ?? null,
        objective,
        JSON.stringify(summary),
        input.started_at ?? null,
        input.finished_at ?? (decided.status === "running" ? null : new Date().toISOString()),
        input.evidence_sha256 ?? null,
        evidence?.id ?? null,
        sourceVerified,
        sourceVerified ? "verified" : "reported",
        input.report_url ?? httpsOnly(parsed.summary.test_url) ?? httpsOnly(parsed.summary.share_url),
        JSON.stringify({ command: input.command ?? null, via: source }),
        [...subjects],
        trust,
      ];
      let runId: number;
      let receivedAt: Date;
      if (prior) {
        const { rows } = await tx.query<{ id: number; received_at: Date }>(
          `update kane_runs set status = $8, exit_code = $9, has_terminal_event = $10, commit_sha = coalesce($11, commit_sha), objective = coalesce($12, objective),
                  summary = $13, started_at = coalesce($14, started_at), finished_at = $15, evidence_hash = coalesce($16, evidence_hash),
                  evidence_artifact_id = coalesce($17, evidence_artifact_id), source_verified = $18, verification_state = $19, report_url = coalesce($20, report_url),
                  raw_metadata = $21, subject_keys = $22, trust_reasons = $23
            where id = $24 and project_id = $1 and team_id = $2 and member_id = $3 and token_id is not distinct from $4 and source = $5 and upstream_execution_id = $6
                  and batch_execution_id is not distinct from coalesce($7, batch_execution_id)
            returning id, received_at`,
          [...values, prior.id],
        );
        if (!rows[0]) throw new AppError("CONFLICT", { userMessage: "Only the original reporter can complete a running run." });
        runId = rows[0].id;
        receivedAt = rows[0].received_at;
      } else {
        const { rows } = await tx.query<{ id: number; received_at: Date }>(
          `insert into kane_runs (project_id, team_id, member_id, token_id, source, upstream_execution_id, batch_execution_id, status, exit_code, has_terminal_event,
                                  commit_sha, objective, summary, started_at, finished_at, evidence_hash, evidence_artifact_id, source_verified, verification_state,
                                  report_url, raw_metadata, subject_keys, trust_reasons)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
           returning id, received_at`,
          values,
        );
        runId = rows[0].id;
        receivedAt = rows[0].received_at;
      }

      for (const m of parsed.members) {
        await tx.query(
          `insert into kane_test_members (run_id, upstream_member_id, name, test_definition_hash, status, duration_ms)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (run_id, upstream_member_id) do update set status = excluded.status, duration_ms = excluded.duration_ms`,
          [runId, m.upstream_member_id, m.name, m.subject_key, m.status, m.duration_ms],
        );
      }
      if (evidence) {
        await tx.query("update evidence_artifacts set source_run_id = coalesce(source_run_id, $2), verified_at = case when $3 then coalesce(verified_at, now()) else verified_at end where id = $1", [
          evidence.id,
          runId,
          sourceVerified,
        ]);
      }

      const { opened, reverified } = await applyDefects(tx, project.id, runId, decided.status, input.commit_sha ?? null, objective, parsed);

      await tx.query(
        `insert into activity (team_id, member_id, action, source, source_event_id, type, visibility, payload, signature_status)
         values ($1, $2, $3, 'kane', $4, 'kane.run', 'team', $5, $6)
         on conflict do nothing`,
        [
          project.team_id,
          member.id,
          `Kane run ${decided.status}${sourceVerified ? " (verified)" : ""}`,
          `kane_run:${runId}:${decided.status}`,
          JSON.stringify({ run_id: runId, status: decided.status, source_verified: sourceVerified, family: parsed.family }),
          sourceVerified ? "verified" : "unverified",
        ],
      );
      await tx.query("update integration_state set status = 'ok', last_success_at = now(), updated_at = now() where system = 'kane_ingest'").catch(() => {});

      const receipt = receiptOf(runId, decided.status, sourceVerified ? "verified" : "reported", sourceVerified, hasTerminal, opened, reverified, warnings, receivedAt, project.team_slug);
      return { result: receipt, resourceId: runId, after: { status: decided.status, source_verified: sourceVerified, exit_code: exitCode }, payload: { source, project_id: project.id } };
    },
    { requestId },
  );
}

/** Links parsed out of NDJSON are participant data: keep https only. */
function httpsOnly(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).protocol === "https:" ? u.slice(0, 500) : null;
  } catch {
    return null;
  }
}

function receiptOf(
  id: number,
  status: RunStatus,
  state: RunReceipt["verification_state"],
  verified: boolean,
  terminal: boolean,
  opened: number,
  reverified: number,
  warnings: string[],
  at: Date,
  teamSlug?: string,
): RunReceipt {
  return {
    id: `KR-${id}`,
    run_id: id,
    status,
    verification_state: state,
    source_verified: verified,
    has_terminal_event: terminal,
    defects_opened: opened,
    defects_reverified: reverified,
    warnings,
    server_time: new Date(at).toISOString(),
    url: teamSlug ? `/t/${teamSlug}/proof#run-${id}` : `/api/v1/kane/runs/${id}`,
  };
}

/**
 * Failures open SUSPECTED defects (never confirmed by a machine). Passes on a
 * different commit re-verify confirmed/fixed defects with the same subject.
 * Blocked / errored / cancelled runs never touch defects (infra/auth).
 */
async function applyDefects(tx: PoolClient, projectId: number, runId: number, status: RunStatus, sha: string | null, objective: string | null, parsed: ParsedStream) {
  let opened = 0;
  let reverified = 0;
  if (status !== "passed" && status !== "failed") return { opened, reverified };

  // What failed / passed in this run, per subject.
  const outcomes: { subject: string; passed: boolean; title: string; failure: string | null }[] = [];
  if (parsed.family === "testrun" && parsed.members.length) {
    for (const m of parsed.members) {
      if (m.status === "passed" || m.status === "failed") outcomes.push({ subject: m.subject_key, passed: m.status === "passed", title: m.name, failure: m.failure });
    }
  } else if (objective) {
    const kind = parsed.family === "testmd" ? "test" : "run";
    outcomes.push({ subject: subjectKey(kind, objective), passed: status === "passed", title: objective.slice(0, 200), failure: parsed.summary.reason ?? parsed.summary.one_liner });
  }

  for (const o of outcomes) {
    if (!o.passed) {
      const sig = defectSignature(o.subject, o.failure);
      const { rows } = await tx.query<{ id: number; status: string; inserted: boolean }>(
        `insert into defects (project_id, signature, subject_key, title, detail, source_run_id, status, failure_class)
         values ($1, $2, $3, $4, $5, $6, 'suspected', 'product')
         on conflict (project_id, signature) do update set updated_at = now()
         returning id, status, (xmax = 0) as inserted`,
        [projectId, sig, o.subject, o.title, o.failure?.slice(0, 400) ?? null, runId],
      );
      const d = rows[0];
      if (d.inserted) opened++;
      else {
        await tx.query("insert into defect_verifications (defect_id, run_id, commit_sha, result) values ($1, $2, $3, 'reproduced') on conflict do nothing", [d.id, runId, sha]);
        // A regression of something a human confirmed before goes back to confirmed.
        if (d.status === "fixed" || d.status === "reverified") await tx.query("update defects set status = 'confirmed', updated_at = now() where id = $1", [d.id]);
      }
      continue;
    }
    // A pass: re-verify confirmed / fixed defects about the same subject, on a different commit only.
    const { rows: open } = await tx.query<{ id: number; status: string; origin_sha: string | null }>(
      `select d.id, d.status, r.commit_sha as origin_sha
         from defects d left join kane_runs r on r.id = d.source_run_id
        where d.project_id = $1 and d.subject_key = $2 and d.status in ('suspected','confirmed','fixed')`,
      [projectId, o.subject],
    );
    for (const d of open) {
      const differentSha = !!sha && !!d.origin_sha && sha !== d.origin_sha;
      const canReverify = differentSha && (d.status === "confirmed" || d.status === "fixed");
      await tx.query("insert into defect_verifications (defect_id, run_id, commit_sha, result) values ($1, $2, $3, $4) on conflict do nothing", [
        d.id,
        runId,
        sha,
        canReverify ? "passed" : "inconclusive",
      ]);
      if (canReverify) {
        await tx.query("update defects set status = 'reverified', updated_at = now() where id = $1", [d.id]);
        reverified++;
      }
    }
  }
  return { opened, reverified };
}

// ── Manual proof entry (T-KANE-01, the fallback) ─────────────────────────────

export const manualRunSchema = z.object({
  report_url: zx.httpsUrl,
  run_id: z.string().trim().max(120).optional().transform((s) => (s ? s : null)),
  exit_code: z.coerce.number().int().min(0).max(255),
  commit_sha: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((s) => (s ? s : null))
    .pipe(z.string().regex(/^[0-9a-f]{40}$/, "Must be the full 40-character commit SHA").nullable()),
  objective: zx.optText(500),
  idempotency_key: zx.idempotencyKey,
});

/**
 * A participant pastes a run they did by hand. Stored as manual_unverified:
 * shown as UNVERIFIED, never counted, never opens or clears defects.
 */
export async function recordManualRun(member: MemberRow, raw: unknown): Promise<Receipt & { run_id: number }> {
  guardRunInput(raw);
  const input = parse(manualRunSchema, raw);
  const project = await projectFor({ kind: "member", member });
  const exit = input.exit_code;
  const status: RunStatus = exit === 0 ? "passed" : exit === 1 ? "failed" : exit === 3 ? "cancelled" : "blocked";
  const upstream = input.run_id ? `manual:${input.run_id}` : `manual:${randomUUID()}`;
  const { result } = await idempotent(input.idempotency_key ?? null, `kane.manual:member:${member.id}`, () =>
    withAudit(memberActor(member), "kane.run.manual", "kane_run", async (tx) => {
      const { rows } = await tx.query<{ id: number; received_at: Date }>(
        `insert into kane_runs (project_id, team_id, member_id, source, upstream_execution_id, status, exit_code, has_terminal_event, commit_sha, objective,
                                summary, source_verified, verification_state, report_url, trust_reasons, finished_at)
         values ($1, $2, $3, 'manual', $4, $5, $6, false, $7, $8, '{}'::jsonb, false, 'manual_unverified', $9,
                 array['Entered by hand in the hub', 'No completion event', 'Not counted toward any total'], now())
         on conflict (source, upstream_execution_id) do nothing
         returning id, received_at`,
        [project.id, project.team_id, member.id, upstream, status, exit, input.commit_sha, input.objective, input.report_url],
      );
      if (!rows[0]) throw new AppError("CONFLICT", { userMessage: "That run id was already entered." });
      await tx.query(
        `insert into activity (team_id, member_id, action, source, source_event_id, type, visibility, payload, signature_status)
         values ($1, $2, 'Logged a Kane run by hand (unverified)', 'web', $3, 'kane.run.manual', 'team', $4, 'not_applicable')`,
        [project.team_id, member.id, `kane_run:${rows[0].id}:manual`, JSON.stringify({ run_id: rows[0].id })],
      );
      return { result: { id: `KR-${rows[0].id}`, run_id: rows[0].id, server_time: new Date(rows[0].received_at).toISOString() }, resourceId: rows[0].id, after: { status, exit } };
    }),
  );
  return result;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type RunRow = {
  id: number;
  project_id: number;
  team_id: number;
  member_name: string | null;
  source: string;
  upstream_execution_id: string;
  status: RunStatus;
  exit_code: number | null;
  has_terminal_event: boolean;
  commit_sha: string | null;
  objective: string | null;
  summary: Record<string, unknown>;
  started_at: Date | null;
  finished_at: Date | null;
  received_at: Date;
  evidence_hash: string | null;
  evidence_artifact_id: number | null;
  source_verified: boolean;
  verification_state: "reported" | "verified" | "manual_unverified";
  report_url: string | null;
  trust_reasons: string[];
};

export type TestMemberRow = { run_id: number; upstream_member_id: string; name: string | null; status: string; duration_ms: number | null };

const RUN_COLS = `r.id, r.project_id, r.team_id, m.name as member_name, r.source, r.upstream_execution_id, r.status, r.exit_code, r.has_terminal_event, r.commit_sha,
  r.objective, r.summary, r.started_at, r.finished_at, r.received_at, r.evidence_hash, r.evidence_artifact_id, r.source_verified, r.verification_state, r.report_url,
  r.trust_reasons`;

export async function listRuns(projectId: number, limit = 25) {
  const runs = await query<RunRow>(`select ${RUN_COLS} from kane_runs r left join members m on m.id = r.member_id where r.project_id = $1 order by r.received_at desc limit $2`, [
    projectId,
    limit,
  ]);
  const members = runs.length
    ? await query<TestMemberRow>("select run_id, upstream_member_id, name, status, duration_ms from kane_test_members where run_id = any($1) order by name", [runs.map((r) => r.id)])
    : [];
  return runs.map((r) => ({ ...r, members: members.filter((m) => m.run_id === r.id) }));
}

export type RunDetail = Awaited<ReturnType<typeof listRuns>>[number] & { evidence: EvidenceRow[]; defects: DefectRow[] };

/** One run, scoped: its team (cookie or token) or judges/organizers/mentors. */
export async function getRun(c: KaneCaller, id: number): Promise<RunDetail> {
  const [r] = await query<RunRow>(`select ${RUN_COLS} from kane_runs r left join members m on m.id = r.member_id where r.id = $1`, [id]);
  if (!r) throw new AppError("NOT_FOUND");
  await projectFor(c, r.project_id, { read: true });
  const [members, evidence, defects] = await Promise.all([
    query<TestMemberRow>("select run_id, upstream_member_id, name, status, duration_ms from kane_test_members where run_id = $1 order by name", [id]),
    query<EvidenceRow>(`select ${EVIDENCE_COLS} from evidence_artifacts e where e.source_run_id = $1 or e.id = $2 order by e.uploaded_at desc`, [id, r.evidence_artifact_id]),
    query<DefectRow>(`select ${DEFECT_COLS} from defects d where d.source_run_id = $1 or d.id in (select defect_id from defect_verifications where run_id = $1)`, [id]),
  ]);
  return { ...r, members, evidence, defects };
}

/** Public-safe projection of a run (no member names, no local metadata). */
export function runForEnvelope(r: RunDetail | (RunRow & { members?: TestMemberRow[] })) {
  return {
    id: r.id,
    status: r.status,
    exit_code: r.exit_code,
    has_terminal_event: r.has_terminal_event,
    source: r.source,
    upstream_execution_id: r.upstream_execution_id,
    commit_sha: r.commit_sha,
    objective: r.objective,
    verification_state: r.verification_state,
    source_verified: r.source_verified,
    trust_reasons: r.trust_reasons,
    summary: r.summary,
    received_at: new Date(r.received_at).toISOString(),
    finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    report_url: r.report_url,
    members: (r.members ?? []).map((m) => ({ id: m.upstream_member_id, name: m.name, status: m.status, duration_ms: m.duration_ms })),
  };
}

// ── Evidence (T-KANE-04) ─────────────────────────────────────────────────────

export type EvidenceRow = {
  id: number;
  project_id: number;
  object_key: string;
  sha256: string;
  kind: EvidenceKind;
  content_type: string | null;
  size_bytes: number | null;
  visibility: "private" | "team" | "judges" | "public";
  source_run_id: number | null;
  verified_at: Date | null;
  redaction_state: "unreviewed" | "clean" | "redacted" | "quarantined";
  quarantine_reason: string | null;
  original_name: string | null;
  uploaded_at: Date;
};

const EVIDENCE_COLS = `e.id, e.project_id, e.object_key, e.sha256, e.kind, e.content_type, e.size_bytes, e.visibility, e.source_run_id, e.verified_at, e.redaction_state,
  e.quarantine_reason, e.original_name, e.uploaded_at`;

export async function listEvidence(projectId: number) {
  return query<EvidenceRow>(`select ${EVIDENCE_COLS} from evidence_artifacts e where e.project_id = $1 order by e.uploaded_at desc limit 100`, [projectId]);
}

export const evidenceMetaSchema = z.object({
  project_id: zx.id.optional(),
  kind: z.enum(EVIDENCE_KINDS as [EvidenceKind, ...EvidenceKind[]]),
  run_id: zx.id.optional(),
  sha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/).optional(),
  visibility: z.enum(["team", "judges"]).default("team"),
});

export type EvidenceReceipt = Receipt & {
  evidence_id: number;
  sha256: string;
  redaction_state: EvidenceRow["redaction_state"];
  quarantine_reason: string | null;
  deduped: boolean;
  url: string;
};

/** Validate, hash, dedupe and store one evidence file in private Blob. */
export async function storeEvidence(
  c: KaneCaller,
  meta: unknown,
  file: { name: string; type: string | null; bytes: Buffer },
  opts: { signed?: boolean; requestId?: string } = {},
): Promise<EvidenceReceipt> {
  await requireFlag("kane_ingest");
  const m = parse(evidenceMetaSchema, meta);
  if (c.kind === "staff") throw new AppError("FORBIDDEN");
  const project = await projectFor(c, m.project_id);
  const member = callerMember(c)!;
  const kind = evidenceKindFor(m.kind, file.name);

  const v = inspectEvidence({ kind, name: file.name, claimedType: file.type, bytes: file.bytes, maxBytes: opts.signed ? MAX_SIGNED_BYTES : MAX_DIRECT_BYTES });
  if (v.verdict === "reject") throw new AppError("VALIDATION_FAILED", { userMessage: v.reason });
  const digest = sha256(file.bytes);
  if (m.sha256 && m.sha256 !== digest) throw new AppError("VALIDATION_FAILED", { userMessage: "The file's sha256 doesn't match the one you sent. Re-upload it." });

  const [dupe] = await query<EvidenceRow>(`select ${EVIDENCE_COLS} from evidence_artifacts e where e.project_id = $1 and e.sha256 = $2`, [project.id, digest]);
  if (dupe) return evidenceReceipt(dupe, true, project.team_slug);

  let run: { id: number; evidence_hash: string | null; source_verified: boolean } | undefined;
  if (m.run_id) {
    [run] = await query<{ id: number; evidence_hash: string | null; source_verified: boolean }>("select id, evidence_hash, source_verified from kane_runs where id = $1 and project_id = $2", [
      m.run_id,
      project.id,
    ]);
    if (!run) throw new AppError("NOT_FOUND", { userMessage: "That run isn't in your project." });
  }

  const quarantined = v.verdict === "quarantine";
  const key = `${quarantined ? "evidence-quarantine" : "evidence"}/${project.id}/${digest}.${v.ext}`;
  try {
    await put(key, file.bytes, { access: "private", contentType: quarantined ? "application/octet-stream" : v.contentType, addRandomSuffix: false, allowOverwrite: true });
    void query("update integration_state set status = 'ok', last_success_at = now(), updated_at = now() where system = 'blob'").catch(() => {});
  } catch (err) {
    console.error("[kane] evidence upload failed", (err as Error)?.name);
    void query("update integration_state set status = 'degraded', last_error_at = now(), last_error_code = 'evidence_put', updated_at = now() where system = 'blob'").catch(() => {});
    throw new AppError("DOWNSTREAM_DEGRADED", { userMessage: "Evidence storage is unavailable. Keep the file; your run report still counts as reported." });
  }

  // Provenance: the bytes match the hash a verified run reported.
  const verifiedByRun = !!run && run.source_verified && run.evidence_hash === digest;
  const row = await withAudit<EvidenceRow>(
    callerActor(c),
    quarantined ? "kane.evidence.quarantine" : "kane.evidence.upload",
    "evidence_artifact",
    async (tx) => {
      const { rows } = await tx.query<EvidenceRow>(
        `insert into evidence_artifacts (project_id, object_key, sha256, kind, content_type, size_bytes, visibility, source_run_id, uploaded_by, verified_at, redaction_state,
                                         quarantine_reason, original_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $10 then now() end, $11, $12, $13)
         on conflict (project_id, sha256) do update set object_key = evidence_artifacts.object_key
         returning id, project_id, object_key, sha256, kind, content_type, size_bytes, visibility, source_run_id, verified_at, redaction_state, quarantine_reason, original_name, uploaded_at`,
        [
          project.id,
          key,
          digest,
          kind,
          v.contentType,
          file.bytes.length,
          quarantined ? "private" : m.visibility,
          run?.id ?? null,
          member.id,
          verifiedByRun && !quarantined,
          quarantined ? "quarantined" : "unreviewed",
          quarantined ? v.reason : null,
          file.name.slice(0, 200),
        ],
      );
      if (run && !quarantined) await tx.query("update kane_runs set evidence_artifact_id = coalesce(evidence_artifact_id, $2), evidence_hash = coalesce(evidence_hash, $3) where id = $1", [run.id, rows[0].id, digest]);
      if (!quarantined) {
        await tx.query("update kane_runs set evidence_artifact_id = $2 where project_id = $1 and evidence_hash = $3 and evidence_artifact_id is null", [project.id, rows[0].id, digest]);
      }
      return { result: rows[0], resourceId: rows[0].id, after: { sha256: digest, kind, quarantined }, reason: quarantined ? v.reason : null };
    },
    { requestId: opts.requestId },
  );
  return evidenceReceipt(row, false, project.team_slug);
}

function evidenceReceipt(e: EvidenceRow, deduped: boolean, teamSlug: string): EvidenceReceipt {
  return {
    id: `EV-${e.id}`,
    evidence_id: e.id,
    sha256: e.sha256,
    redaction_state: e.redaction_state,
    quarantine_reason: e.quarantine_reason,
    deduped,
    server_time: new Date(e.uploaded_at).toISOString(),
    url: `/t/${teamSlug}/proof#evidence-${e.id}`,
  };
}

export const SIGNED_PREFIX = "evidence-incoming/";

/** The second half of a signed client upload: read the incoming blob, check it, store it, delete the incoming copy. */
export async function ingestSignedUpload(c: KaneCaller, meta: unknown, pathname: string, name: string, opts: { requestId?: string } = {}) {
  const project = await projectFor(c, (meta as { project_id?: number } | null)?.project_id ?? null);
  if (!pathname.startsWith(`${SIGNED_PREFIX}${project.id}/`) || pathname.includes("..")) throw new AppError("FORBIDDEN", { userMessage: "That upload isn't for your project." });
  const blob = await get(pathname, { access: "private" }).catch(() => null);
  if (!blob?.stream) throw new AppError("NOT_FOUND", { userMessage: "The upload didn't arrive. Try again." });
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = blob.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SIGNED_BYTES) {
      await reader.cancel();
      await del(pathname).catch(() => {});
      throw new AppError("VALIDATION_FAILED", { userMessage: "The file is over 50 MB." });
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return await storeEvidence(c, meta, { name, type: blob.blob.contentType ?? null, bytes: Buffer.concat(chunks) }, { signed: true, requestId: opts.requestId });
  } finally {
    await del(pathname).catch(() => {});
  }
}

/** Who may read an evidence file. Quarantined files: organizers only. */
export async function readEvidence(c: KaneCaller | null, id: number) {
  const [e] = await query<EvidenceRow>(`select ${EVIDENCE_COLS} from evidence_artifacts e where e.id = $1`, [id]);
  if (!e) throw new AppError("NOT_FOUND");
  const staff = c?.kind === "staff" ? c.staff : null;
  const m = c ? callerMember(c) : null;
  const [proj] = await query<{ team_id: number }>("select team_id from projects where id = $1", [e.project_id]);
  const own = !!m && !!proj && m.team_id === proj.team_id;
  let ok = false;
  if (e.redaction_state === "quarantined") ok = hasRole(staff, "organizer");
  else if (own || hasRole(staff, "organizer")) ok = true;
  else if (e.visibility === "judges" || e.visibility === "public") ok = hasRole(staff, "judge", "mentor") || e.visibility === "public";
  if (!ok) throw new AppError("NOT_FOUND"); // never confirm it exists
  const file = await get(e.object_key, { access: "private" }).catch(() => null);
  if (!file?.stream) throw new AppError("DOWNSTREAM_DEGRADED", { userMessage: "Evidence storage is unavailable right now." });
  return { artifact: e, stream: file.stream };
}

// ── Defects (T-KANE-06) ──────────────────────────────────────────────────────

export type DefectRow = {
  id: number;
  project_id: number;
  signature: string;
  title: string;
  detail: string | null;
  source_run_id: number | null;
  status: "suspected" | "confirmed" | "not_a_bug" | "fixed" | "reverified";
  failure_class: "product" | "infra" | "auth" | "unknown";
  confirmed_at: Date | null;
  resolution_note: string | null;
  created_at: Date;
  updated_at: Date;
};

const DEFECT_COLS = `d.id, d.project_id, d.signature, d.title, d.detail, d.source_run_id, d.status, d.failure_class, d.confirmed_at, d.resolution_note, d.created_at, d.updated_at`;

export async function listDefects(projectId: number) {
  const defects = await query<DefectRow>(`select ${DEFECT_COLS} from defects d where d.project_id = $1 order by d.updated_at desc limit 100`, [projectId]);
  const verifications = defects.length
    ? await query<{ defect_id: number; run_id: number; commit_sha: string | null; result: string; created_at: Date }>(
        "select defect_id, run_id, commit_sha, result, created_at from defect_verifications where defect_id = any($1) order by created_at desc",
        [defects.map((d) => d.id)],
      )
    : [];
  return defects.map((d) => ({ ...d, verifications: verifications.filter((v) => v.defect_id === d.id) }));
}

export const defectActionSchema = z.object({
  defect_id: zx.id,
  action: z.enum(["confirm", "not_a_bug", "mark_fixed", "reopen"]),
  failure_class: z.enum(["product", "infra", "auth", "unknown"]).optional(),
  note: zx.optText(400),
});

const TRANSITIONS: Record<string, { from: DefectRow["status"][]; to: DefectRow["status"] }> = {
  confirm: { from: ["suspected"], to: "confirmed" },
  not_a_bug: { from: ["suspected", "confirmed"], to: "not_a_bug" },
  mark_fixed: { from: ["confirmed"], to: "fixed" },
  reopen: { from: ["not_a_bug", "fixed", "reverified"], to: "suspected" },
};

/**
 * A teammate (a person, never an agent alone) moves a defect along. Only
 * product failures can be confirmed; infra/auth ones are closed as not a bug.
 * "reverified" is never set here: only a passing run on a new commit does that.
 */
export async function updateDefect(c: KaneCaller, raw: unknown, opts: { projectId?: number; requestId?: string } = {}) {
  const input = parse(defectActionSchema, raw);
  if (c.kind === "staff") throw new AppError("FORBIDDEN", { userMessage: "Only the team can confirm its own defects." });
  const project = await projectFor(c, opts.projectId);
  const member = callerMember(c)!;
  const t = TRANSITIONS[input.action];
  return withAudit(
    callerActor(c),
    `kane.defect.${input.action}`,
    "defect",
    async (tx) => {
      const { rows } = await tx.query<DefectRow>(`select ${DEFECT_COLS} from defects d where d.id = $1 and d.project_id = $2 for update`, [input.defect_id, project.id]);
      const d = rows[0];
      if (!d) throw new AppError("NOT_FOUND");
      if (!t.from.includes(d.status)) throw new AppError("CONFLICT", { userMessage: `A ${d.status.replace("_", " ")} defect can't be moved that way.` });
      const cls = input.failure_class ?? d.failure_class;
      if (input.action === "confirm" && cls !== "product") {
        throw new AppError("VALIDATION_FAILED", { userMessage: "Infra and auth failures aren't product defects. Mark it not a bug, or fix the setup and re-run." });
      }
      const { rows: after } = await tx.query<DefectRow>(
        `update defects d set status = $2, failure_class = $3, resolution_note = coalesce($4, resolution_note), updated_at = now(),
                confirmed_by = case when $2 = 'confirmed' then $5 else confirmed_by end,
                confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
          where id = $1 returning ${DEFECT_COLS}`,
        [d.id, t.to, cls, input.note, member.id],
      );
      return { result: { id: `DF-${d.id}`, defect: after[0], server_time: new Date(after[0].updated_at).toISOString() }, resourceId: d.id, before: { status: d.status }, after: { status: t.to }, reason: input.note };
    },
    { requestId: opts.requestId },
  );
}

// ── Milestones (T-KANE-07) ───────────────────────────────────────────────────

export type MilestoneRow = {
  id: number;
  project_id: number;
  title: string;
  claim: string;
  confidence: "verified" | "participant_reported" | "inferred";
  evidence_id: number | null;
  evidence_ids: number[];
  source_run_id: number | null;
  visibility: "team" | "judges" | "public";
  requested_visibility: "team" | "judges" | "public";
  status: "proposed" | "approved" | "withdrawn";
  proposed_by: number | null;
  proposed_by_name: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  created_at: Date;
};

const MILESTONE_COLS = `ms.id, ms.project_id, ms.title, ms.claim, ms.confidence, ms.evidence_id, ms.evidence_ids, ms.source_run_id, ms.visibility, ms.requested_visibility,
  ms.status, ms.proposed_by, pm.name as proposed_by_name, am.name as approved_by_name, ms.approved_at, ms.created_at`;

export async function listMilestones(projectId: number, opts: { publicOnly?: boolean } = {}) {
  return query<MilestoneRow>(
    `select ${MILESTONE_COLS} from milestones ms left join members pm on pm.id = ms.proposed_by left join members am on am.id = ms.approved_by
      where ms.project_id = $1 ${opts.publicOnly ? "and ms.visibility = 'public' and ms.status = 'approved'" : "and ms.status <> 'withdrawn'"}
      order by ms.created_at desc limit 100`,
    [projectId],
  );
}

export const milestoneSchema = z.object({
  project_id: zx.id.optional(),
  title: zx.text(120),
  claim: zx.text(600),
  evidence_ids: z.array(zx.id).max(10).default([]),
  source_run_id: zx.id.optional(),
  visibility: z.enum(["team", "judges", "public"]).default("team"),
  idempotency_key: zx.idempotencyKey,
});

/**
 * Propose a milestone. Confidence is decided here, not by the caller:
 * "verified" only when it cites a verified run or evidence tied to one.
 * Team visibility is immediate; judges/public wait for a teammate's approval.
 */
export async function proposeMilestone(c: KaneCaller, raw: unknown, opts: { requestId?: string } = {}) {
  const input = parse(milestoneSchema, raw);
  if (c.kind === "staff") throw new AppError("FORBIDDEN");
  const project = await projectFor(c, input.project_id);
  const member = callerMember(c)!;

  const ev = input.evidence_ids.length
    ? await query<{ id: number; verified_at: Date | null; redaction_state: string; run_verified: boolean | null }>(
        `select e.id, e.verified_at, e.redaction_state, r.source_verified as run_verified
           from evidence_artifacts e left join kane_runs r on r.id = e.source_run_id
          where e.project_id = $1 and e.id = any($2)`,
        [project.id, input.evidence_ids],
      )
    : [];
  if (ev.length !== input.evidence_ids.length) throw new AppError("NOT_FOUND", { userMessage: "Some of that evidence isn't in your project." });
  if (ev.some((e) => e.redaction_state === "quarantined")) throw new AppError("VALIDATION_FAILED", { userMessage: "Quarantined evidence can't back a claim." });

  let run: { id: number; source_verified: boolean; status: string } | undefined;
  if (input.source_run_id) {
    [run] = await query<{ id: number; source_verified: boolean; status: string }>("select id, source_verified, status from kane_runs where id = $1 and project_id = $2", [input.source_run_id, project.id]);
    if (!run) throw new AppError("NOT_FOUND", { userMessage: "That run isn't in your project." });
  }
  const verified = (!!run && run.source_verified && run.status === "passed") || ev.some((e) => !!e.verified_at || !!e.run_verified);
  const confidence: MilestoneRow["confidence"] = verified ? "verified" : ev.length || run ? "participant_reported" : "inferred";
  const needsApproval = input.visibility !== "team";

  const exec = () =>
    withAudit(
      callerActor(c),
      "kane.milestone.propose",
      "milestone",
      async (tx) => {
        const { rows } = await tx.query<{ id: number; created_at: Date }>(
          `insert into milestones (project_id, title, claim, confidence, evidence_id, evidence_ids, source_run_id, visibility, requested_visibility, status, proposed_by)
           values ($1, $2, $3, $4, $5, $6, $7, 'team', $8, $9, $10) returning id, created_at`,
          [project.id, input.title, input.claim, confidence, input.evidence_ids[0] ?? null, input.evidence_ids, run?.id ?? null, input.visibility, needsApproval ? "proposed" : "approved", member.id],
        );
        const id = rows[0].id;
        return {
          result: {
            id: `MS-${id}`,
            milestone_id: id,
            confidence,
            status: needsApproval ? ("proposed" as const) : ("approved" as const),
            visibility: "team" as const,
            requested_visibility: input.visibility,
            needs_team_approval: needsApproval,
            server_time: new Date(rows[0].created_at).toISOString(),
            url: `/t/${project.team_slug}/proof#milestone-${id}`,
          },
          resourceId: id,
          after: { confidence, requested_visibility: input.visibility },
        };
      },
      { requestId: opts.requestId },
    );
  const { result } = await idempotent(input.idempotency_key ?? null, `kane.milestone:team:${project.team_id}`, exec);
  return result;
}

/**
 * A teammate approves a milestone's requested visibility. The proposer can't
 * approve their own public claim unless they are the only member.
 */
export async function approveMilestone(member: MemberRow, milestoneId: number, decision: "approve" | "withdraw") {
  const project = await projectFor({ kind: "member", member });
  return withAudit<{ id: string; status: string; visibility?: string }>(memberActor(member), `kane.milestone.${decision}`, "milestone", async (tx) => {
    const { rows } = await tx.query<{ id: number; proposed_by: number | null; status: string; requested_visibility: string }>(
      "select id, proposed_by, status, requested_visibility from milestones where id = $1 and project_id = $2 for update",
      [milestoneId, project.id],
    );
    const ms = rows[0];
    if (!ms) throw new AppError("NOT_FOUND");
    if (decision === "withdraw") {
      await tx.query("update milestones set status = 'withdrawn', visibility = 'team' where id = $1", [ms.id]);
      return { result: { id: `MS-${ms.id}`, status: "withdrawn" }, resourceId: ms.id, before: { status: ms.status } };
    }
    if (ms.status !== "proposed") throw new AppError("CONFLICT", { userMessage: "That milestone isn't waiting for approval." });
    if (ms.proposed_by === member.id) {
      const { rows: n } = await tx.query<{ n: number }>("select count(*)::int as n from members where team_id = $1 and deleted_at is null", [project.team_id]);
      if (n[0].n > 1) throw new AppError("FORBIDDEN", { userMessage: "A teammate has to approve your own claim before it goes wider than the team." });
    }
    await tx.query("update milestones set status = 'approved', visibility = requested_visibility, approved_by = $2, approved_at = now() where id = $1", [ms.id, member.id]);
    return { result: { id: `MS-${ms.id}`, status: "approved", visibility: ms.requested_visibility }, resourceId: ms.id, before: { status: ms.status }, after: { visibility: ms.requested_visibility } };
  });
}

// ── Coverage (T-KANE-10) and the overview the Proof tab reads ────────────────

/** Latest designed-vs-proven coverage reported by this team. Team-only; never summed across teams. */
export async function latestCoverage(projectId: number) {
  const [r] = await query<{ id: number; coverage: { designed: number | null; proven: number | null; total: number | null }; received_at: Date; source_verified: boolean }>(
    `select id, summary->'coverage' as coverage, received_at, source_verified from kane_runs
      where project_id = $1 and jsonb_typeof(summary->'coverage') = 'object' order by received_at desc limit 1`,
    [projectId],
  );
  return r ?? null;
}

export async function listCommits(projectId: number, limit = 20) {
  return query<{ sha: string; ref: string | null; pushed_at: Date; committed_at: Date | null; author_login: string | null; repo_full_name: string }>(
    `select c.sha, c.ref, c.pushed_at, c.committed_at, c.author_login, l.repo_full_name
       from repository_commits c join repository_links l on l.id = c.repository_link_id
      where c.project_id = $1 order by c.pushed_at desc limit $2`,
    [projectId, limit],
  );
}

export async function getProofOverview(projectId: number) {
  const [runs, defects, milestones, evidence, coverage, commits, ingest] = await Promise.all([
    listRuns(projectId, 30),
    listDefects(projectId),
    listMilestones(projectId),
    listEvidence(projectId),
    latestCoverage(projectId),
    listCommits(projectId).catch(() => []), // 027 not applied yet → no timeline, not an error page
    query<{ status: string; last_success_at: Date | null }>("select status, last_success_at from integration_state where system = 'kane_ingest'").catch(() => []),
  ]);
  const verifiedRuns = runs.filter((r) => r.source_verified);
  return {
    runs,
    defects,
    milestones,
    evidence,
    coverage,
    commits,
    ingestState: ingest[0]?.status ?? "unknown",
    counts: {
      runs: runs.length,
      verified: verifiedRuns.length,
      verifiedPassed: verifiedRuns.filter((r) => r.status === "passed").length,
      suspected: defects.filter((d) => d.status === "suspected").length,
      confirmed: defects.filter((d) => d.status === "confirmed" || d.status === "fixed").length,
      reverified: defects.filter((d) => d.status === "reverified").length,
    },
  };
}

// ── GitHub push webhook (T-KANE-09) ──────────────────────────────────────────

type PushPayload = {
  ref?: string;
  after?: string;
  repository?: { id?: number; full_name?: string; default_branch?: string; html_url?: string };
  installation?: { id?: number };
  sender?: { login?: string };
  commits?: { id?: string; timestamp?: string; author?: { username?: string } }[];
  head_commit?: { id?: string; timestamp?: string } | null;
};

/**
 * Record a verified push: link the repo to the project whose repo_url names
 * it, update last push, and add each commit SHA to the timeline. Commit
 * messages, diffs and emails are never stored.
 */
export async function ingestGithubPush(deliveryId: string, payload: PushPayload) {
  const full = payload.repository?.full_name?.toLowerCase();
  if (!full || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(full)) return { status: "ignored" as const, detail: "no repository" };

  return withAudit<{ status: "ignored" | "processed"; detail: string }>({ type: "pipeline", label: "github" }, "github.push", "repository_link", async (tx) => {
    let { rows: links } = await tx.query<{ id: number; project_id: number }>("select id, project_id from repository_links where lower(repo_full_name) = $1", [full]);
    if (!links.length) {
      // First push from a repo a team put in its project: link it.
      const { rows: projects } = await tx.query<{ id: number }>(
        `select id from projects where lower(regexp_replace(coalesce(repo_url, ''), '^https://github\\.com/([^/?#]+/[^/?#]+?)(\\.git)?/?([?#].*)?$', '\\1')) = $1`,
        [full],
      );
      if (!projects.length) return { result: { status: "ignored" as const, detail: "repo not linked to a project" }, resourceId: full, reason: "unlinked" };
      const inserted = [];
      for (const p of projects) {
        const { rows } = await tx.query<{ id: number; project_id: number }>(
          `insert into repository_links (project_id, provider, installation_id, repo_id, repo_full_name, default_branch, permission_scope)
           values ($1, 'github', $2, $3, $4, $5, '["contents:read","metadata:read"]'::jsonb)
           on conflict (project_id, repo_full_name) do update set installation_id = coalesce(excluded.installation_id, repository_links.installation_id)
           returning id, project_id`,
          [p.id, payload.installation?.id ? String(payload.installation.id) : null, payload.repository?.id ? String(payload.repository.id) : null, payload.repository!.full_name, payload.repository?.default_branch ?? null],
        );
        inserted.push(rows[0]);
      }
      links = inserted;
    }

    const commits = (payload.commits ?? []).filter((x) => x.id && /^[0-9a-f]{40}$/.test(x.id)).slice(0, 100);
    const head = payload.after && /^[0-9a-f]{40}$/.test(payload.after) && !/^0+$/.test(payload.after) ? payload.after : null;
    for (const l of links) {
      if (head) await tx.query("update repository_links set last_push_at = now(), last_commit_sha = $2 where id = $1", [l.id, head]);
      for (const cm of commits) {
        await tx.query(
          `insert into repository_commits (repository_link_id, project_id, sha, ref, committed_at, author_login, delivery_id)
           values ($1, $2, $3, $4, $5, $6, $7) on conflict (repository_link_id, sha) do nothing`,
          [l.id, l.project_id, cm.id, payload.ref?.slice(0, 200) ?? null, cm.timestamp ?? null, cm.author?.username?.slice(0, 80) ?? null, deliveryId],
        );
      }
      const { rows: team } = await tx.query<{ team_id: number }>("select team_id from projects where id = $1", [l.project_id]);
      await tx.query(
        `insert into activity (team_id, action, source, source_event_id, type, visibility, payload, signature_status)
         values ($1, $2, 'github', $3, 'github.push', 'team', $4, 'verified') on conflict do nothing`,
        [team[0].team_id, `Pushed ${commits.length} commit${commits.length === 1 ? "" : "s"} to ${payload.repository!.full_name}`, `${deliveryId}:${l.id}`, JSON.stringify({ commits: commits.length, head })],
      );
    }
    await tx.query("update integration_state set status = 'ok', last_success_at = now(), updated_at = now() where system = 'github'");
    return { result: { status: "processed" as const, detail: `${links.length} project(s), ${commits.length} commit(s)` }, resourceId: full, payload: { delivery: deliveryId } };
  });
}

// ── Harness capability catalog (MCP harness_get_capabilities) ────────────────

/**
 * What a team can build its harness from. Static and documented: entitlement
 * checks happen on the participant's machine (`kane-cli whoami`, plugin
 * doctor), not here. Docs links point to the official Kane CLI docs.
 */
export const KANE_CAPABILITIES = [
  {
    id: "run", label: "One-shot browser run", command: "kane-cli run \"<objective>\" --agent", proves: "One browser objective; run_end + exit code", completion: "run_end",
    needs: "Any signed-in Kane CLI", doc: "https://www.testmuai.com/docs/kane-cli-cli-reference",
    workflow: ["kane-cli login", "kane-cli run \"Open https://your.app, sign in with {{user}} and verify the dashboard shows your name\" --agent"],
  },
  {
    id: "testmd", label: "Saved, replayable test", command: "kane-cli testmd run <file>_test.md --agent", proves: "A saved, replayable test", completion: "test_md_done",
    needs: "Any signed-in Kane CLI", doc: "https://www.testmuai.com/docs/kane-cli-generate",
    workflow: ["kane-cli run \"<objective>\" --name checkout --agent   # recorded as a _test.md while it runs", "kane-cli testmd run checkout_test.md --agent"],
  },
  {
    id: "testrun", label: "Local suite", command: "kane-cli testrun run <selection> --agent", proves: "A suite with per-test pass/fail", completion: "testrun_done",
    needs: "Any signed-in Kane CLI", doc: "https://www.testmuai.com/docs/kane-cli-testrun",
    workflow: ["kane-cli testrun run tests/ --dry-run < /dev/null", "kane-cli testrun run tests/ --parallel 4 < /dev/null"],
  },
  {
    id: "testrun_remote", label: "Suite on the cloud grid", command: "kane-cli testrun run <selection> --remote --agent", proves: "The suite on the cloud grid (needs a HyperExecute plan)", completion: "remote_done",
    needs: "A HyperExecute plan and the remote-execution plugin", doc: "https://www.testmuai.com/docs/kane-cli-remote-execution",
    workflow: ["kane-cli plugin install remote-execution", "kane-cli testrun run tests/ --remote --dry-run < /dev/null", "kane-cli testrun run tests/ --remote < /dev/null"],
  },
  {
    id: "design", label: "Assurance: tests from your spec", command: "kane-cli design tests --mode agent", proves: "A requirement-linked suite designed from your spec", completion: "done",
    needs: "Kane CLI 0.6.1 or newer (some assurance features need newer releases)", doc: "https://www.testmuai.com/docs/kane-cli-assurance-design",
    workflow: ["kane-cli context ingest requirements/spec.md --mode agent", "kane-cli design tests --mode agent", "kane-cli testrun run <designed tests> < /dev/null"],
  },
  {
    id: "cover", label: "Assurance: coverage", command: "kane-cli cover --mode agent", proves: "Designed vs proven coverage per use case", completion: "done",
    needs: "Kane CLI 0.6.1 or newer, after a design run", doc: "https://www.testmuai.com/docs/kane-cli-assurance-coverage",
    workflow: ["kane-cli testrun run <designed tests> < /dev/null", "kane-cli cover --mode agent"],
  },
  {
    id: "evidence", label: "Evidence packs", command: "kane-cli evidence serve <pack>", proves: "The sealed evidence pack for a run", completion: "n/a",
    needs: "Any signed-in Kane CLI", doc: "https://www.testmuai.com/docs/kane-cli-evidence",
    workflow: ["kane-cli run \"<objective>\" --agent   # prints the pack path on stderr", "kane-cli evidence serve <pack>.evidence"],
  },
  {
    id: "mobile", label: "Native mobile app", command: "kane-cli run \"<objective>\" --target emulator|simulator --agent", proves: "Native app flows (macOS Apple Silicon or --remote)", completion: "run_end",
    needs: "macOS on Apple Silicon for a local emulator or simulator; otherwise --remote; real devices are plan dependent", doc: "https://www.testmuai.com/docs/kane-cli-mobile-real-device",
    workflow: ["kane-cli devices list --target emulator", "kane-cli run \"Open the app and verify the home screen loads\" --target emulator --app <build.apk> --agent"],
  },
] as const;
