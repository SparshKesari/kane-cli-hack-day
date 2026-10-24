import "server-only";
import { event as copy } from "@/data/hackday";
import { query } from "./db";

// The event's official clock: deadlines and the current phase come from the
// hack_events row and the database's now(), never from copy or the browser.
// hackday.ts stays the source for wording; this is the source for times.

export const PHASES = ["arrival", "build", "verify", "submit", "showtime", "recap"] as const;
export type Phase = (typeof PHASES)[number];

export type LockKind = "team" | "idea" | "submission";

export type HackEvent = {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  startsAt: Date;
  teamLockAt: Date;
  ideaLockAt: Date;
  /** Final evaluation starts: BUILD → VERIFY (2h before the submission lock). */
  verifyAt: Date;
  /** Content hour starts: VERIFY → SUBMIT (1h before the submission lock). */
  submitAt: Date;
  submissionLocksAt: Date;
  demosStartAt: Date;
  endsAt: Date;
  phaseOverride: Phase | null;
  /** Derived from the times, unless phaseOverride is set. */
  phase: Phase;
  phaseSource: "schedule" | "override";
  publicStatus: string;
  isDemo: boolean;
  /** The database's now() when this was read. */
  now: Date;
  /** true when the DB was unreachable and these are hackday.ts defaults. */
  fallback: boolean;
};

type Row = {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  starts_at: Date;
  team_lock_at: Date;
  idea_lock_at: Date;
  submission_locks_at: Date;
  demos_start_at: Date;
  ends_at: Date | null;
  phase_override: Phase | null;
  public_status: string;
  is_demo: boolean;
  now: Date;
};

const HOUR = 3_600_000;

/** Same times as the 005 seed, used only if the database can't be read. */
function defaults(): Row {
  // 2026-10-24 is PDT (UTC-7).
  const at = (hhmm: string) => new Date(`${copy.date}T${hhmm}:00-07:00`);
  return {
    id: 0,
    slug: "kane-cli-hack-day-2026",
    name: copy.name,
    timezone: copy.timezone,
    starts_at: at("09:30"),
    team_lock_at: at("11:00"),
    idea_lock_at: at("12:00"),
    submission_locks_at: at("18:00"),
    demos_start_at: at("18:00"),
    ends_at: at("20:30"),
    phase_override: null,
    public_status: "open",
    is_demo: false,
    now: new Date(),
  };
}

export function derivePhase(now: Date, e: { teamLockAt: Date; verifyAt: Date; submitAt: Date; submissionLocksAt: Date; endsAt: Date }): Phase {
  const t = now.getTime();
  if (t < e.teamLockAt.getTime()) return "arrival";
  if (t < e.verifyAt.getTime()) return "build";
  if (t < e.submitAt.getTime()) return "verify";
  if (t < e.submissionLocksAt.getTime()) return "submit";
  if (t < e.endsAt.getTime()) return "showtime";
  return "recap";
}

function shape(r: Row, fallback: boolean): HackEvent {
  const locks = new Date(r.submission_locks_at);
  const endsAt = r.ends_at ?? new Date(new Date(r.demos_start_at).getTime() + 2.5 * HOUR);
  const base = {
    id: r.id,
    slug: r.slug,
    name: r.name,
    timezone: r.timezone,
    startsAt: new Date(r.starts_at),
    teamLockAt: new Date(r.team_lock_at),
    ideaLockAt: new Date(r.idea_lock_at),
    verifyAt: new Date(locks.getTime() - 2 * HOUR),
    submitAt: new Date(locks.getTime() - HOUR),
    submissionLocksAt: locks,
    demosStartAt: new Date(r.demos_start_at),
    endsAt: new Date(endsAt),
    phaseOverride: r.phase_override,
    publicStatus: r.public_status,
    isDemo: r.is_demo,
    now: new Date(r.now),
    fallback,
  };
  return {
    ...base,
    phase: r.phase_override ?? derivePhase(base.now, base),
    phaseSource: r.phase_override ? "override" : "schedule",
  };
}

/** The current event with its deadlines and phase, read with the DB clock. */
export async function getEvent(): Promise<HackEvent> {
  try {
    const [row] = await query<Row>(
      `select id, slug, name, timezone, starts_at, team_lock_at, idea_lock_at, submission_locks_at,
              demos_start_at, ends_at, phase_override, public_status, is_demo, now() as now
         from hack_events order by id limit 1`,
    );
    return shape(row ?? defaults(), !row);
  } catch (err) {
    console.error("[event] falling back to hackday.ts times", err);
    return shape(defaults(), true);
  }
}

export function lockTime(e: HackEvent, kind: LockKind) {
  return kind === "team" ? e.teamLockAt : kind === "idea" ? e.ideaLockAt : e.submissionLocksAt;
}

/** Milliseconds until a deadline (negative once passed), by the server clock. */
export function msUntil(e: HackEvent, kind: LockKind) {
  return lockTime(e, kind).getTime() - e.now.getTime();
}

/** "6:00 PM PDT" in the event's zone, for deadline copy. */
export function formatEventTime(d: Date, e?: Pick<HackEvent, "timezone">) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: e?.timezone ?? copy.timezone, timeZoneName: "short" }).format(d);
}
