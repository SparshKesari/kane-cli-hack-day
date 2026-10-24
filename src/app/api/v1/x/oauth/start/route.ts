import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { notImplemented } from "@/server/plan-v25";

// GET /api/v1/x/oauth/start   participant
// v2.5 plan: Start X OAuth 2.0 (PKCE) to connect the participant's X account for posting.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("Connecting an X account needs an X (Twitter) developer app with OAuth 2.0 user posting/read scopes, which isn't set up yet.");
  });
}
