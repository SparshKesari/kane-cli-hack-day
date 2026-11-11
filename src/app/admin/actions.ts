"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkAdminPassword, clearAdminSession, isAdmin, setAdminSession } from "@/lib/online/admin";
import { onlineQuery } from "@/lib/online/db";
import { createResetLink } from "@/lib/online/reset";

export type LoginState = { error: string } | null;

export async function adminLoginAction(_: LoginState, form: FormData): Promise<LoginState> {
  if (!(await checkAdminPassword(String(form.get("password") ?? "")))) return { error: "Wrong password." };
  await setAdminSession();
  redirect("/admin");
}

export async function adminLogoutAction() {
  await clearAdminSession();
  redirect("/admin");
}

/** Hide a team's showcase page from the public (or show it again). */
export async function setHiddenAction(form: FormData) {
  if (!(await isAdmin())) redirect("/admin");
  await onlineQuery(`update online_teams set hidden = $2 where id = $1`, [Number(form.get("team")), form.get("hidden") === "true"]);
  revalidatePath("/admin");
  revalidatePath("/o/p/[slug]", "page");
}

export type ResetState = { link: string } | { error: string } | null;

/** A one-hour reset link to send to a participant who is locked out. */
export async function resetLinkAction(participantId: number, _prev: ResetState): Promise<ResetState> {
  void _prev;
  if (!(await isAdmin())) return { error: "Log in again." };
  return { link: await createResetLink(Number(participantId)) };
}
