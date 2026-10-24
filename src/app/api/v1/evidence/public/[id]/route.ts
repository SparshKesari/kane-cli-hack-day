import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/kane";
import { getPublicEvidenceObject, objectEnvelope, removalEnvelope, removePublicEvidence } from "@/server/public-evidence-upload";

// GET|DELETE /api/v1/evidence/public/{PE-n}: read one public evidence object, or unpublish it.
//   GET     the object and its status (the team, or judges, mentors and organizers).
//   DELETE  { reason? }: a team member before the submission lock, an organizer at any time.
//           Deletes the public object and sets status removed.

export async function GET(req: Request, ctx: RouteContext<"/api/v1/evidence/public/[id]">) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    return objectEnvelope(await getPublicEvidenceObject(caller, (await ctx.params).id));
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/v1/evidence/public/[id]">) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    const body = await req.json().catch(() => ({}));
    return removalEnvelope(await removePublicEvidence(caller, (await ctx.params).id, body));
  });
}
