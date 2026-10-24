import "server-only";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { getEvent, PHASES, type HackEvent, type Phase } from "@/lib/event";
import { freshnessOf } from "@/lib/freshness";
import {
  METRICS,
  METRIC_DEFINITION_VERSION,
  METRIC_NAMES,
  type FreshnessState,
  type MetricName,
  type MetricValue,
} from "@/components/live/definitions";
import { AppError, idempotent, parse, serverNow, transaction, withAudit, writeAudit, z, zx, type Actor, type Receipt } from "./core";
import { getStaff, hasRole, requireRole, staffActor, type Staff } from "./auth";

// Mission Control's data (SPEC §9, METRIC_DEFINITIONS.md).
//
// projectLive() computes all 19 metrics straight from the source tables, with
// provenance and sample size, into live_metrics, and derives public feed items
// into live_feed. It runs from /api/cron/metrics and, if that cron is late, lazily
// from the live endpoints (one instance at a time, via an advisory lock).
//
// getLiveSnapshot() is the only thing /live, /api/v1/live/* and the home stats
// strip read. It never computes; it reads the projection, so an outage in the
// source tables holds the last values (with their as_of) instead of showing 0.
//
// Anti-gaming (T-LIVE-10): every count is distinct on a stable id; a Kane run
// only counts when its team owns the project (and its reporter is on that team);
// infra/auth failures are kept apart from product detections; there is no
// per-team volume leaderboard; coverage is never compared across projects.

/** Seconds after which the projection is considered late and the endpoints refresh it. */
const REFRESH_AFTER_SEC = 45;
/** The TV calls a value stale after this (FreshnessStamp: delayed at half, offline at 5×). */
export const STALE_AFTER_SEC = 120;
/** One public feed item per team per this window (anti-gaming, ticker cap). */
const FEED_WINDOW_MIN = 10;

/** Production never renders demo rows; staging shows them with a DemoDataChip. */
export function isProductionDeploy() {
  return process.env.VERCEL_ENV === "production" || process.env.HACKOS_ENV === "production";
}

/** The private Ops TV (help queue ages, incidents) is for organizers and mentors. */
export async function getOpsViewer(): Promise<Staff | null> {
  const staff = await getStaff();
  return hasRole(staff, "organizer", "mentor") ? staff : null;
}

/** Throws UNAUTHENTICATED / FORBIDDEN unless the caller may see the Ops TV. */
export async function requireOpsViewer(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) throw new AppError("UNAUTHENTICATED", { userMessage: "Staff sign-in required for the Ops TV." });
  if (!hasRole(staff, "organizer", "mentor")) throw new AppError("FORBIDDEN");
  return staff;
}

// ── Projection ───────────────────────────────────────────────────────────────

type Computed = { name: MetricName; value: number | null; denominator?: number | null; sample_n?: number | null; breakdown?: Record<string, number | string | null> };

// Runs that may count at all: terminal, for this event, and authored by the
// team that owns the project (reporter, if known, was on that team).
const VALID_RUNS = `
  valid_runs as (
    select r.*, (r.source_verified or r.verification_state = 'verified') as verified,
           coalesce(r.finished_at, r.received_at) as done_at
      from kane_runs r
      join projects p on p.id = r.project_id and p.team_id = r.team_id
     where r.event_id = $1
       and r.has_terminal_event
       and r.status <> 'running'
       and (r.member_id is null
            or exists (select 1 from team_memberships tm
                        where tm.member_id = r.member_id and tm.team_id = r.team_id
                          and tm.joined_at <= coalesce(r.finished_at, r.received_at)
                          and (tm.left_at is null or tm.left_at >= coalesce(r.started_at, r.received_at)))
            or exists (select 1 from members m where m.id = r.member_id and m.team_id = r.team_id))
  )`;

/** Verified run endings per bucket for /dashboard; bucket 0 ends at `now`. */
export async function readRunBuckets(eventId: number, now: Date, bucketMinutes: number, buckets: number): Promise<{ b: number; n: string }[]> {
  return query<{ b: number; n: string }>(
    `with ${VALID_RUNS}
     select floor(extract(epoch from ($2::timestamptz - done_at)) / ($3::int * 60))::int as b, count(*) as n
       from valid_runs
      where verified and done_at > $2::timestamptz - make_interval(mins => $3::int * $4::int) and done_at <= $2::timestamptz
      group by 1`,
    [eventId, now, bucketMinutes, buckets],
  );
}

const num = (v: unknown) => (v == null ? null : Number(v));

type Q = Pick<PoolClient, "query">;

async function one<T extends Record<string, unknown>>(db: Q, sql: string, params: unknown[]): Promise<T> {
  const { rows } = await db.query(sql, params);
  return (rows[0] ?? {}) as T;
}

