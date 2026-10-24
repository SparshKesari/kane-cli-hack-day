import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";

// GET /api/v1/public/builders/{handle}   public
// v2.5 plan: A participant's opt-in public Builder Page.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET() {
  return envelopeResponse(async () => {
    notImplemented("Public Builder Pages (/h/{handle}) aren't built yet.");
  });
}
