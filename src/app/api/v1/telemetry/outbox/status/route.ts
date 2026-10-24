import { envelopeResponse } from "@/server/core";
import { requireOpsViewer } from "@/server/metrics";
import { outboxSummary } from "@/server/outbox";

// GET /api/v1/telemetry/outbox/status   staff
// The server-side event outbox: pending, retrying, dead and delivered counts,
// plus the oldest stuck rows. (Participant-side hook outboxes don't report
// here yet; see telemetry/events/batch.)

export async function GET() {
  return envelopeResponse(async () => {
    await requireOpsViewer();
    const s = await outboxSummary();
    return {
      status: s.dead > 0 ? "partial" : "ok",
      message: `Outbox: ${s.pending} pending, ${s.retrying} retrying, ${s.dead} dead, ${s.delivered_24h} delivered in 24h.`,
      data: { ...s, oldest: s.oldest ? new Date(s.oldest).toISOString() : null },
    };
  });
}
