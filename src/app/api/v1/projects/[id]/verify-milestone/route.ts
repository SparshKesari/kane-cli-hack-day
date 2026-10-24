import { envelopeResponse } from "@/server/core";
import { idParam } from "@/server/kane-http";
import { notImplemented } from "@/server/plan-v25";
import { authorizeProject } from "@/server/story";

// GET /api/v1/projects/{id}/verify-milestone   team member
// v2.5 plan: Whether an approved plan + passing run unlocked the verification milestone.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function GET(req: Request, ctx: RouteContext<"/api/v1/projects/[id]/verify-milestone">) {
  return envelopeResponse(async () => {
    await authorizeProject(idParam((await ctx.params).id), { req, write: true });
    notImplemented("The plan-gated verification milestone isn't built yet. See GET /api/v1/projects/{id}/milestones.");
  });
}
