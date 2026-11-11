"use server";

import { revalidatePath } from "next/cache";
import { addAttachment, listAttachments, removeAttachment } from "@/lib/online/attachments";
import { isLocked } from "@/lib/online/submission";
import { getMe } from "@/lib/online/team";

export type FileRow = { id: number; filename: string; size_bytes: number };
type Result = { error: string | null; files: FileRow[] };

const rows = async (teamId: number): Promise<FileRow[]> => (await listAttachments(teamId)).map(({ id, filename, size_bytes }) => ({ id, filename, size_bytes }));

async function team(): Promise<{ id: number; teamId: number } | string> {
  const me = await getMe();
  if (!me || me.teamId === null) return "Your session ended. Log in again.";
  if (isLocked()) return "Submissions are closed.";
  return { id: me.id, teamId: me.teamId };
}

/** Called after the browser has uploaded a file to the team's folder. */
export async function addAttachmentAction(pathname: string, filename: string): Promise<Result> {
  const t = await team();
  if (typeof t === "string") return { error: t, files: [] };
  const error = await addAttachment(t.teamId, t.id, String(pathname), String(filename));
  revalidatePath("/o/p/[slug]", "page");
  return { error, files: await rows(t.teamId) };
}

export async function removeAttachmentAction(id: number): Promise<Result> {
  const t = await team();
  if (typeof t === "string") return { error: t, files: [] };
  await removeAttachment(t.teamId, Number(id));
  revalidatePath("/o/p/[slug]", "page");
  return { error: null, files: await rows(t.teamId) };
}
