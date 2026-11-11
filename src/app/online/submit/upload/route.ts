import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ALLOWED, MAX_BYTES, extOf, teamPrefix } from "@/lib/online/attachment-rules";
import { isLocked } from "@/lib/online/submission";
import { getMe } from "@/lib/online/team";

// Short-lived tokens so a team's browser uploads attachments straight to the
// private Blob store. Only signed-in team members, only the allowed file
// types, only into online/t<team id>/, and only before the deadline.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const me = await getMe();
        if (!me || me.teamId === null) throw new Error("Log in and register your team first");
        if (isLocked()) throw new Error("Submissions are closed");
        const type = ALLOWED[extOf(pathname)];
        if (!pathname.startsWith(teamPrefix(me.teamId)) || pathname.includes("..") || !/^[\w./-]+$/.test(pathname) || !type) throw new Error("That file can't be uploaded");
        return { allowedContentTypes: [type], maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true, validUntil: Date.now() + 10 * 60_000 };
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 400 });
  }
}
