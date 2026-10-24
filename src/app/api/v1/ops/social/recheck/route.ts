import { requireRole } from "@/server/auth";
import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";

// POST /api/v1/ops/social/recheck   organizer (staff cookie)
// v2.5 plan: Organizer re-runs X post verification for one or all teams.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST() {
  return envelopeResponse(async () => {
    await requireRole("organizer");
    notImplemented("Rechecking X posts needs an X (Twitter) developer app with OAuth 2.0 user posting/read scopes, which isn't set up yet.");
  });
}
