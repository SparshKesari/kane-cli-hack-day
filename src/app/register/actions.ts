"use server";

import { redirect } from "next/navigation";
import { isRegistrationOpen } from "@/lib/teams";
import { getMemberById, getPersonalMember, requirePersonalMember } from "@/server/auth";
import { skipAvatar } from "@/server/avatar";
import { formObject, runAction, sha256 } from "@/server/core";
import { setTeamChoice, submitProfile } from "@/server/flow";
import { activationEnabled } from "@/lib/testmu-provision";
import { activateTestmu, clearRevealedKey } from "@/server/testmu";
import { clientKey, rateLimit } from "@/server/ratelimit";

// /register steps. Each re-checks who is signed in on the server; the page then
// re-renders the next step from the database, so a reload lands on the right step.

export type ProfileState = { error?: string; fieldErrors?: Record<string, string>; needsProof?: boolean; values?: Record<string, string> } | null;

const KEEP = ["name", "email", "github", "x", "linkedin", "looking"] as const;

/** Per-field messages from a VALIDATION_FAILED, keyed by field name. */
function fieldErrorsOf(details: unknown): Record<string, string> | undefined {
  const issues = (details as { issues?: { path: string; message: string }[] } | null)?.issues;
  if (!issues?.length) return undefined;
  return Object.fromEntries(issues.reverse().map((i) => [i.path, i.message]));
}

export async function profileAction(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const values = Object.fromEntries(KEEP.map((k) => [k, String(form.get(k) ?? "")]));
  const viewer = await getPersonalMember();
  if (!viewer && !(await isRegistrationOpen())) return { error: "Registration is closed. Ask at the help desk.", values };
  // Proof attempts (password / desk code for an existing email) are throttled like sign-in.
  const proving = !!(form.get("proof_password") || form.get("proof_code"));
  if (proving) {
    const email = values.email.trim().toLowerCase();
    const [a, b] = await Promise.all([
      rateLimit(`register-proof:${await clientKey()}`, { limit: 10, windowSec: 300 }),
      rateLimit(`register-proof-email:${sha256(email)}`, { limit: 10, windowSec: 900 }),
    ]);
    if (!a.ok || !b.ok) return { error: "Too many tries. Wait a few minutes, or ask at the desk.", needsProof: true, values };
  }
  const r = await runAction(() => submitProfile(formObject(form), viewer));
  if (!r.ok) {
    const fieldErrors = fieldErrorsOf(r.error.details);
    const msgs = Object.values(fieldErrors ?? {});
    const error = msgs.length > 1 ? "A few fields need fixing: see the messages in red." : (msgs[0] ?? r.error.message);
    return { error: viewer ? error : `${error} Then type your password again.`, fieldErrors, needsProof: proving, values };
  }
  if (r.data.kind === "needs_proof") return { needsProof: true, values };
  // The matchmaking tick at the end of the form.
  const { memberId, looking } = r.data;
  const member = await getMemberById(memberId);
  if (member) await setTeamChoice(member, looking, { fromProfile: true });
  // Activate on TestMu AI with this profile: its username + access key are the sign-in
  // for everything after. A failure keeps the profile; /register offers a retry.
  if (!activationEnabled()) redirect("/register");
  const activated = await runAction(() => activateTestmu(memberId, { reveal: true }));
  redirect(activated.ok ? "/register" : "/register?testmu=failed");
}

export async function forgetRevealedKeyAction() {
  await clearRevealedKey();
  redirect("/register");
}

export async function skipPhotoAction() {
  const member = await requirePersonalMember();
  await skipAvatar(member);
  redirect("/register");
}

export type ChoiceState = { error?: string } | null;

export async function choiceAction(_prev: ChoiceState, form: FormData): Promise<ChoiceState> {
  const answer = form.get("looking");
  if (answer !== "yes" && answer !== "no") return { error: "Pick one: yes or no." };
  const r = await runAction(async () => setTeamChoice(await requirePersonalMember(), answer === "yes"));
  if (!r.ok) return { error: r.error.message };
  redirect(r.data.inPool ? "/match" : "/team");
}