/** Each metric's query. Kept separate so one failing table only holds that metric. */
const COMPUTE: Record<MetricName, (db: Q, e: HackEvent, prev: Map<MetricName, Computed>) => Promise<Computed>> = {
  async participants_registered(db, e) {
    const r = await one(db, "select count(*) as value from members where event_id = $1 and deleted_at is null and role = 'participant'", [e.id]);
    return { name: "participants_registered", value: num(r.value), denominator: null };
  },

  async participants_checked_in(db, e) {
    const r = await one(
      db,
      `select count(*) filter (where checked_in_at is not null) as value,
              count(*) as admitted,
              count(*) filter (where checked_in_at is not null and source = 'walk_in') as walk_ins,
              count(*) filter (where checked_in_at is not null and source = 'luma_csv') as luma,
              count(*) filter (where checked_in_at is not null and source = 'manual_offline') as paper
         from roster_guests
        where event_id = $1 and admission_status = 'admitted' and approval_status in ('approved', 'walk_in')`,
      [e.id],
    );
    return {
      name: "participants_checked_in",
      value: num(r.value),
      denominator: num(r.admitted),
      breakdown: { walk_ins: num(r.walk_ins), luma: num(r.luma), manual_offline: num(r.paper) },
    };
  },

  async participants_activated(db, e, prev) {
    // The three /activate steps all done stamps members.activated_at (event-activation.ts).
    const r = await one(
      db,
      `select count(*) as value,
              count(*) filter (where exists (select 1 from testmu_plan_claims c where c.member_id = m.id and c.status = 'claimed')) as plan_claimed
         from members m
        where m.event_id = $1 and m.deleted_at is null and m.role = 'participant' and m.activated_at is not null`,
      [e.id],
    );
    return {
      name: "participants_activated",
      value: num(r.value),
      denominator: prev.get("participants_registered")?.value ?? null,
      breakdown: { plan_claimed: num(r.plan_claimed) },
    };
  },

  async teams_active(db, e) {
    const r = await one(
      db,
      `select count(*) filter (where t.state in ('formed', 'active', 'roster_locked', 'submitted')) as value,
              count(*) filter (where t.state = 'recruiting') as recruiting
         from teams t
        where t.event_id = $1
          and exists (select 1 from team_memberships tm join members m on m.id = tm.member_id and m.deleted_at is null
                       where tm.team_id = t.id and tm.left_at is null)`,
      [e.id],
    );
    return { name: "teams_active", value: num(r.value), breakdown: { recruiting: num(r.recruiting) } };
  },

  async teams_verified(db, e, prev) {
    const r = await one(db, `with ${VALID_RUNS} select count(distinct team_id) as value from valid_runs where status = 'passed' and verified`, [e.id]);
    return { name: "teams_verified", value: num(r.value), denominator: prev.get("teams_active")?.value ?? null };
  },

  async kane_executions(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(*) filter (where verified) as value,
              count(*) filter (where verified and status = 'passed') as passed,
              count(*) filter (where verified and status = 'failed') as failed,
              count(*) filter (where verified and status in ('blocked', 'errored')) as errored_or_blocked,
              count(*) filter (where verified and status = 'cancelled') as cancelled,
              count(*) filter (where not verified) as reported_unverified
         from valid_runs`,
      [e.id],
    );
    return {
      name: "kane_executions",
      value: num(r.value),
      breakdown: {
        passed: num(r.passed),
        failed: num(r.failed),
        errored_or_blocked: num(r.errored_or_blocked),
        cancelled: num(r.cancelled),
        reported_unverified: num(r.reported_unverified),
      },
    };
  },

  async builds_validated(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(distinct coalesce(rl.repo_id, lower(rl.repo_full_name)) || '@' || r.commit_sha) as value,
              count(distinct r.project_id) as projects
         from valid_runs r
         join repository_links rl on rl.project_id = r.project_id
        where r.status = 'passed' and r.verified and r.commit_sha ~ '^[0-9a-f]{40}$'`,
      [e.id],
    );
    return { name: "builds_validated", value: num(r.value), sample_n: num(r.projects) };
  },

  async test_members_executed(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(*) filter (where km.status in ('passed', 'failed')) as value,
              count(distinct km.test_definition_hash) filter (where km.status in ('passed', 'failed')) as unique_definitions,
              count(*) filter (where km.status not in ('passed', 'failed')) as not_executed
         from kane_test_members km
         join valid_runs r on r.id = km.run_id and r.verified`,
      [e.id],
    );
    return {
      name: "test_members_executed",
      value: num(r.value),
      breakdown: { unique_definitions: num(r.unique_definitions), skipped_blocked_or_errored: num(r.not_executed) },
    };
  },

  async bugs_detected(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(*) filter (where d.failure_class in ('product', 'unknown')) as value,
              count(*) filter (where d.failure_class in ('infra', 'auth')) as infra_or_auth,
              count(*) filter (where d.status = 'not_a_bug') as dismissed
         from defects d
         join valid_runs r on r.id = d.source_run_id and r.status <> 'passed'`,
      [e.id],
    );
    return {
      name: "bugs_detected",
      value: num(r.value),
      breakdown: { infra_or_auth_set_aside: num(r.infra_or_auth), later_dismissed: num(r.dismissed) },
    };
  },

  async bugs_confirmed(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(*) as value
         from defects d
         join valid_runs r on r.id = d.source_run_id
        where d.status in ('confirmed', 'fixed', 'reverified') and d.failure_class = 'product' and d.confirmed_at is not null`,
      [e.id],
    );
    return { name: "bugs_confirmed", value: num(r.value) };
  },

  async fixed_and_reverified(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(*) as value
         from defects d
         join valid_runs src on src.id = d.source_run_id
        where d.status in ('confirmed', 'fixed', 'reverified') and d.failure_class = 'product' and d.confirmed_at is not null
          and exists (select 1 from defect_verifications v
                        join valid_runs fix on fix.id = v.run_id
                       where v.defect_id = d.id and v.result = 'passed'
                         and fix.status = 'passed' and fix.verified and fix.commit_sha is not null
                         and fix.done_at > src.done_at
                         and fix.commit_sha is distinct from src.commit_sha)`,
      [e.id],
    );
    return { name: "fixed_and_reverified", value: num(r.value) };
  },

  async evidence_packs(db, e) {
    const r = await one(
      db,
      `select count(distinct ea.sha256) as value
         from evidence_artifacts ea
         join projects p on p.id = ea.project_id and p.event_id = $1
        where ea.verified_at is not null and ea.redaction_state <> 'quarantined'
          and ea.kind in ('zip', 'ndjson', 'report', 'testmd')`,
      [e.id],
    );
    return { name: "evidence_packs", value: num(r.value) };
  },

  async coverage(db, e) {
    // A count of projects with a valid graph. The percentages themselves are
    // only ever read per project (getProjectCoverage), never aggregated.
    const r = await one(
      db,
      `with ${VALID_RUNS}
       select count(distinct project_id) as value
         from valid_runs
        where verified and evidence_artifact_id is not null
          and jsonb_typeof(summary -> 'coverage' -> 'designed') = 'number'
          and jsonb_typeof(summary -> 'coverage' -> 'proven') = 'number'`,
      [e.id],
    );
    return { name: "coverage", value: num(r.value), breakdown: { scope: "per_team_only" } };
  },

  async median_time_to_proof(db, e) {
    const r = await one(
      db,
      `with ${VALID_RUNS},
       pushes as (
         select team_id, sha, min(pushed_at) as pushed_at from (
           select a.team_id, lower(a.payload ->> 'commit_sha') as sha, a.occurred_at as pushed_at
             from activity a
            where a.event_id = $1 and a.source = 'github' and a.team_id is not null and a.payload ? 'commit_sha'
           union all
           select p.team_id, lower(rl.last_commit_sha), rl.last_push_at
             from repository_links rl join projects p on p.id = rl.project_id and p.event_id = $1
            where rl.last_commit_sha is not null and rl.last_push_at is not null
         ) x group by team_id, sha
       ),
       proofs as (
         select team_id, lower(commit_sha) as sha, min(done_at) as proved_at
           from valid_runs where status = 'passed' and verified and commit_sha is not null
          group by team_id, lower(commit_sha)
       ),
       pairs as (
         select extract(epoch from pr.proved_at - pu.pushed_at) as secs
           from pushes pu join proofs pr using (team_id, sha)
          where pr.proved_at > pu.pushed_at and pr.proved_at - pu.pushed_at < interval '12 hours'
       )
       select percentile_cont(0.5) within group (order by secs) as value, count(*) as n from pairs`,
      [e.id],
    );
    return { name: "median_time_to_proof", value: num(r.value), sample_n: num(r.n) };
  },

  async help_open(db, e) {
    const r = await one(
      db,
      `select count(*) as value,
              count(*) filter (where status in ('new', 'triaged')) as waiting,
              count(*) filter (where status in ('claimed', 'in_progress')) as with_mentor,
              count(*) filter (where status = 'escalated') as escalated
         from help_tickets
        where event_id = $1 and status in ('new', 'triaged', 'claimed', 'in_progress', 'escalated')`,
      [e.id],
    );
    return {
      name: "help_open",
      value: num(r.value),
      breakdown: { waiting: num(r.waiting), with_mentor: num(r.with_mentor), escalated: num(r.escalated) },
    };
  },

  async help_median_claim_seconds(db, e) {
    const r = await one(
      db,
      `select percentile_cont(0.5) within group (order by secs) as value, count(*) as n from (
         select extract(epoch from claimed_at - coalesce(paper_original_at, created_at)) as secs
           from help_tickets
          where event_id = $1 and claimed_at is not null and status <> 'duplicate'
       ) x where secs >= 0`,
      [e.id],
    );
    return { name: "help_median_claim_seconds", value: num(r.value), sample_n: num(r.n) };
  },

  async help_median_resolution_seconds(db, e) {
    const r = await one(
      db,
      `select percentile_cont(0.5) within group (order by secs) as value, count(*) as n from (
         select extract(epoch from resolved_at - coalesce(paper_original_at, created_at)) as secs
           from help_tickets
          where event_id = $1 and resolved_at is not null and status <> 'duplicate'
       ) x where secs >= 0`,
      [e.id],
    );
    return { name: "help_median_resolution_seconds", value: num(r.value), sample_n: num(r.n) };
  },

  async submissions_finalized(db, e, prev) {
    const r = await one(
      db,
      `select count(distinct team_id) as value,
              count(distinct team_id) filter (where source = 'manual_offline') as manual_offline,
              count(distinct team_id) filter (where status = 'organizer_exception') as exceptions
         from submissions
        where event_id = $1 and receipt_code is not null
          and ((status in ('finalized', 'locked') and finalized_at is not null and finalized_at <= $2)
               or (source = 'manual_offline' and received_at is not null and received_at <= $2)
               or status = 'organizer_exception')`,
      [e.id, e.submissionLocksAt],
    );
    return {
      name: "submissions_finalized",
      value: num(r.value),
      denominator: prev.get("teams_active")?.value ?? null,
      breakdown: { manual_offline: num(r.manual_offline), organizer_exceptions: num(r.exceptions) },
    };
  },

  async photographs_published(db) {
    const r = await one(db, `select count(distinct photo_key) as value from event_photos where status = 'published'`, []);
    return { name: "photographs_published", value: num(r.value) };
  },

  async team_spotlights(db, e) {
    const r = await one(
      db,
      `select count(*) as value from projects p
        where p.event_id = $1 and p.showcase_state = 'public'
          and exists (select 1 from published_assets pa where pa.project_id = p.id and pa.kind = 'ship_page' and pa.state = 'public')`,
      [e.id],
    );
    return { name: "team_spotlights", value: num(r.value) };
  },
};

