import { envelopeResponse } from "@/server/core";
import { ideaGetTool, ideaSaveTool } from "@/server/team-tools";
import { actingMember } from "@/server/teams";
import { readBody } from "../teams/body";

// GET  /api/v1/ideas  your team's idea and its latest advisory check (team scope only)
// POST /api/v1/ideas  { title, app_type?, private_description, kane_plan?, extra_info?, public_summary?, discovery_opt_in?, project_type? } → new revision.
// Sharing (discovery_opt_in: true) needs explicit_confirmation: true. Works at any time.

export async function GET(req: Request) {
  return envelopeResponse(async () => ideaGetTool(await actingMember(req)));
}

export async function POST(req: Request) {
  return envelopeResponse(async () => ideaSaveTool(await actingMember(req), await readBody(req)));
}
