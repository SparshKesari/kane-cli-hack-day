import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";
import { actingMember } from "@/server/teams";

// POST /api/v1/verify-plans/{planId}/evaluate   participant
// v2.5 plan: Server evaluates a run against the approved plan hash and git SHA.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await actingMember(req);
    notImplemented("Verification plan evaluation isn't built yet. Kane runs reported with `kanehack report` still unlock First Proof.");
  });
}
