import "server-only";
import { query } from "@/lib/db";
import { getEvent } from "@/lib/event";
import { getFinalStats } from "./final-stats";
import { getLiveSnapshot, offlineSnapshot, readRunBuckets, type LiveSnapshot } from "./metrics";
import { getOrgMetrics, type OrgMetrics } from "./orgMetrics";
import type { FinalStats } from "@/components/live/final-stats";

// /dashboard: the public Mission Control board. Everything here is an
// aggregate: counts and 5-minute buckets, never names or emails. The live
// snapshot (metrics, feed, phase) is the same public one /live uses; this adds
// who is coming in (registrations, check-ins, site sign-ups) and the trailing
// velocity series. Unknown values are null and render "—", never 0.

export const BUCKET_MINUTES = 5;
export const BUCKETS = 40; // trailing 200 minutes

export type Series = { counts: number[] | null; last15: number | null };

export type DashboardData = {
  snap: LiveSnapshot;
  people: { registered: number | null; checked_in: number | null; signed_up: number | null };
  /** Oldest bucket first; the last bucket ends at server_time. */
  arrivals: Series;
  runs: Series;
  /** TestMu AI Insights totals for the event orgs; null when the API is unreachable. */
  org: OrgMetrics | null;
  /** The final Kane CLI numbers once an organizer saves them in /ops/final-stats; totals only. */
  final: Pick<FinalStats, "totals" | "window" | "imported_at"> | null;
};

async function counts<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T | null> {
  try {
    return (await query<T>(sql, params))[0] ?? null;
  } catch (err) {
    console.error("[dashboard] query failed", err);
    return null;
  }
}

async function series(read: () => Promise<{ b: number; n: string }[]>): Promise<Series> {
  try {
    const rows = await read();
    const out = Array.from({ length: BUCKETS }, () => 0);
    // Bucket 0 is the newest: (now - ts) in [0, 5min).
    for (const r of rows) if (r.b >= 0 && r.b < BUCKETS) out[BUCKETS - 1 - r.b] = Number(r.n);
    return { counts: out, last15: out.slice(-3).reduce((a, b) => a + b, 0) };
  } catch (err) {
    console.error("[dashboard] series failed", err);
    return { counts: null, last15: null };
  }
}

export async function getDashboard(): Promise<DashboardData> {
  const e = await getEvent();
  let snap: LiveSnapshot;
  try {
    snap = await getLiveSnapshot({ ops: false });
  } catch (err) {
    console.error("[dashboard] snapshot offline", err);
    snap = offlineSnapshot(e.now, e);
  }

  const [guests, members, arrivals, runs, org, final] = await Promise.all([
    counts<{ registered: string; checked_in: string }>(
      `select count(*) as registered, count(*) filter (where checked_in_at is not null) as checked_in
         from roster_guests
        where event_id = $1 and admission_status = 'admitted' and approval_status in ('approved', 'walk_in')`,
      [e.id],
    ),
    counts<{ signed_up: string }>(
      `select count(*) as signed_up from members where event_id = $1 and deleted_at is null and role = 'participant'`,
      [e.id],
    ),
    series(() =>
      query<{ b: number; n: string }>(
        `select floor(extract(epoch from ($2::timestamptz - created_at)) / ${BUCKET_MINUTES * 60})::int as b, count(*) as n
           from members
          where event_id = $1 and deleted_at is null and role = 'participant'
            and created_at > $2::timestamptz - interval '${BUCKETS * BUCKET_MINUTES} minutes' and created_at <= $2::timestamptz
          group by 1`,
        [e.id, e.now],
      ),
    ),
    series(() => readRunBuckets(e.id, e.now, BUCKET_MINUTES, BUCKETS)),
    getOrgMetrics(e.now),
    getFinalStats(),
  ]);

  const n = (v: string | undefined) => (v == null ? null : Number(v));
  return {
    snap,
    people: { registered: n(guests?.registered), checked_in: n(guests?.checked_in), signed_up: n(members?.signed_up) },
    arrivals,
    runs,
    org,
    final: final && { totals: final.totals, window: final.window, imported_at: final.imported_at },
  };
}
