import { envelopeResponse } from "@/server/core";
import { idParam } from "@/server/kane-http";
import { notImplemented } from "@/server/plan-v25";
import { authorizeProject } from "@/server/story";

// POST /api/v1/projects/{id}/share/draft   team member
// v2.5 plan: Generate the team's X showcase post copy linking the Ship Page and deck.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request, ctx: RouteContext<"/api/v1/projects/[id]/share/draft">) {
  return envelopeResponse(async () => {
    await authorizeProject(idParam((await ctx.params).id), { req, write: true });
    notImplemented("Drafting the X showcase post isn't built yet. Use the GTM kit in Studio (/studio/{slug}/gtm) for post copy.");
  });
}
