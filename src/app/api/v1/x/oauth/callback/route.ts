import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";

// GET /api/v1/x/oauth/callback   public
// v2.5 plan: X OAuth 2.0 redirect target: exchange the code, store encrypted tokens.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET() {
  return envelopeResponse(async () => {
    notImplemented("The X OAuth callback needs an X (Twitter) developer app with OAuth 2.0 user posting/read scopes, which isn't set up yet.");
  });
}
