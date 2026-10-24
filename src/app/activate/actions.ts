"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import type { ActivationStepId } from "@/data/activation-steps";
import { requirePersonalMember } from "@/server/auth";
import { runAction } from "@/server/core";
import { assignCodexCode, claimPlan, getActivationView, setTick, type ClaimView } from "@/server/event-activation";

// /activate checklist actions. The member always comes from the personal
// session; nothing about who they are (least of all the email) is read from the form.

export type ActState = { ok: boolean; message?: string; outcome?: ClaimView["outcome"] } | null;

/** All three steps done → straight on to /setup (set up Codex). */
async function onToSetupIfDone(memberId: number) {
  if ((await getActivationView(memberId)).done) redirect("/setup");
}

export async function tickAction(step: ActivationStepId, done: boolean): Promise<ActState> {
  const member = await requirePersonalMember();
  const r = await runAction(async () => setTick(member, step, done));
  if (r.ok && done) await onToSetupIfDone(member.id);
  refresh();
  return r.ok ? { ok: true } : { ok: false, message: r.error.message };
}

export async function claimPlanAction(form: FormData): Promise<ActState> {
  const member = await requirePersonalMember();
  const password = form.get("password");
  const r = await runAction(async () => claimPlan(member, typeof password === "string" ? password : ""));
  if (r.ok && r.data.outcome === "claimed") await onToSetupIfDone(member.id);
  refresh();
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: r.data.outcome === "claimed", message: r.data.message, outcome: r.data.outcome };
}

export async function codexCodeAction(): Promise<ActState> {
  const r = await runAction(async () => assignCodexCode(await requirePersonalMember()));
  refresh();
  return r.ok ? { ok: true } : { ok: false, message: r.error.message };
}