/**
 * Derive public feed items (T-LIVE-09). Only public-visibility activity, and
 * facts about projects whose showcase is public. Titles are built here from
 * team/project names, never from run objectives or logs.
 */
async function projectFeed(db: Q, e: HackEvent) {
  const demo = e.isDemo;
  // 1. Activity the writer marked public. Invalid signatures never show.
  await db.query(
    `insert into live_feed (event_id, team_id, kind, status, title, detail, href, source_activity_id, is_demo, occurred_at)
     select a.event_id, a.team_id, coalesce(a.type, 'activity'),
            case when coalesce(a.type, a.action) ~* '(fail|detect|regress|error)' then 'detected'
                 when coalesce(a.type, a.action) ~* '(pass|proof|verif|fixed)' and (a.signature_status = 'verified' or a.evidence_ref is not null) then 'proof'
                 when coalesce(a.type, a.action) ~* '(link|commit|push|github|publish|submit)' then 'linked'
                 else 'info' end,
            left(coalesce(p.name, t.name) || ': ' || coalesce(a.payload ->> 'public_title', a.action), 160),
            left(a.payload ->> 'public_detail', 240),
            case when p.showcase_state = 'public' then '/ship/' || p.slug end,
            a.id, $2, a.occurred_at
       from activity a
       join teams t on t.id = a.team_id
       left join projects p on p.team_id = t.id
      where a.event_id = $1 and a.visibility = 'public' and a.signature_status <> 'invalid'
        and a.occurred_at > now() - interval '24 hours'
     on conflict do nothing`,
    [e.id, demo],
  );
  // 2. Verified Kane outcomes on public projects. A failure is a detection, never a bug.
  await db.query(
    `with ${VALID_RUNS}
     insert into live_feed (event_id, team_id, kind, status, title, detail, href, source_key, is_demo, occurred_at)
     select $1, r.team_id,
            case when r.status = 'passed' then 'kane_run_passed' else 'kane_run_detected' end,
            case when r.status = 'passed' then 'proof' else 'detected' end,
            left(p.name || case when r.status = 'passed' then ' passed a Kane verification' else ' — Kane flagged a candidate issue' end, 160),
            case when r.status = 'passed' and r.evidence_artifact_id is not null then 'Evidence reference attached'
                 when r.status = 'passed' then 'Source-verified run'
                 else 'Suspected · not a confirmed bug until reviewed' end,
            '/ship/' || p.slug, 'kane_run:' || r.id, $2, r.done_at
       from valid_runs r
       join projects p on p.id = r.project_id and p.showcase_state = 'public'
      where r.verified and r.status in ('passed', 'failed') and r.done_at > now() - interval '24 hours'
     on conflict do nothing`,
    [e.id, demo],
  );
  // 3. Closed loops: the same rule as fixed_and_reverified (a later verified
  //    passing run on a different commit than the one that detected it).
  await db.query(
    `with ${VALID_RUNS}
     insert into live_feed (event_id, team_id, kind, status, title, detail, href, source_key, is_demo, occurred_at)
     select $1, p.team_id, 'defect_reverified', 'proof',
            left(p.name || ' closed a verification loop', 160),
            'Earlier failure fixed and reverified against a new revision',
            '/ship/' || p.slug, 'reverified:' || d.id, $2, min(fix.done_at)
       from defects d
       join projects p on p.id = d.project_id and p.event_id = $1 and p.showcase_state = 'public'
       join valid_runs src on src.id = d.source_run_id
       join defect_verifications v on v.defect_id = d.id and v.result = 'passed'
       join valid_runs fix on fix.id = v.run_id and fix.status = 'passed' and fix.verified and fix.commit_sha is not null
                           and fix.done_at > src.done_at and fix.commit_sha is distinct from src.commit_sha
      where d.status in ('confirmed', 'fixed', 'reverified') and d.confirmed_at is not null and d.failure_class = 'product'
      group by p.team_id, p.name, p.slug, d.id
     on conflict do nothing`,
    [e.id, demo],
  );
  // 4. Ship pages going public.
  await db.query(
    `insert into live_feed (event_id, team_id, kind, status, title, detail, href, source_key, is_demo, occurred_at)
     select $1, p.team_id, 'ship_page_published', 'linked',
            left(p.name || ' published its ship page', 160), 'Product × Proof showcase is live',
            '/ship/' || p.slug, 'ship:' || p.id, $2, min(pa.published_at)
       from projects p
       join published_assets pa on pa.project_id = p.id and pa.kind = 'ship_page' and pa.state = 'public'
      where p.event_id = $1 and p.showcase_state = 'public'
      group by p.id, p.team_id, p.name, p.slug
     on conflict do nothing`,
    [e.id, demo],
  );
}

