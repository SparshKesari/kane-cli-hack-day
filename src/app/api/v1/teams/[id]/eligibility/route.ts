import { getMember, getStaff } from "@/server/auth";
import { AppError, envelopeResponse } from "@/server/core";
import { getLatestPublished } from "@/server/story";
import { getSubmissionContext } from "@/server/submission";
import { assertOnTeam, teamByParam } from "@/server/plan-v25";
import { actingMember } from "@/server/teams";

// GET /api/v1/teams/{id|slug}/eligibility   team members; organizers/judges
// Judging eligibility as the v2.5 plan defines it: official submission +
// public Ship Page + public deck + a verified team X post. X post
// verification isn't built yet, so verified_x_post is null (unknown) and
// eligible stays false with a warning, never a fake pass.

export async function GET(req: Request, ctx: RouteContext<"/api/v1/teams/[id]/eligibility">) {
  return envelopeResponse(async () => {
    const team = await teamByParam((await ctx.params).id);
    const staff = req.headers.get("authorization") ? null : await getStaff();
    if (!staff || !["organizer", "admin", "judge"].includes(staff.role)) {
      const who = req.headers.get("authorization") ? (await actingMember(req)).member : await getMember();
      if (!who) throw new AppError("UNAUTHENTICATED");
      await assertOnTeam(team.id, who);
    }
    const sc = await getSubmissionContext(team.id);
    const [page, deck] = await Promise.all([getLatestPublished(sc.project.id, "ship_page"), getLatestPublished(sc.project.id, "deck")]);
    const pagePublic = sc.project.showcase_state === "public" && !!page && page.state !== "draft" && page.state !== "hidden_by_moderation";
    // No deck asset → /ship/{slug}/deck serves the default deck from the story, so it's public with the page.
    const deckPublic = pagePublic && (!deck || (deck.state !== "draft" && deck.state !== "hidden_by_moderation"));
    const submitted = !!sc.submission && ["finalized", "locked", "organizer_exception"].includes(sc.submission.status);
    const state = !submitted ? "not_submitted" : !(pagePublic && deckPublic) ? "awaiting_public_assets" : "awaiting_verified_x";
    return {
      status: "needs_action",
      message: `Eligibility: ${state.replaceAll("_", " ")}.`,
      data: {
        team_id: team.id,
        submitted,
        receipt_code: sc.submission?.receipt_code ?? null,
        ship_page_public: pagePublic,
        deck_public: deckPublic,
        showcase_ready: pagePublic && deckPublic,
        verified_x_post: null,
        eligible: false,
        state,
      },
      warnings: ["X post verification is not built yet (POST /api/v1/projects/{id}/share/verify returns 501), so no team is marked eligible by this endpoint."],
    };
  });
}
