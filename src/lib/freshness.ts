// How fresh a live number is, from its as-of time and the server's clock. Shared by the
// FreshnessStamp component and the metrics projection (which must not import a component).

export type FreshnessState = "fresh" | "delayed" | "stale" | "offline";

export function freshnessOf(asOf: Date, now: Date, staleAfterSec = 120): FreshnessState {
  const age = (now.getTime() - asOf.getTime()) / 1000;
  if (age > staleAfterSec * 5) return "offline";
  if (age > staleAfterSec) return "stale";
  if (age > staleAfterSec / 2) return "delayed";
  return "fresh";
}
