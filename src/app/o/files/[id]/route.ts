import { get } from "@vercel/blob";
import { getAttachment } from "@/lib/online/attachments";
import { getSubmission } from "@/lib/online/submission";
import { getMe } from "@/lib/online/team";

// Serves a team's attachment from the private Blob store. The team can always
// open its own files; everyone else only once the project is submitted (the
// showcase page is public then). Anything else is a 404.
export async function GET(_request: Request, ctx: RouteContext<"/o/files/[id]">) {
  const id = Number((await ctx.params).id);
  const file = Number.isSafeInteger(id) ? await getAttachment(id) : null;
  if (!file) return new Response("Not found", { status: 404 });

  const me = await getMe();
  const mine = me?.teamId === file.team_id;
  if (!mine && (await getSubmission(file.team_id))?.status !== "submitted") return new Response("Not found", { status: 404 });

  const blob = await get(file.pathname, { access: "private" }).catch(() => null);
  if (!blob) return new Response("Not found", { status: 404 });
  // Images and PDFs open in the tab; everything else downloads.
  const inline = file.content_type.startsWith("image/") || file.content_type === "application/pdf";
  return new Response(blob.stream, {
    headers: {
      "content-type": file.content_type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "cache-control": "private, max-age=300",
    },
  });
}