export type ProjectionResult = { ran: boolean; written: MetricName[]; failed: { name: string; error: string }[]; as_of: string | null };

/**
 * Recompute every metric and the feed. One instance at a time (advisory lock);
 * a metric whose query fails keeps its previous value and as_of, so the TV
 * shows it as held/stale rather than 0. Returns ran:false if another instance
 * holds the lock.
 */
export async function projectLive(): Promise<ProjectionResult> {
  const e = await getEvent();
  if (e.fallback) throw new AppError("DOWNSTREAM_DEGRADED", { message: "event row unreadable; projection skipped" });
  const failed: ProjectionResult["failed"] = [];
  let out: ProjectionResult;
  try {
    out = await transaction(async (tx) => {
      const { rows } = await tx.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(hashtext('hackos:live_projection')) as ok");
      if (!rows[0]?.ok) return { ran: false, written: [], failed: [], as_of: null };

      const done = new Map<MetricName, Computed>();
      for (const name of METRIC_NAMES) {
        await tx.query("savepoint metric");
        try {
          const c = await COMPUTE[name](tx, e, done);
          await tx.query(
            `insert into live_metrics (event_id, name, value, denominator, sample_n, source, definition_version, as_of, freshness, is_demo, breakdown)
             values ($1, $2, $3, $4, $5, $6, $7, now(), 'fresh', $8, $9)
             on conflict (event_id, name) do update set
               value = excluded.value, denominator = excluded.denominator, sample_n = excluded.sample_n,
               source = excluded.source, definition_version = excluded.definition_version, as_of = now(),
               freshness = 'fresh', is_demo = excluded.is_demo, breakdown = excluded.breakdown`,
            [
              e.id,
              name,
              // live_metrics.value is not null: an unknown median is stored as 0 with sample_n 0
              // and read back as null (definitions.displayValue / readMetrics).
              c.value ?? 0,
              c.denominator ?? null,
              c.sample_n ?? (c.value == null ? 0 : null),
              METRICS[name].source,
              METRIC_DEFINITION_VERSION,
              e.isDemo,
              JSON.stringify(c.breakdown ?? {}),
            ],
          );
          await tx.query("release savepoint metric");
          done.set(name, c);
        } catch (err) {
          await tx.query("rollback to savepoint metric");
          failed.push({ name, error: (err as { code?: string; message?: string }).code ?? "error" });
          console.error(`[live] metric ${name} failed`, err);
        }
      }

      await tx.query("savepoint feed");
      try {
        await projectFeed(tx, e);
        await tx.query("release savepoint feed");
      } catch (err) {
        await tx.query("rollback to savepoint feed");
        failed.push({ name: "live_feed", error: (err as { code?: string }).code ?? "error" });
        console.error("[live] feed projection failed", err);
      }

      const status = failed.length === 0 ? "ok" : done.size > 0 ? "degraded" : "down";
      await tx.query(
        `update integration_state set status = $1, detail = $2, updated_at = now(),
                last_success_at = case when $1 <> 'down' then now() else last_success_at end,
                last_error_at = case when $1 <> 'ok' then now() else last_error_at end,
                last_error_code = case when $1 <> 'ok' then $3 else last_error_code end
          where system = 'live_metrics' and event_id = $4`,
        [status, `${done.size}/${METRIC_NAMES.length} metrics projected`, failed[0]?.error ?? null, e.id],
      );
      const [now] = (await tx.query<{ now: Date }>("select now() as now")).rows;
      return { ran: true, written: [...done.keys()], failed, as_of: now.now.toISOString() };
    });
  } catch (err) {
    await query(
      `update integration_state set status = 'down', last_error_at = now(), last_error_code = $1, updated_at = now() where system = 'live_metrics'`,
      [(err as { code?: string }).code ?? "error"],
    ).catch(() => {});
    throw err;
  }
  snapshotCache.clear();
  return out;
}

