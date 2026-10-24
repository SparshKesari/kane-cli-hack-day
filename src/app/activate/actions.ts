"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import type { ActivationStepId } from "@/data/activation-steps";
import { requirePersonalMember } from "@/server/auth";
import { runAction } from "@/server/core";
import { claimPlan, getActivationView, setTick, type ClaimView } from "@/server/event-activation";
import { retryTeamInvites, teamInvitesPending } from "@/server/testmu-team";
import { uiFlowState } from "@/server/flow-ui";

// /activate checklist actions. The member always comes from the personal
// session; nothing about who they are (least of all the email) is read from the form.

export type ActState = { ok: boolean; message?: string; outcome?: ClaimView["outcome"] } | null;

/** All three steps done → straight on to the team's Idea tab (in the site, /setup isn't a step). */
async function onToIdeaIfDone(memberId: number) {
  if ((await getActivationView(memberId)).done) redirect((await uiFlowState(memberId)).next);
}

export async function tickAction(step: ActivationStepId, done: boolean): Promise<ActState> {
  const member = await requirePersonalMember();
  const r = await runAction(async () => setTick(member, step, done));
  if (r.ok && done) await onToIdeaIfDone(member.id);
  refresh();
  return r.ok ? { ok: true } : { ok: false, message: r.error.message };
}

export async function claimPlanAction(form: FormData): Promise<ActState> {
  const member = await requirePersonalMember();
  const password = form.get("password");
  const r = await runAction(async () => claimPlan(member, typeof password === "string" ? password : ""));
  // A captain whose team invites need attention stays here to see them.
  if (r.ok && r.data.outcome === "claimed" && !(await teamInvitesPending(member))) await onToIdeaIfDone(member.id);
  refresh();
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: r.data.outcome === "claimed", message: r.data.message, outcome: r.data.outcome };
}

/** Captain: invite the teammates not in the TestMu AI team yet. The password goes to TestMu AI only. */
export async function retryTeamInvitesAction(form: FormData): Promise<ActState> {
  const member = await requirePersonalMember();
  const password = form.get("password");
  const r = await runAction(async () => retryTeamInvites(member, typeof password === "string" ? password : ""));
  refresh();
  if (!r.ok) return { ok: false, message: r.error.message };
  return r.data.stopped ? { ok: false, message: "Some teammates still need attention. See above." } : { ok: true };
}
