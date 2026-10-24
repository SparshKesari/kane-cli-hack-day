import { createHash } from "node:crypto";

// Pure helpers for Kane CLI `--agent` output (no DB, no Next). The kanehack
// CLI does the same parsing locally (packages/kanehack/lib/ndjson.mjs) and
// sends the result; the server re-parses raw NDJSON when it is sent, and in
// either case decides success from the process exit code, never from the
// stream alone (SPEC §6, acceptance A17).
//
// Completion events, per the official kane-cli skill:
//   run           → run_end        {status, summary, one_liner, reason, duration, credits_consumed, test_url, result_code?, verdict?}
//   testmd run    → test_md_done   {overall_status, duration_s, session_id, share_url?}
//   testrun run   → testrun_done   {execution_id, overall_status}  (+ testrun_summary totals, testrun_member_end per test)
//                   remote_done    {status, exit, job_id}          (cloud grid, after testrun_done)
//   cover / gaps  → coverage | gaps payload, then done
// Exit codes: 0 passed · 1 failed · 2 nothing ran (auth/infra/usage) · 3 timeout/cancelled.

export type RunStatus = "running" | "passed" | "failed" | "blocked" | "errored" | "cancelled";
export type MemberStatus = "passed" | "failed" | "blocked" | "skipped" | "errored";

export type ParsedMember = {
  upstream_member_id: string;
  name: string;
  status: MemberStatus;
  duration_ms: number | null;
  failure: string | null;
  subject_key: string;
};

export type ParsedCoverage = { designed: number | null; proven: number | null; total: number | null };

export type ParsedStream = {
  family: "run" | "testmd" | "testrun" | "assurance" | "unknown";
  terminal: { type: string; status: string | null } | null;
  execution_id: string | null;
  summary: {
    status: string | null;
    one_liner: string | null;
    reason: string | null;
    duration_s: number | null;
    credits: number | null;
    totals: Record<string, number> | null;
    test_url: string | null;
    share_url: string | null;
    result_code: string | null;
    bug_verdict: { confirmed?: boolean; category?: string; severity?: string; one_liner?: string } | null;
  };
  members: ParsedMember[];
  coverage: ParsedCoverage | null;
  lines: number;
  invalid_lines: number;
};

const TERMINAL = new Set(["run_end", "test_md_done", "testrun_done", "remote_done", "done"]);

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** What a run or a test is *about*, stable across runs: the objective text or the test file name. */
export function subjectKey(kind: "run" | "test", value: string) {
  const v = kind === "test" ? (value.split(/[\\/]/).pop() ?? value) : value;
  return shortHash(`${kind}:${v.trim().toLowerCase().replace(/\s+/g, " ")}`);
}

/** Failure text with volatile bits (numbers, hex ids, quotes) stripped, so the same failure dedupes. */
export function normalizeFailure(s: string | null | undefined) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, "#")
    .replace(/\d+/g, "#")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export const defectSignature = (subject: string, failure: string | null | undefined) => shortHash(`${subject}|${normalizeFailure(failure)}`);

function memberStatus(s: unknown): MemberStatus {
  switch (s) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "interrupted":
      return "blocked";
    default:
      return "errored"; // broken, unknown
  }
}

