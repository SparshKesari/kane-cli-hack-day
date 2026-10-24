import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";
import { actingMember } from "@/server/teams";

// POST /api/v1/verify-plans/{planId}/approve   participant
// v2.5 plan: Approve the exact objective + command version that may run.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await actingMember(req);
    notImplemented("Verification plan approval isn't built yet.");
  });
}
