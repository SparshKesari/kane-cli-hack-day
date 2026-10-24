import { envelopeResponse } from "@/server/core";
import { idParam } from "@/server/kane-http";
import { notImplemented } from "@/server/plan-v25";
import { authorizeProject } from "@/server/story";

// POST /api/v1/projects/{id}/share/verify   team member
// v2.5 plan: Verify a public team X post: author on the team, links to Ship Page + deck.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request, ctx: RouteContext<"/api/v1/projects/[id]/share/verify">) {
  return envelopeResponse(async () => {
    await authorizeProject(idParam((await ctx.params).id), { req, write: true });
    notImplemented("Verifying an X post needs an X (Twitter) developer app with OAuth 2.0 user posting/read scopes, which isn't set up yet (GET /2/tweets/:id for author and URL entities).");
  });
}
