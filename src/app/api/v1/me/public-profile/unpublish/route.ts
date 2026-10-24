import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { notImplemented } from "@/server/plan-v25";

// POST /api/v1/me/public-profile/unpublish   participant
// v2.5 plan: Take your Builder Page down.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("Builder Page publishing isn't built yet, so there is nothing to unpublish.");
  });
}
