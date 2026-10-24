"use server";

import { AppError } from "@/server/core";
import { importFinalStats } from "@/server/final-stats";
import { act } from "../_kit/act";
import type { OpsState } from "../_kit/state";

// /ops/final-stats. Organizer only. Without "save" it only checks the files against this
// event's participants; with it, the result becomes the final numbers (audited, with a reason).

// Server actions take up to 1 MB in all, so each file stays well under it.
const MAX_BYTES = 700_000;

async function fileText(form: FormData, name: string, label: string) {
  const f = form.get(name);
  if (!(f instanceof File) || f.size === 0) throw new AppError("VALIDATION_FAILED", { userMessage: `Choose the ${label} file.` });
  if (f.size > MAX_BYTES) throw new AppError("VALIDATION_FAILED", { userMessage: `${label} is over 700 KB, more than this form takes. Ask the person running the usage page for a smaller window.` });
  return f.text();
}

export async function finalStatsAction(_p: OpsState, form: FormData): Promise<OpsState> {
  return act(["organizer"], form, async (staff) => {
    const save = form.get("save") === "on";
    const reason = String(form.get("reason") ?? "").trim();
    if (save && reason.length < 3) throw new AppError("VALIDATION_FAILED", { userMessage: "Give a reason (3+ characters) to save the final numbers." });
    const latest = await fileText(form, "latest", "latest.json");
    const emails = await fileText(form, "emails", "emails.json");
    const r = await importFinalStats(latest, emails, { save, reason }, staff);
    return {
      message: save ? "Saved as the final numbers. /dashboard shows them now." : "Checked. Nothing is saved yet: choose the files again, tick “Save as the final numbers” and submit.",
      receipt: r.receipt,
      data: r.stats,
    };
  });
}
