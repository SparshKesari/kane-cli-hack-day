import { event } from "@/data/hackday";

// "Updated 2:05 PM PDT" next to any live number. Pass the server's `now`
// (from serverNow() / getEvent().now) to flag STALE; never the browser clock.

const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: event.timezone, timeZoneName: "short" });

import { freshnessOf, type FreshnessState } from "@/lib/freshness";

export { freshnessOf, type FreshnessState };

export default function FreshnessStamp({
  asOf,
  now,
  staleAfterSec = 120,
  state,
  source,
  className = "",
}: {
  asOf: Date | string | null;
  /** Server time; with it the stamp works out delayed/stale itself. */
  now?: Date | string;
  staleAfterSec?: number;
  /** Override the computed state (e.g. from integration_state). */
  state?: FreshnessState;
  /** Where the number comes from, e.g. "check-in desk". */
  source?: string;
  className?: string;
}) {
  if (!asOf) {
    return <span className={`font-plex text-xs text-lightgray ${className}`}>Not updated yet</span>;
  }
  const at = new Date(asOf);
  const s = state ?? (now ? freshnessOf(at, new Date(now), staleAfterSec) : "fresh");
  const tone = s === "fresh" ? "text-lightgray" : s === "offline" ? "text-danger" : "text-warning";
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 font-plex text-xs ${tone} ${className}`}>
      <time dateTime={at.toISOString()}>Updated {fmt.format(at)}</time>
      {source && <span className="text-lightgray">· {source}</span>}
      {s !== "fresh" && <span className="font-pixel text-[10px] uppercase tracking-[0.2em]">{s}</span>}
    </span>
  );
}
