import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { notImplemented } from "@/server/plan-v25";

// GET /api/v1/help/stream   participant
// v2.5 plan: Server-sent updates for your help tickets.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("The live help-ticket stream (SSE) isn't built yet. Poll GET /api/v1/help/{id} instead.");
  });
}
