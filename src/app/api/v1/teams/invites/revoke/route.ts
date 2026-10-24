import { envelopeResponse, parse, z } from "@/server/core";
import { teamByParam } from "@/server/plan-v25";
import { actingMember, revokeInvite } from "@/server/teams";
import { readBody } from "../../body";

// POST /api/v1/teams/invites/revoke { team_id (id or slug), invite_id }
// The captain revokes any open invite; whoever created one may revoke their own.

const schema = z.object({ team_id: z.union([z.number().int().positive(), z.string().trim().min(1).max(80)]), invite_id: z.coerce.number().int().positive() });

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    const who = await actingMember(req);
    const input = parse(schema, await readBody(req));
    const team = await teamByParam(String(input.team_id));
    const receipt = await revokeInvite(who, team.id, input.invite_id);
    return { message: `Invite ${input.invite_id} revoked.`, data: { invite_id: input.invite_id, team_id: team.id, status: "revoked", receipt } };
  });
}
