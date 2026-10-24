import Link from "next/link";
import { connection } from "next/server";
import FreshnessStamp from "@/components/ui/FreshnessStamp";
import { readMetrics } from "@/server/metrics";
import { displayValue, METRICS, type MetricName, type MetricValue } from "./definitions";

// The home page's live stats strip (T-LIVE-12): the same projection as
// /api/v1/live/metrics, with its freshness. Unknown → "—"; on an outage the
// strip says so instead of showing zeros. Wrap in <Suspense> (it reads the DB
// at request time).

const SHOWN: MetricName[] = ["participants_registered", "teams_active", "kane_executions", "submissions_finalized"];

export default async function HomeStats() {
  await connection();
  let data: Awaited<ReturnType<typeof readMetrics>> | null = null;
  try {
    data = await readMetrics();
  } catch (err) {
    console.error("[home] live stats unavailable", err);
  }
  // Before anything has been projected, stay out of the way.
  if (data && !data.as_of) return null;
  return <HomeStatsStrip metrics={data?.metrics ?? {}} asOf={data?.as_of ?? null} state={data?.freshness_state ?? "offline"} />;
}

export function HomeStatsStrip({ metrics, asOf, state }: { metrics: Partial<Record<MetricName, MetricValue>>; asOf: string | null; state: "fresh" | "delayed" | "stale" | "offline" }) {
  return (
    <section aria-label="Live from the room" className="border-t border-dashed border-hairline">
      <div className="container-page flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:gap-8">
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {SHOWN.map((name) => (
            <div key={name} className="min-w-0">
              <dt className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{METRICS[name].label}</dt>
              <dd className="mt-1 font-dots text-3xl leading-none font-black text-bright">{displayValue(metrics[name]) ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {asOf ? <FreshnessStamp asOf={asOf} state={state} source="verified aggregation" /> : <span className="font-plex text-xs text-warning">Live numbers unavailable right now</span>}
          <Link href="/live" className="inline-flex min-h-11 items-center font-plex text-sm text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
            Mission Control →
          </Link>
        </div>
      </div>
    </section>
  );
}
