import { brief, challenge, event, schedule, submissions } from "@/data/hackday";
import { envelopeResponse, siteUrl } from "@/server/core";
import { query } from "@/lib/db";

// GET /api/v1/event/brief (public)
// The event at a glance for agents (MCP event_get_brief): name, date, server
// deadlines, schedule, challenge and submission rules. Public copy only; no
// staff contacts, Wi-Fi or privacy rules (those live behind /ops).

export async function GET() {
  return envelopeResponse(async () => {
    const [clock] = await query<{ now: Date; locks_at: Date | null; phase_override: string | null }>(
      "select now() as now, submission_locks_at as locks_at, phase_override from hack_events where id = current_event_id()",
    ).catch(() => []);
    return {
      message: `${event.name} ${event.city}, ${event.date} (${event.timezone}).`,
      data: {
        event,
        submission_locks_at: clock?.locks_at ? new Date(clock.locks_at).toISOString() : null,
        phase_override: clock?.phase_override ?? null,
        schedule,
        challenge,
        brief,
        submissions,
      },
      links: [{ label: "Event site", url: siteUrl("/") }],
      fallbackText: `${event.name} ${event.city} on ${event.date}. ${event.tagline}${clock?.locks_at ? ` Submissions due ${new Date(clock.locks_at).toISOString()}.` : ""}`,
    };
  });
}
