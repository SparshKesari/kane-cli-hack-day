"use server";

import { refresh } from "next/cache";
import { memberActor, requireTeamMember } from "@/server/auth";
import { AppError, formObject, runAction, type ActionResult } from "@/server/core";
import { saveIdea, submitIdea, validateTeamIdeaOnSite, type StoredAssessment } from "@/server/ideas";

// The idea tab's server actions. Membership is re-checked from the cookie on
// every call; organizers viewing a hub read-only can't write here.

export type IdeaFormState = ActionResult<unknown> | null;
export type ValidateState = ActionResult<StoredAssessment> | null;
export type SubmitIdeaState = ActionResult<null> | null;

async function teamMember(slug: string) {
  const { team, member } = await requireTeamMember(slug);
  if (!member) throw new AppError("FORBIDDEN", { userMessage: "Organizers can read this tab but only team members can change it." });
  return { teamId: team.id, who: { member, actor: memberActor(member) } };
}

export async function saveIdeaAction(slug: string, _prev: IdeaFormState, form: FormData): Promise<IdeaFormState> {
  return runAction(async () => {
    const { teamId, who } = await teamMember(slug);
    const out = await saveIdea(who, teamId, { ...formObject(form), source: "web" });
    refresh();
    return { data: null, receipt: out.receipt };
  });
}

export async function validateIdeaAction(slug: string, _prev: ValidateState, form: FormData): Promise<ValidateState> {
  return runAction(async () => {
    const { teamId, who } = await teamMember(slug);
    const out = await validateTeamIdeaOnSite(who, teamId, { useAi: form.get("use_ai") === "on" });
    refresh();
    return { data: out.assessment, receipt: out.receipt };
  });
}

/** Lock and submit the idea (after it's been validated). The form's confirm box must be ticked. */
export async function submitIdeaAction(slug: string, _prev: SubmitIdeaState, form: FormData): Promise<SubmitIdeaState> {
  return runAction(async () => {
    const { teamId, who } = await teamMember(slug);
    if (form.get("confirm") !== "on") throw new AppError("VALIDATION_FAILED", { userMessage: "Tick the box to confirm: this locks the idea for your whole team." });
    const receipt = await submitIdea(who, teamId);
    refresh();
    return { data: null, receipt };
  });
}