/** Parse an NDJSON stream (stdout of `kane-cli … --agent`). Never throws; bad lines are counted. */
export function parseKaneStream(ndjson: string): ParsedStream {
  const out: ParsedStream = {
    family: "unknown",
    terminal: null,
    execution_id: null,
    summary: { status: null, one_liner: null, reason: null, duration_s: null, credits: null, totals: null, test_url: null, share_url: null, result_code: null, bug_verdict: null },
    members: [],
    coverage: null,
    lines: 0,
    invalid_lines: 0,
  };
  const members = new Map<string, ParsedMember>();

  for (const raw of ndjson.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    out.lines++;
    let ev: Record<string, unknown>;
    try {
      const v = JSON.parse(line);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      ev = v as Record<string, unknown>;
    } catch {
      out.invalid_lines++;
      continue;
    }
    const type = typeof ev.type === "string" ? ev.type : null;
    if (!type) continue; // progress events: display only

    if (type.startsWith("testrun_")) out.family = "testrun";
    else if (type.startsWith("test_md_") && out.family !== "testrun") out.family = "testmd";
    else if ((type === "run_start" || type === "run_end") && out.family === "unknown") out.family = "run";
    // A run's own coverage event (Kane CLI 0.10.0-rc.3+, before run_end) doesn't make it a cover stream: run_start came first.
    else if ((type === "coverage" || type === "gaps") && out.family === "unknown") out.family = "assurance";

    switch (type) {
      case "run_end":
        // Inside testmd / testrun a run_end closes one step, not the command.
        if (out.family === "run" || out.family === "unknown") {
          out.terminal = { type, status: str(ev.status, 40) };
          out.summary.status = str(ev.status, 40);
          out.summary.one_liner = str(ev.one_liner, 280) ?? str(ev.summary, 280);
          out.summary.reason = str(ev.reason, 280);
          out.summary.duration_s = num(ev.duration);
          out.summary.credits = num(ev.credits_consumed) ?? num(ev.credits);
          out.summary.test_url = str(ev.test_url, 500);
          out.summary.result_code = str(ev.result_code, 20);
          if (ev.verdict && typeof ev.verdict === "object") {
            const v = ev.verdict as Record<string, unknown>;
            out.summary.bug_verdict = { confirmed: v.confirmed === true, category: str(v.category, 80) ?? undefined, severity: str(v.severity, 40) ?? undefined, one_liner: str(v.one_liner, 280) ?? undefined };
          }
        }
        break;
      case "test_md_done":
        out.terminal = { type, status: str(ev.overall_status, 40) };
        out.summary.status = str(ev.overall_status, 40);
        out.summary.duration_s = num(ev.duration_s);
        out.summary.share_url = str(ev.share_url, 500);
        out.execution_id ??= str(ev.session_id, 120);
        break;
      case "testrun_start":
        out.execution_id = str(ev.execution_id, 120) ?? out.execution_id;
        break;
      case "testrun_member_end":
      case "testrun_authored_member_end": {
        const path = str(ev.path, 400) ?? "unknown";
        const name = path.split(/[\\/]/).pop() ?? path;
        const failure = ev.failure && typeof ev.failure === "object" ? str((ev.failure as Record<string, unknown>).message, 400) : null;
        const d = num(ev.duration_s);
        members.set(name, {
          upstream_member_id: str(ev.test_id, 120) ?? name,
          name,
          status: memberStatus(ev.status),
          duration_ms: d === null ? null : Math.round(d * 1000),
          failure,
          subject_key: subjectKey("test", name),
        });
        break;
      }
      case "testrun_summary": {
        const t = ev.totals && typeof ev.totals === "object" ? (ev.totals as Record<string, unknown>) : {};
        const totals: Record<string, number> = {};
        for (const k of ["tests", "passed", "failed", "broken", "skipped", "authored"]) {
          const n = num(t[k]);
          if (n !== null) totals[k] = n;
        }
        out.summary.totals = totals;
        out.summary.duration_s = num(ev.duration_s) ?? out.summary.duration_s;
        break;
      }
      case "testrun_done":
        out.terminal = { type, status: str(ev.overall_status, 40) };
        out.summary.status = str(ev.overall_status, 40);
        out.execution_id = str(ev.execution_id, 120) ?? out.execution_id;
        break;
      case "remote_done":
        // Cloud grid: the wrapper after testrun_done. Its status wins if present.
        out.terminal = { type, status: str(ev.status, 40) ?? out.terminal?.status ?? null };
        break;
      case "coverage":
      case "gaps": {
        const cov = extractCoverage(ev);
        if (cov) out.coverage = cov;
        break;
      }
      case "done":
        if (out.family === "assurance") out.terminal = { type, status: str(ev.status, 40) };
        break;
    }
  }
  out.members = [...members.values()];
  if (out.terminal && !TERMINAL.has(out.terminal.type)) out.terminal = null;
  return out;
}

