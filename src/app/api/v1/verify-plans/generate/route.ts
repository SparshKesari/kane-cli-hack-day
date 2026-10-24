import { envelopeResponse } from "@/server/core";
import { notImplemented } from "@/server/plan-v25";
import { actingMember } from "@/server/teams";

// POST /api/v1/verify-plans/generate   participant
// v2.5 plan: Codex drafts an editable Kane objective + command from the project.
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await actingMember(req);
    notImplemented("Editable Kane verification plans aren't built yet. Run `kane-cli run \"<objective>\" --agent` and report it with `kanehack report`.");
  });
}
