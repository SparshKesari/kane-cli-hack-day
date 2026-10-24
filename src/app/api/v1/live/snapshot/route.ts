import { envelopeResponse } from "@/server/core";
import { getLiveSnapshot, requireOpsViewer } from "@/server/metrics";

// GET /api/v1/live/snapshot (public; ?ops=1 for staff)
// The whole TV board in one read: phase, verified metrics, feed and
// freshness. What /live reconciles against after an SSE reconnect. Unknown
// values are null, never 0; stale data says so.

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    const ops = new URL(req.url).searchParams.get("ops") === "1";
    if (ops) await requireOpsViewer();
    const s = await getLiveSnapshot({ ops });
    return {
      status: s.freshness_state === "fresh" ? "ok" : "partial",
      message: `Live snapshot, ${s.freshness_state}.`,
      data: s,
      freshness: s.as_of ? { as_of: s.as_of, state: s.freshness_state, source: "live_metrics projection" } : null,
    };
  });
}
