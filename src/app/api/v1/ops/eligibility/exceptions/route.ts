import { requireRole } from "@/server/auth";
import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";

// POST /api/v1/ops/eligibility/exceptions   organizer (staff cookie)
// v2.5 plan: Organizer records a scoped, audited judging-eligibility exception.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST() {
  return envelopeResponse(async () => {
    await requireRole("organizer");
    notImplemented("Eligibility exceptions depend on the X verification gate, which isn't built yet.");
  });
}
