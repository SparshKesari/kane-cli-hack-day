"use server";

import { revalidatePath } from "next/cache";
import { emailReceipt } from "@/lib/online/email";
import { formatIssues, missingForSubmit, type Issue } from "@/lib/online/required";
import { cleanDraft, formatWhen, getSubmission, isLocked, rawFromForm, saveSubmission } from "@/lib/online/submission";
import { getMe, getMembers, getTeam } from "@/lib/online/team";

export type SaveState =
  | { ok: true; submitted: boolean; at: string; when: string; version: number; receipt: string | null }
  | { ok: false; message: string; issues: Issue[]; conflict?: boolean }
  | null;

export async function saveAction(_: SaveState, form: FormData): Promise<SaveState> {
  const me = await getMe();
  if (!me) return { ok: false, message: "Your session ended. Log in again.", issues: [] };
  if (me.teamId === null) return { ok: false, message: "Register your team first.", issues: [] };
  if (isLocked()) return { ok: false, message: "Submissions are closed.", issues: [] };

  const raw = rawFromForm(form);
  const existing = await getSubmission(me.teamId);
  const submit = form.get("intent") === "submit";
  // Wrong-looking links are refused even in a draft; empty required fields only when submitting
  // (a submitted entry must stay complete, so every later save is checked too).
  const issues = [...formatIssues(raw), ...(submit || existing?.status === "submitted" ? missingForSubmit(raw) : [])];
  if (issues.length) return { ok: false, message: "Some answers need fixing. Nothing was saved.", issues };

  const saved = await saveSubmission(me.teamId, me.id, cleanDraft(raw), submit, Number(form.get("version") ?? 0));
  if (saved.conflict) {
    return {
      ok: false,
      conflict: true,
      message: `${saved.by ?? "A teammate"} saved changes at ${formatWhen(saved.at)}, after you opened this page. Nothing of yours was saved. Copy anything you need, then reload to get their version.`,
      issues: [],
    };
  }

  // A receipt by email to the whole team: on the first submit, and on each later update.
  if (saved.submitted && saved.receipt) {
    const [team, members] = await Promise.all([getTeam(me.teamId), getMembers(me.teamId)]);
    if (team) {
      const p = { project: raw.project_name, team: team.name, receipt: saved.receipt, when: formatWhen(saved.at), slug: team.slug, updated: existing?.status === "submitted" };
      await Promise.all(members.map((m) => emailReceipt(m.email, m.name, p)));
    }
  }
  revalidatePath("/o/submit");
  revalidatePath("/o/p/[slug]", "page");
  return { ok: true, submitted: saved.submitted, at: saved.at.toISOString(), when: formatWhen(saved.at), version: saved.version, receipt: saved.receipt };
}
