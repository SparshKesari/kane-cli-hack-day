import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { notImplemented } from "@/server/plan-v25";

// DELETE /api/v1/x/connection   participant
// v2.5 plan: Disconnect the participant's X account and revoke stored tokens.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function DELETE(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("Disconnecting X needs an X (Twitter) developer app with OAuth 2.0 user posting/read scopes, which isn't set up yet; no X connection can exist yet.");
  });
}
