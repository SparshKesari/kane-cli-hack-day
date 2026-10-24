import { AppError, envelopeResponse } from "@/server/core";
import { recordPing, teamCodexStatus } from "@/server/codex-status";
import { callerActor, callerMember, resolveCaller } from "@/server/kane";
import { assertOnTeam, teamByParam } from "@/server/plan-v25";
import { enforceRateLimit } from "@/server/ratelimit";
import { readBody } from "../../body";

// /api/v1/teams/{id|slug}/status   (also served at /{team-slug}/status)
//   POST  a Codex hook ping from a teammate's machine (bearer token or TestMu key):
//         { event, session_id, status?, host?, codex_version?, model?, kane_run_id?, at? }
//         event: session_start | heartbeat | tool_use | kane_run_started |
//                kane_run_finished | waiting_for_human | error | stop | session_end
//         Metadata only: any other field is refused (400). 120 pings/min per person.
//   GET   each teammate's Codex status: online, working / idle / waiting_for_human /
//         error / ended, last event and when (teammates and staff).

export async function POST(req: Request, { params }: RouteContext<"/api/v1/teams/[id]/status">) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    const member = callerMember(caller);
    if (!member) throw new AppError("FORBIDDEN", { userMessage: "Only a teammate's own Codex can report its status." });
    const team = await teamByParam((await params).id);
    await assertOnTeam(team.id, member);
    await enforceRateLimit(`codex-status:${member.id}`, { limit: 120, windowSec: 60 });
    const r = await recordPing(member.id, team.id, await readBody(req));
    return {
      message: `${callerActor(caller).label ?? "Teammate"}: Codex ${r.status} (${r.event}).`,
      data: { team: team.slug, member_id: member.id, ...r },
      fallbackText: `Recorded ${r.event} → ${r.status} for ${team.slug}.`,
    };
  });
}

export async function GET(req: Request, { params }: RouteContext<"/api/v1/teams/[id]/status">) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    const team = await teamByParam((await params).id);
    const member = callerMember(caller);
    if (member) await assertOnTeam(team.id, member);
    const s = await teamCodexStatus(team.id);
    return {
      message: `${team.name}: ${s.online}/${s.members.length} online in Codex, ${s.working} working${s.waiting_for_human ? `, ${s.waiting_for_human} waiting for a person` : ""}.`,
      data: { team: { id: team.id, slug: team.slug, name: team.name }, ...s },
      freshness: { as_of: new Date().toISOString(), state: "fresh", source: "codex hook pings" },
      fallbackText: s.members.map((m) => `${m.name}: ${m.online ? m.status : "offline"}${m.last_seen_at ? ` (last ${m.last_event} at ${m.last_seen_at})` : ""}`).join("\n") || "No teammates.",
    };
  });
}
