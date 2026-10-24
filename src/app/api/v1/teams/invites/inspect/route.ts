import { AppError, envelopeResponse, parse, z } from "@/server/core";
import { enforceRateLimit } from "@/server/ratelimit";
import { actingMember, previewInvite } from "@/server/teams";
import { readBody } from "../../body";

// POST /api/v1/teams/invites/inspect { code }
// What an invite code points at, without using it: a safe team preview (name,
// seats, lock state). Expired, used, revoked and unknown codes all read the
// same NOT_FOUND, and no member names are returned. Throttled per person
// (20 per 10 min) so codes can't be guessed. Joining stays a separate,
// confirmed POST /api/v1/teams/join.

const schema = z.object({ code: z.string().trim().min(4).max(40) });

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    const who = await actingMember(req);
    await enforceRateLimit(`invite-inspect:${who.member.id}`, { limit: 20, windowSec: 600 });
    const { code } = parse(schema, await readBody(req));
    const p = await previewInvite(code, who.member);
    if (!p) throw new AppError("NOT_FOUND", { userMessage: "That code has expired, was used, or was revoked. Ask your captain for a new one." });
    const seats = Math.max(0, p.team.cap - p.team.member_count);
    const blocked = p.team.locked ? "roster locked" : seats === 0 ? "team full" : !p.forYou ? "issued to someone else" : null;
    return {
      status: blocked ? "needs_action" : "ok",
      message: blocked ? `Invite to ${p.team.name}, but it can't be used: ${blocked}.` : `Invite to ${p.team.name} · ${p.team.member_count}/${p.team.cap} members. Confirm to join.`,
      data: {
        team: { id: p.team.id, slug: p.team.slug, name: p.team.name, track: p.team.track, summary: p.team.summary_public, members: p.team.member_count, capacity: p.team.cap, locked: p.team.locked },
        open_seats: seats,
        expires_at: p.expiresAt.toISOString(),
        restricted: p.restricted,
        for_you: p.forYou,
        can_join: !blocked,
      },
      actions: blocked ? [] : [{ id: "team_join", label: `Join ${p.team.name}`, requires_human_confirmation: true, tool: "team_join" }],
      fallbackText: blocked ? `Can't join ${p.team.name}: ${blocked}.` : `Join ${p.team.name}? POST /api/v1/teams/join with this code and confirm: true.`,
    };
  });
}
