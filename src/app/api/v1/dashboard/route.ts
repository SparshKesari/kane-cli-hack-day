import { envelopeResponse } from "@/server/core";
import { getDashboard } from "@/server/dashboard";

// GET /api/v1/dashboard → DashboardData. Public aggregates only (no names or
// emails); /dashboard polls this every 10s.

export async function GET() {
  return envelopeResponse(async () => {
    const data = await getDashboard();
    return {
      status: data.snap.freshness_state === "fresh" ? "ok" : "partial",
      message: `Dashboard, ${data.snap.freshness_state}.`,
      data,
      freshness: data.snap.as_of ? { as_of: data.snap.as_of, state: data.snap.freshness_state, source: "live_metrics projection" } : null,
      warnings: data.snap.demo_shown ? ["Includes illustrative demo data (staging only)."] : [],
      links: [{ label: "Dashboard", url: "/dashboard" }],
      fallbackText: `Registered: ${data.people.registered ?? "unknown"}.`,
    };
  });
}
