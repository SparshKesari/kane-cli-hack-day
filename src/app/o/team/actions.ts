"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { emailJoinedTeam, emailTeamCreated, emailTeammateJoined } from "@/lib/online/email";
import { createTeam, getMe, getMembers, joinTeam, leaveTeam, removeMember, renameTeam } from "@/lib/online/team";

export type TeamState = { error: string } | null;

const validName = (name: string) => name.length >= 2 && name.length <= 60;

/** Step 2: go solo, start a team (you become its captain), or join one with the captain's code. */
export async function teamAction(_: TeamState, form: FormData): Promise<TeamState> {
  const me = await getMe();
  if (!me) redirect("/o/login");
  if (me.teamId !== null) redirect("/o/team");

  const mode = String(form.get("mode") ?? "");
  if (mode === "join") {
    const code = String(form.get("code") ?? "").trim();
    if (!code) return { error: "Enter the team code your captain shared." };
    const res = await joinTeam(me, code);
    if ("error" in res) return res;
    const captain = (await getMembers(res.team.id)).find((m) => m.id === res.team.captainId);
    await Promise.all([emailJoinedTeam(me.email, me.name, res.team.name), captain ? emailTeammateJoined(captain.email, captain.name, me.name, res.team.name) : null]);
  } else if (mode === "team") {
    const name = String(form.get("name") ?? "").trim();
    if (!validName(name)) return { error: "Enter a team name (2 to 60 characters)." };
    const team = await createTeam(me, name);
    await emailTeamCreated(me.email, me.name, team.name, team.inviteCode);
  } else if (mode === "solo") {
    await createTeam(me, null);
  } else {
    return { error: "Pick one of the options." };
  }
  redirect(mode === "team" ? "/o/team" : "/o/start");
}

export async function renameTeamAction(_: TeamState, form: FormData): Promise<TeamState> {
  const me = await getMe();
  if (!me) redirect("/o/login");
  const name = String(form.get("name") ?? "").trim();
  if (!validName(name)) return { error: "Enter a team name (2 to 60 characters)." };
  const error = await renameTeam(me, name);
  if (error) return { error };
  revalidatePath("/o/team");
  return null;
}

export async function removeMemberAction(form: FormData) {
  const me = await getMe();
  if (!me) redirect("/o/login");
  await removeMember(me, Number(form.get("member")));
  revalidatePath("/o/team");
}

export async function leaveTeamAction() {
  const me = await getMe();
  if (!me) redirect("/o/login");
  await leaveTeam(me);
  redirect("/o/team");
}