let lastLazyAttempt = 0;

/** If the projection is older than REFRESH_AFTER_SEC, refresh it (at most every 20s per instance). Never throws. */
export async function ensureFresh() {
  if (Date.now() - lastLazyAttempt < 20_000) return; // throttle only; not a deadline decision
  lastLazyAttempt = Date.now();
  try {
    const [row] = await query<{ age: number | null }>(
      "select extract(epoch from now() - max(as_of))::float as age from live_metrics where event_id = (select id from hack_events order by id limit 1)",
    );
    if (row?.age != null && row.age < REFRESH_AFTER_SEC) return;
    await projectLive();
  } catch (err) {
    console.error("[live] lazy projection skipped", err);
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

type MetricRow = {
  name: string;
  value: string;
  denominator: string | null;
  sample_n: number | null;
  source: string;
  definition_version: string;
  as_of: Date;
  is_demo: boolean;
  breakdown: Record<string, number | string | null> | null;
};

/** Every metric with its freshness. Missing rows come back as unknown (value null), never 0. */
export async function readMetrics(opts: { ops?: boolean; now?: Date } = {}): Promise<{ metrics: Partial<Record<MetricName, MetricValue>>; as_of: string | null; freshness_state: FreshnessState; demo_shown: boolean }> {
  const production = isProductionDeploy();
  const rows = await query<MetricRow & { now: Date }>(
    `select name, value::text, denominator::text, sample_n, source, definition_version, as_of, is_demo, breakdown, now() as now
       from live_metrics where event_id = (select id from hack_events order by id limit 1)`,
  );
  const now = opts.now ?? rows[0]?.now ?? new Date();
  const byName = new Map(rows.map((r) => [r.name, r]));
  const metrics: Partial<Record<MetricName, MetricValue>> = {};
  let oldest: Date | null = null;
  let demoShown = false;
  for (const name of METRIC_NAMES) {
    const def = METRICS[name];
    if (def.audience === "ops" && !opts.ops) continue;
    const r = byName.get(name);
    if (!r) {
      metrics[name] = { name, value: null, denominator: null, sample_n: null, source: def.source, definition_version: METRIC_DEFINITION_VERSION, as_of: null, freshness: "offline", is_demo: false, withheld: false, breakdown: {} };
      continue;
    }
    const withheld = r.is_demo && production;
    if (r.is_demo && !production) demoShown = true;
    const asOf = new Date(r.as_of);
    if (!withheld && (!oldest || asOf < oldest)) oldest = asOf;
    const unknownMedian = def.median && !r.sample_n;
    metrics[name] = {
      name,
      value: withheld || unknownMedian ? null : Number(r.value),
      denominator: withheld || r.denominator == null ? null : Number(r.denominator),
      sample_n: withheld ? null : r.sample_n,
      source: r.source,
      definition_version: r.definition_version,
      as_of: asOf.toISOString(),
      freshness: freshnessOf(asOf, now, STALE_AFTER_SEC),
      is_demo: r.is_demo,
      withheld,
      breakdown: withheld ? {} : (r.breakdown ?? {}),
    };
  }
  return {
    metrics,
    as_of: oldest ? oldest.toISOString() : null,
    freshness_state: oldest ? freshnessOf(oldest, now, STALE_AFTER_SEC) : "offline",
    demo_shown: demoShown,
  };
}

/** Per-project designed vs proven coverage (never aggregated). For the team proof page and ship page. */
export async function getProjectCoverage(projectId: number): Promise<{ designed: number; proven: number; run_id: number; as_of: string } | null> {
  const [r] = await query<{ designed: number; proven: number; id: number; done_at: Date }>(
    `select (summary -> 'coverage' ->> 'designed')::float as designed, (summary -> 'coverage' ->> 'proven')::float as proven,
            id, coalesce(finished_at, received_at) as done_at
       from kane_runs
      where project_id = $1 and (source_verified or verification_state = 'verified') and has_terminal_event
        and evidence_artifact_id is not null
        and jsonb_typeof(summary -> 'coverage' -> 'designed') = 'number' and jsonb_typeof(summary -> 'coverage' -> 'proven') = 'number'
      order by coalesce(finished_at, received_at) desc limit 1`,
    [projectId],
  );
  return r ? { designed: r.designed, proven: r.proven, run_id: r.id, as_of: new Date(r.done_at).toISOString() } : null;
}

export type FeedItem = { id: number; team: string | null; status: "proof" | "detected" | "linked" | "info"; kind: string; title: string; detail: string | null; href: string | null; at: string; is_demo: boolean };

/**
 * Public feed, newest first, capped to one item per team per FEED_WINDOW_MIN
 * (a proof beats a detection within the window). `afterId` returns only newer
 * rows, for SSE resume.
 */
export async function readFeed(opts: { limit?: number; afterId?: number } = {}): Promise<FeedItem[]> {
  const production = isProductionDeploy();
  const rows = await query<{ id: number; team_id: number | null; team: string | null; status: FeedItem["status"]; kind: string; title: string; detail: string | null; href: string | null; occurred_at: Date; is_demo: boolean }>(
    `select f.id, f.team_id, t.name as team, f.status, f.kind, f.title, f.detail, f.href, f.occurred_at, f.is_demo
       from live_feed f left join teams t on t.id = f.team_id
      where f.event_id = (select id from hack_events order by id limit 1)
        and f.id > $1 and ($2::boolean = false or f.is_demo = false)
        and f.occurred_at > now() - interval '24 hours'
        -- Project items follow the project's *current* visibility: a page an
        -- organizer hid, or a team switched off, drops out of /live too.
        and (f.href is null or f.href not like '/ship/%'
             or exists (select 1 from projects p where p.team_id = f.team_id and p.showcase_state = 'public'))
      order by f.occurred_at desc, f.id desc
      limit 200`,
    [opts.afterId ?? 0, production],
  );
  const rank = { proof: 0, linked: 1, detected: 2, info: 3 } as const;
  const kept: typeof rows = [];
  const lastByTeam = new Map<number, (typeof rows)[number]>();
  const windowMs = FEED_WINDOW_MIN * 60_000;
  for (const r of rows) {
    if (r.team_id == null) {
      kept.push(r);
      continue;
    }
    const prev = lastByTeam.get(r.team_id);
    if (prev && Math.abs(new Date(prev.occurred_at).getTime() - new Date(r.occurred_at).getTime()) < windowMs) {
      // Same team inside the window: keep the stronger signal only.
      if (rank[r.status] < rank[prev.status]) {
        kept[kept.indexOf(prev)] = r;
        lastByTeam.set(r.team_id, r);
      }
      continue;
    }
    kept.push(r);
    lastByTeam.set(r.team_id, r);
  }
  return kept.slice(0, opts.limit ?? 12).map((r) => ({
    id: r.id,
    team: r.team,
    status: r.status,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    href: r.href,
    at: new Date(r.occurred_at).toISOString(),
    is_demo: r.is_demo,
  }));
}

// ── Snapshot (what the TV renders) ───────────────────────────────────────────

export type LiveBanner = { state: "delayed" | "stale" | "degraded" | "offline" | "down"; system: string; detail: string };
export type ShowcaseCard = { slug: string; name: string; team: string; summary: string | null; project_type: string; ship_page: boolean; submitted: boolean };
export type Announcement = { id: number; title: string; body: string; href: string | null; at: string };

export type LiveSnapshot = {
  server_time: string;
  as_of: string | null;
  freshness_state: FreshnessState;
  event: {
    name: string;
    timezone: string;
    phase: Phase;
    phase_source: "schedule" | "override";
    starts_at: string;
    team_lock_at: string;
    submission_locks_at: string;
    demos_start_at: string;
    ends_at: string;
    is_demo: boolean;
    fallback: boolean;
  };
  metrics: Partial<Record<MetricName, MetricValue>>;
  banners: LiveBanner[];
  announcements: Announcement[];
  feed: FeedItem[];
  /** Max live_feed id included; the SSE event id. */
  feed_cursor: number;
  showcase: ShowcaseCard[];
  recruiting: { name: string; open_seats: number }[];
  demo_shown: boolean;
  ops: OpsBoard | null;
};

export type OpsBoard = {
  help: { code: string; category: string; table: string | null; status: string; priority: string; age_s: number; claim_wait_s: number | null; mentor: string | null }[];
  incidents: { code: string; subsystem: string; severity: string; description: string; age_s: number }[];
  integrations: { system: string; status: string; detail: string | null; paused: boolean; last_success_at: string | null }[];
};

// Systems whose trouble changes what the public TV can claim.
const PUBLIC_SYSTEMS: Record<string, string> = {
  live_metrics: "Live metrics",
  database: "Event database",
  kane_ingest: "Kane run ingest",
  live_stream: "Live stream",
};

const snapshotCache = new Map<string, { at: number; snap: LiveSnapshot }>();

/** Everything /live needs, from the projection. Cached 4s per instance (TVs poll; SSE fans out). */
/** Last successfully read metrics per board, held through a failed read (per instance). */
const lastGoodMetrics = new Map<string, { metrics: LiveSnapshot["metrics"]; as_of: string | null }>();

export async function getLiveSnapshot(opts: { ops?: boolean } = {}): Promise<LiveSnapshot> {
  const key = opts.ops ? "ops" : "public";
  const hit = snapshotCache.get(key);
  if (hit && Date.now() - hit.at < 4_000) return hit.snap;
  await ensureFresh();

  const e = await getEvent();
  const production = isProductionDeploy();
  const settle = <T,>(p: Promise<T>, fallback: T) => p.catch((err) => (console.error("[live] snapshot part failed", err), fallback));

  const [m, integrations, announcements, feed, showcase, recruiting, ops] = await Promise.all([
    settle(readMetrics({ ops: opts.ops, now: e.now }), null),
    settle(
      query<{ system: string; status: string; detail: string | null; paused: boolean; last_success_at: Date | null }>(
        "select system, status, detail, paused, last_success_at from integration_state where event_id = $1 order by system",
        [e.id],
      ),
      [],
    ),
    settle(
      query<{ id: number; title: string; body: string; href: string | null; send_at: Date }>(
        `select id, title, body, href, send_at from notifications
          where kind = 'announcement' and visibility in ('tv', 'both') and team_id is null and send_at <= now()
          order by send_at desc limit 5`,
      ),
      [],
    ),
    settle(readFeed({ limit: 12 }), []),
    settle(
      query<ShowcaseCard & { finalized_at: Date | null }>(
        `select p.slug, p.name, t.name as team, p.summary, p.project_type,
                exists (select 1 from published_assets pa where pa.project_id = p.id and pa.kind = 'ship_page' and pa.state = 'public') as ship_page,
                exists (select 1 from submissions s where s.project_id = p.id and s.receipt_code is not null
                          and s.status in ('finalized', 'locked', 'organizer_exception')) as submitted,
                (select min(s.finalized_at) from submissions s where s.project_id = p.id) as finalized_at
           from projects p join teams t on t.id = p.team_id
          where p.event_id = $1 and p.showcase_state = 'public'
          order by finalized_at nulls last, p.name
          limit 60`,
        [e.id],
      ),
      [],
    ),
    settle(
      query<{ name: string; open_seats: number }>(
        `select t.name, (t.max_size - count(tm.id))::int as open_seats
           from teams t left join team_memberships tm on tm.team_id = t.id and tm.left_at is null
          where t.event_id = $1 and t.recruiting_open and t.state in ('recruiting', 'formed', 'active')
          group by t.id having t.max_size - count(tm.id) > 0
          order by t.created_at limit 12`,
        [e.id],
      ),
      [],
    ),
    opts.ops ? settle(readOpsBoard(e), null) : Promise.resolve(null),
  ]);

  const banners: LiveBanner[] = [];
  for (const s of integrations) {
    const label = PUBLIC_SYSTEMS[s.system];
    if (!label && !opts.ops) continue;
    if (s.status === "ok" || s.status === "unknown") continue;
    const state: LiveBanner["state"] = s.status === "down" ? "offline" : "delayed";
    banners.push({ state, system: label ?? s.system, detail: s.paused ? "Paused by an organizer." : "Numbers may lag; last values are held." });
  }
  // Hold the last good values when the read fails (never reset tiles to "—" or 0).
  const held = !m ? lastGoodMetrics.get(key) : undefined;
  if (m) lastGoodMetrics.set(key, { metrics: m.metrics, as_of: m.as_of });
  if (!m) banners.unshift({ state: "offline", system: "Live metrics", detail: held ? "Can't read the projection. Showing the last values received." : "Can't read the projection yet." });
  else if (m.freshness_state !== "fresh" && m.as_of) {
    banners.unshift({ state: m.freshness_state === "offline" ? "offline" : m.freshness_state, system: "Live metrics", detail: "Holding the last values; they are not reset to zero." });
  }

  const snap: LiveSnapshot = {
    server_time: e.now.toISOString(),
    as_of: m?.as_of ?? held?.as_of ?? null,
    freshness_state: m?.freshness_state ?? "offline",
    event: {
      name: e.name,
      timezone: e.timezone,
      phase: e.phase,
      phase_source: e.phaseSource,
      starts_at: e.startsAt.toISOString(),
      team_lock_at: e.teamLockAt.toISOString(),
      submission_locks_at: e.submissionLocksAt.toISOString(),
      demos_start_at: e.demosStartAt.toISOString(),
      ends_at: e.endsAt.toISOString(),
      is_demo: e.isDemo,
      fallback: e.fallback,
    },
    metrics: m?.metrics ?? held?.metrics ?? {},
    // One banner per system: the freshness banner (first) wins over integration_state.
    banners: banners.filter((b, i) => banners.findIndex((x) => x.system === b.system) === i),
    announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, href: a.href, at: new Date(a.send_at).toISOString() })),
    feed,
    feed_cursor: feed.reduce((mx, f) => Math.max(mx, f.id), 0),
    showcase: showcase.map((s) => ({ slug: s.slug, name: s.name, team: s.team, summary: s.summary, project_type: s.project_type, ship_page: s.ship_page, submitted: s.submitted })),
    recruiting,
    demo_shown: (m?.demo_shown ?? false) || (!production && e.isDemo) || feed.some((f) => f.is_demo),
    ops,
  };
  if (e.fallback) snap.banners.unshift({ state: "offline", system: "Event database", detail: "Using the published schedule; live numbers are held." });
  // A snapshot whose metrics read failed isn't cached, so the next poll retries.
  if (m) snapshotCache.set(key, { at: Date.now(), snap });
  return snap;
}

