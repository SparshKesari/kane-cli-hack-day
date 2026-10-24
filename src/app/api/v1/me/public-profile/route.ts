import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { notImplemented } from "@/server/plan-v25";

// PATCH /api/v1/me/public-profile   participant
// v2.5 plan: Edit your public Builder Page fields.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function PATCH(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("Builder Page editing isn't built yet.");
  });
}
