import { isEnabled } from "@/lib/flags";
import { resolveShipSlug } from "@/server/showcase";
import { ONE_PAGER_HEADERS, servableOnePager } from "@/server/team-page";

// The team's one-pager HTML (docs/api/TEAM_PAGE.md), written through the page API.
// next.config.ts serves it in a CSP sandbox: opaque origin, no network, no forms, no referrer.
// Visitors see it only on a published public or unlisted Ship Page, and only if it was
// saved before that publish. Team members and staff see the latest save. Otherwise 404.

export async function GET(req: Request, ctx: RouteContext<"/ship/[slug]/one-pager">) {
  const { slug } = await ctx.params;
  if (!(await isEnabled("ship_pages"))) return new Response("Not found", { status: 404 });
  const found = await resolveShipSlug(slug);
  if (!found) return new Response("Not found", { status: 404 });
  if ("redirectTo" in found) return Response.redirect(new URL(`/ship/${found.redirectTo}/one-pager`, req.url), 308);
  const html = await servableOnePager(found.project);
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, { headers: ONE_PAGER_HEADERS });
}
