import "server-only";
import { del, head } from "@vercel/blob";
import { ALLOWED, MAX_BYTES, MAX_FILES, extOf, teamPrefix } from "./attachment-rules";
import { onlineQuery } from "./db";

export type Attachment = { id: number; team_id: number; pathname: string; filename: string; content_type: string; size_bytes: number };

const COLS = "id, team_id, pathname, filename, content_type, size_bytes";

export function listAttachments(teamId: number) {
  return onlineQuery<Attachment>(`select ${COLS} from online_attachments where team_id = $1 order by id`, [teamId]);
}

export async function getAttachment(id: number) {
  const [a] = await onlineQuery<Attachment>(`select ${COLS} from online_attachments where id = $1`, [id]);
  return a ?? null;
}

/** Records an uploaded file. The size comes from the stored blob, not from the browser. */
export async function addAttachment(teamId: number, participantId: number, pathname: string, filename: string): Promise<string | null> {
  if (!pathname.startsWith(teamPrefix(teamId)) || pathname.includes("..")) return "That file isn't in your team's folder.";
  const type = ALLOWED[extOf(filename)];
  if (!type) return "That file type isn't allowed.";
  const blob = await head(pathname).catch(() => null);
  if (!blob) return "The upload didn't finish. Try again.";
  if (blob.size > MAX_BYTES) {
    await del(pathname).catch(() => {});
    return "That file is too large.";
  }
  // The count and the insert in one statement, so two tabs can't go past the limit.
  const rows = await onlineQuery(
    `insert into online_attachments (team_id, pathname, filename, content_type, size_bytes, uploaded_by)
     select $1, $2, $3, $4, $5, $6 where (select count(*) from online_attachments where team_id = $1) < $7
     on conflict (pathname) do nothing returning id`,
    [teamId, pathname, filename.slice(0, 160), type, blob.size, participantId, MAX_FILES],
  );
  if (!rows.length) {
    await del(pathname).catch(() => {});
    return `You can attach up to ${MAX_FILES} files. Remove one first.`;
  }
  return null;
}

export async function removeAttachment(teamId: number, id: number) {
  const [row] = await onlineQuery<{ pathname: string }>(`delete from online_attachments where id = $1 and team_id = $2 returning pathname`, [id, teamId]);
  if (row) await del(row.pathname).catch(() => {});
}
