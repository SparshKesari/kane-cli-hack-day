import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireTeamMember } from "@/server/auth";
import { AppError } from "@/server/core";
import { getProjectByTeam, mediaPrefix } from "@/server/showcase";

// Short-lived tokens so a team's browser uploads screenshots straight to the
// private Blob store (no function body limit). Only signed-in members of this
// team, only images, and only into this project's showcase/p<id>/ folder, at any
// time (the deadline time no longer locks anything). The pathname is attached to
// the submission when the draft is saved.

export async function POST(request: Request, ctx: RouteContext<"/t/[slug]/submit/upload">) {
  const { slug } = await ctx.params;
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const { team, member } = await requireTeamMember(slug);
        if (!member) throw new Error("Only team members can upload");
        const project = await getProjectByTeam(team.id);
        if (!project) throw new Error("Project not found");
        if (!pathname.startsWith(mediaPrefix(project.id)) || pathname.includes("..") || !/^[\w./-]+$/.test(pathname)) throw new Error("Bad upload path");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60_000,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof AppError ? err.userMessage : err instanceof Error ? err.message : "Upload failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