async function readOpsBoard(e: HackEvent): Promise<OpsBoard> {
  const [help, incidents, integrations] = await Promise.all([
    query<{ code: string; category: string; table_label: string | null; status: string; priority: string; age_s: number; claim_wait_s: number | null; mentor: string | null }>(
      `select h.code, h.category, h.table_label, h.status, h.priority,
              extract(epoch from now() - coalesce(h.paper_original_at, h.created_at))::int as age_s,
              case when h.claimed_at is not null then extract(epoch from h.claimed_at - coalesce(h.paper_original_at, h.created_at))::int end as claim_wait_s,
              s.name as mentor
         from help_tickets h left join staff_accounts s on s.id = h.assigned_mentor_id
        where h.event_id = $1 and h.status in ('new', 'triaged', 'claimed', 'in_progress', 'escalated')
        order by (h.status in ('new', 'triaged')) desc, h.priority = 'urgent' desc, h.created_at
        limit 40`,
      [e.id],
    ).catch(() => []),
    query<{ code: string; subsystem: string; severity: string; description: string; age_s: number }>(
      `select code, subsystem, severity, left(description, 140) as description, extract(epoch from now() - created_at)::int as age_s
         from recovery_cases where event_id = $1 and closed_at is null order by severity, created_at limit 10`,
      [e.id],
    ).catch(() => []),
    query<{ system: string; status: string; detail: string | null; paused: boolean; last_success_at: Date | null }>(
      "select system, status, detail, paused, last_success_at from integration_state where event_id = $1 order by system",
      [e.id],
    ).catch(() => []),
  ]);
  return {
    // Codes, categories, tables and ages only: no ticket text on a wall screen.
    help: help.map((h) => ({ code: h.code, category: h.category, table: h.table_label, status: h.status, priority: h.priority, age_s: h.age_s, claim_wait_s: h.claim_wait_s, mentor: h.mentor })),
    incidents,
    integrations: integrations.map((i) => ({ ...i, last_success_at: i.last_success_at ? new Date(i.last_success_at).toISOString() : null })),
  };
}

