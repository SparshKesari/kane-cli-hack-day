import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { notImplemented } from "@/server/plan-v25";

// GET /api/v1/me/public-profile/preview   participant
// v2.5 plan: Preview your public Builder Page without publishing.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("Builder Page preview isn't built yet.");
  });
}
