import { envelopeResponse } from "@/server/core";
import { callerMember, resolveCaller } from "@/server/kane";
import { teamByParam } from "@/server/plan-v25";
import { getRoster, publicTeamInfo } from "@/server/teams";

// GET /api/v1/teams/{id|slug}  team readback by numeric id or slug. Unknown team: NOT_FOUND (404).
// Members of the team get the full record and roster (view "member").
// Anyone else signed in gets only id, slug, name, track, member_count, cap, locked, recruiting_open, summary_public (view "public").

export async function GET(req: Request, { params }: RouteContext<"/api/v1/teams/[id]">) {
  return envelopeResponse(async () => {
    const me = callerMember(await resolveCaller(req));
    const t = await teamByParam((await params).id);
    const roster = await getRoster(t.id);
    const member = !!me && roster.some((r) => r.member_id === me.id);
    const summary = `${t.name} · ${t.member_count}/${t.cap} members${t.locked ? " · roster locked" : ""}`;
    return {
      message: summary,
      data: member ? { view: "member", team: t, roster } : { view: "public", team: publicTeamInfo(t) },
      links: member ? [{ label: "Team hub", url: `/t/${t.slug}` }] : [],
      fallbackText: member ? `${summary}: ${roster.map((r) => `${r.name} (${r.role})`).join(", ")}` : summary,
    };
  });
}