/** A snapshot for when nothing can be read at all: every value unknown, banner OFFLINE. */
export function offlineSnapshot(now: Date, e?: HackEvent): LiveSnapshot {
  const iso = (d: Date | undefined) => (d ?? now).toISOString();
  return {
    server_time: now.toISOString(),
    as_of: null,
    freshness_state: "offline",
    event: {
      name: e?.name ?? "Kane CLI Hack Day",
      timezone: e?.timezone ?? "America/Los_Angeles",
      phase: e?.phase ?? "build",
      phase_source: e?.phaseSource ?? "schedule",
      starts_at: iso(e?.startsAt),
      team_lock_at: iso(e?.teamLockAt),
      submission_locks_at: iso(e?.submissionLocksAt),
      demos_start_at: iso(e?.demosStartAt),
      ends_at: iso(e?.endsAt),
      is_demo: false,
      fallback: true,
    },
    metrics: {},
    banners: [{ state: "offline", system: "Live metrics", detail: "We can't reach the event database right now. Check-in, help and submission still work." }],
    announcements: [],
    feed: [],
    feed_cursor: 0,
    showcase: [],
    recruiting: [],
    demo_shown: false,
    ops: null,
  };
}

// ── Operator: phase override ─────────────────────────────────────────────────

const PhaseOverrideInput = z.object({
  phase: z.enum([...PHASES, "auto"]),
  reason: zx.optText(200),
  idempotency_key: zx.idempotencyKey,
});

