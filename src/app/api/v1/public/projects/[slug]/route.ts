import { AppError, envelopeResponse, siteUrl } from "@/server/core";
import { getPublishedStory } from "@/server/story";

// GET /api/v1/public/projects/{slug} (public)
// The published Ship Page story as a public DTO: the same data /ship/{slug}
// and its deck render. Draft, Off and moderated pages read as NOT_FOUND.

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/public/projects/[slug]">) {
  return envelopeResponse(async () => {
    const slug = (await ctx.params).slug;
    const p = await getPublishedStory(slug);
    if (!p) throw new AppError("NOT_FOUND", { userMessage: "No published Ship Page at that address." });
    return {
      message: `Ship Page for ${slug}.`,
      data: { project_id: p.projectId, template: p.template, story: p.story },
      links: [
        { label: "Ship Page", url: siteUrl(`/ship/${slug}`) },
        { label: "Deck", url: siteUrl(`/ship/${slug}/deck`) },
      ],
    };
  });
}
