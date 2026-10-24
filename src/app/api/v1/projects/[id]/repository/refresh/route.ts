import { envelopeResponse } from "@/server/core";
import { idParam } from "@/server/kane-http";
import { notImplemented } from "@/server/plan-v25";
import { authorizeProject } from "@/server/story";

// POST /api/v1/projects/{id}/repository/refresh   team member
// v2.5 plan: Re-verify repo access and the submitted HEAD SHA.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request, ctx: RouteContext<"/api/v1/projects/[id]/repository/refresh">) {
  return envelopeResponse(async () => {
    await authorizeProject(idParam((await ctx.params).id), { req, write: true });
    notImplemented("Re-checking repository access needs the GitHub App / OAuth check, which isn't built yet. GET .../repository/verification?check=1 re-runs the public commit check.");
  });
}