/**
 * Organizer sets (or clears, with "auto") the /live phase. Writes
 * hack_events.phase_override with an audit event; the TV picks it up on the
 * next snapshot (≤5s on SSE). Same column as /ops/settings (ops.ts
 * setPhaseOverride); both target current_event_id() and audit the change.
 */
export async function setPhaseOverride(input: unknown): Promise<{ data: { phase: Phase | null }; receipt: Receipt }> {
  const v = parse(PhaseOverrideInput, input);
  const staff = await requireRole("organizer");
  const actor: Actor = staffActor(staff);
  const next = v.phase === "auto" ? null : v.phase;
  const { result } = await idempotent(v.idempotency_key, `live.phase_override:staff:${staff.id ?? "admin"}`, () =>
    withAudit(actor, "live.phase_override", "hack_event", async (tx) => {
      const { rows: before } = await tx.query<{ id: number; phase_override: Phase | null }>("select id, phase_override from hack_events where id = current_event_id() for update");
      if (!before[0]) throw new AppError("NOT_FOUND", { userMessage: "No event row to update." });
      const { rows } = await tx.query<{ id: number; phase_override: Phase | null; now: Date }>(
        "update hack_events set phase_override = $1, updated_at = now() where id = $2 returning id, phase_override, now() as now",
        [next, before[0].id],
      );
      return {
        result: { phase: rows[0].phase_override, id: rows[0].id, server_time: new Date(rows[0].now).toISOString() },
        resourceId: rows[0].id,
        before: { phase_override: before[0].phase_override },
        after: { phase_override: rows[0].phase_override },
        reason: v.reason,
      };
    }),
  );
  snapshotCache.clear();
  return { data: { phase: result.phase }, receipt: { id: `PHASE-${result.phase ?? "AUTO"}`.toUpperCase(), server_time: result.server_time } };
}

/** Cron entry: project, then audit the run as a system job. */
export async function runProjectionJob(): Promise<{ data: ProjectionResult; receipt: Receipt }> {
  const res = await projectLive();
  const actor: Actor = { type: "system", label: "cron:live-metrics" };
  if (res.ran) {
    await writeAudit(actor, {
      action: "live.metrics.project",
      resourceType: "live_metrics",
      resourceId: "event",
      payload: { written: res.written.length, failed: res.failed },
    }).catch((err) => console.error("[live] audit failed", err));
  }
  const serverTime = res.as_of ?? (await serverNow()).toISOString();
  return { data: res, receipt: { id: res.ran ? `LIVE-${res.as_of}` : "LIVE-SKIPPED-LOCKED", server_time: serverTime } };
}
