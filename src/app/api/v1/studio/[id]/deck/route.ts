import { envelopeResponse } from "@/server/core";
import { deckGet } from "@/server/deck";
import { idParam } from "@/server/kane-http";
import { authorizeProject } from "@/server/story";

// GET /api/v1/studio/{projectId}/deck?version=
// The team's editable HTML deck (latest or a version), its published state,
// exports and render jobs. Team members; organizers may read.

export async function GET(req: Request, ctx: RouteContext<"/api/v1/studio/[id]/deck">) {
  return envelopeResponse(async () => {
    const access = await authorizeProject(idParam((await ctx.params).id), { req });
    const v = Number(new URL(req.url).searchParams.get("version"));
    const d = await deckGet(access, Number.isSafeInteger(v) && v > 0 ? v : null);
    return {
      message: d.version ? `Deck v${d.version} (${d.status}).` : "No deck yet; the default deck is built from the project story.",
      data: d,
      links: [{ label: "Deck studio", url: `/studio/${access.project.slug}/deck` }],
    };
  });
}
