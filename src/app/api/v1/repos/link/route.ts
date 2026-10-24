import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";
import { actingMember } from "@/server/teams";

// POST /api/v1/repos/link   participant
// v2.5 plan: Link the team's GitHub repository through an authenticated GitHub check.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await actingMember(req);
    notImplemented("Linking a repo through the GitHub App / OAuth isn't built yet. Put the repo URL on the Submit tab draft; GitHub push webhooks link repos automatically.");
  });
}