/** Best effort over the `cover --json` document: designed vs proven counts. Unknown shapes → null, never 0. */
function extractCoverage(ev: Record<string, unknown>): ParsedCoverage | null {
  const doc = (ev.coverage ?? ev.gaps ?? ev.document ?? ev) as Record<string, unknown>;
  const pick = (o: unknown, ...keys: string[]): number | null => {
    if (!o || typeof o !== "object") return null;
    for (const k of keys) {
      const v = (o as Record<string, unknown>)[k];
      const n = num(v);
      if (n !== null) return n;
      if (v && typeof v === "object") {
        const inner = num((v as Record<string, unknown>).count) ?? num((v as Record<string, unknown>).value);
        if (inner !== null) return inner;
      }
    }
    return null;
  };
  const totals = (doc.totals ?? doc.summary ?? doc) as Record<string, unknown>;
  const designed = pick(totals, "designed", "designed_count", "covered_designed");
  const proven = pick(totals, "proven", "proven_count", "covered_proven");
  const total = pick(totals, "total", "criteria", "acceptance_criteria", "total_criteria");
  if (designed === null && proven === null) return null;
  return { designed, proven, total };
}

/**
 * The run's status from the process exit code (the authority) and whether a
 * completion event arrived. A missing completion event is never a pass.
 */
export function decideStatus(exitCode: number | null, hasTerminal: boolean): { status: RunStatus; warning?: string } {
  if (exitCode === null || exitCode === undefined) {
    return hasTerminal ? { status: "errored", warning: "No exit code was reported, so the run can't count as passed." } : { status: "running" };
  }
  if (exitCode === 0) {
    return hasTerminal ? { status: "passed" } : { status: "errored", warning: "Exit code 0 but no completion event: not counted as a pass." };
  }
  if (exitCode === 1) return { status: "failed" };
  if (exitCode === 2) return { status: "blocked", warning: "Exit code 2: nothing ran (auth, setup or an invalid plan)." };
  if (exitCode === 3) return { status: "cancelled" };
  return { status: "errored", warning: `Unexpected exit code ${exitCode}.` };
}

// ── Credential guard ─────────────────────────────────────────────────────────

const SECRET_KEY = /(^|[_-])(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|auth[_-]?header|cookie|credential|bearer)s?($|[_-])/i;
const SECRET_VALUE: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI-style
  /\bkh[kpbh]_[A-Za-z0-9_-]{20,}/, // our own tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bLT_ACCESS_KEY\s*[=:]/i,
  /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/i,
];

/** Paths in `value` that look like credentials (by key name or value shape). Empty = clean. */
export function findCredentialLike(value: unknown, path = "", out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 20) return out;
  if (typeof value === "string") {
    if (SECRET_VALUE.some((re) => re.test(value))) out.push(path || "(value)");
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findCredentialLike(v, `${path}[${i}]`, out, depth + 1));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      // Counts like tokens_used: 5 are fine; a string or object under a secret-ish key is not.
      if (SECRET_KEY.test(k) && ((typeof v === "string" && v.trim() !== "") || (v && typeof v === "object" && Object.keys(v).length > 0))) out.push(p);
      else findCredentialLike(v, p, out, depth + 1);
    }
  }
  return out;
}

/** Local filesystem paths (session_dir, log_path…) are private; strip them from anything stored. */
export function stripLocalPaths<T>(v: T): T {
  if (typeof v === "string") return v.replace(/(~\/|\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)[^\s"']*/g, "[local path]") as T;
  if (Array.isArray(v)) return v.map(stripLocalPaths) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(session_dir|run_dir|log_path|sessions_path|cwd|home)$/i.test(k)) continue;
      o[k] = stripLocalPaths(x);
    }
    return o as T;
  }
  return v;
}
