import "server-only";
import { query } from "@/lib/db";
import { AppError, parse, sha256, z } from "./core";
import { getRoster } from "./teams";

// Codex status pings from the opt-in hook (plugin/hooks/README.md) and the
// team view of them. Metadata only: the schema is strict, so a ping carrying
// anything else (prompts, transcripts, code, paths, repo names, tokens) is
// refused rather than trimmed. Stored per member per Codex session
// (db/035_codex_status.sql); the session id is kept only as a hash.

export const CODEX_EVENTS = ["session_start", "heartbeat", "tool_use", "kane_run_started", "kane_run_finished", "waiting_for_human", "error", "stop", "session_end"] as const;
export const CODEX_STATUSES = ["working", "idle", "waiting_for_human", "error", "ended"] as const;
export type CodexStatus = (typeof CODEX_STATUSES)[number];

/** Seen within this long and not ended = online. */
export const ONLINE_SECONDS = 180;

const token = (max: number) => z.string().trim().min(1).max(max).regex(/^[\w.\-+:/@]+$/, "letters, digits and . - + : / @ only");

export const pingSchema = z
  .object({
    event: z.enum(CODEX_EVENTS),
    status: z.enum(CODEX_STATUSES).optional(),
    session_id: z.string().trim().min(8).max(200),
    host: z.enum(["codex", "claude-code", "other"]).default("codex"),
    codex_version: token(40).optional(),
    model: token(60).optional(),
    kane_run_id: token(80).optional(),
    at: z.string().datetime({ offset: true }).optional(),
    idempotency_key: z.string().optional(),
  })
  .strict();

/** What a ping's event says about the session when it doesn't send a status. */
export function statusFor(event: (typeof CODEX_EVENTS)[number], given?: CodexStatus): CodexStatus {
  if (given) return given;
  if (event === "session_end") return "ended";
  if (event === "stop") return "idle";
  if (event === "waiting_for_human") return "waiting_for_human";
  if (event === "error") return "error";
  return "working";
}

export async function recordPing(memberId: number, teamId: number, raw: unknown) {
  const p = parse(pingSchema, raw);
  const status = statusFor(p.event, p.status);
  const [row] = await query<{ id: number; ping_count: number; started_at: Date; last_seen_at: Date }>(
    `insert into codex_status (member_id, team_id, session_hash, status, last_event, host, codex_version, model, kane_run_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (member_id, session_hash) do update
       set team_id = $2, status = $4, last_event = $5, host = $6,
           codex_version = coalesce($7, codex_status.codex_version),
           model = coalesce($8, codex_status.model),
           kane_run_id = case when $5 in ('kane_run_started', 'kane_run_finished') then $9 else codex_status.kane_run_id end,
           ping_count = codex_status.ping_count + 1, last_seen_at = now()
     returning id, ping_count, started_at, last_seen_at`,
    [memberId, teamId, sha256(`codex-session:${p.session_id}`), status, p.event, p.host, p.codex_version ?? null, p.model ?? null, p.kane_run_id ?? null],
  );
  if (!row) throw new AppError("INTERNAL");
  return { status, event: p.event, pings: row.ping_count, started_at: row.started_at.toISOString(), last_seen_at: row.last_seen_at.toISOString() };
}

type SessionRow = {
  member_id: number;
  status: CodexStatus;
  last_event: string;
  host: string;
  codex_version: string | null;
  model: string | null;
  kane_run_id: string | null;
  started_at: Date;
  last_seen_at: Date;
  online: boolean;
};

export async function teamCodexStatus(teamId: number) {
  const [roster, sessions] = await Promise.all([
    getRoster(teamId),
    query<SessionRow>(
      `select member_id, status, last_event, host, codex_version, model, kane_run_id, started_at, last_seen_at,
              (status <> 'ended' and last_seen_at > now() - make_interval(secs => $2)) as online
         from codex_status where team_id = $1 and last_seen_at > now() - interval '24 hours'
        order by last_seen_at desc`,
      [teamId, ONLINE_SECONDS],
    ),
  ]);
  const members = roster.map((r) => {
    const mine = sessions.filter((s) => s.member_id === r.member_id);
    const latest = mine[0] ?? null;
    return {
      member_id: r.member_id,
      name: r.name,
      public_code: r.public_code,
      role: r.role,
      online: mine.some((s) => s.online),
      status: latest ? (latest.online || latest.status === "ended" ? latest.status : "idle") : null,
      last_event: latest?.last_event ?? null,
      last_seen_at: latest?.last_seen_at.toISOString() ?? null,
      host: latest?.host ?? null,
      codex_version: latest?.codex_version ?? null,
      model: latest?.model ?? null,
      kane_run_id: latest?.kane_run_id ?? null,
      active_sessions: mine.filter((s) => s.online).length,
    };
  });
  return {
    members,
    online: members.filter((m) => m.online).length,
    working: members.filter((m) => m.online && m.status === "working").length,
    waiting_for_human: members.filter((m) => m.online && m.status === "waiting_for_human").length,
    online_window_seconds: ONLINE_SECONDS,
  };
}
