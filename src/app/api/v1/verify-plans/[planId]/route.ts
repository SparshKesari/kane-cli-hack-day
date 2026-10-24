import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";
import { actingMember } from "@/server/teams";

// GET /api/v1/verify-plans/{planId}   participant
// PATCH /api/v1/verify-plans/{planId}   participant
// v2.5 plan: Read or edit a draft verification plan (each edit makes a new version).
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    await actingMember(req);
    notImplemented("Verification plans aren't built yet.");
  });
}

export async function PATCH(req: Request) {
  return envelopeResponse(async () => {
    await actingMember(req);
    notImplemented("Verification plans aren't built yet.");
  });
}
