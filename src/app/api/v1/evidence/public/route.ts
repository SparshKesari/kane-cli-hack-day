import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/kane";
import { listPublicEvidenceObjects, objectsEnvelope } from "@/server/public-evidence-upload";

// GET /api/v1/evidence/public: the team's public evidence objects, any status, newest first.
//   Team members see their own project. Judges, mentors and organizers pass ?project_id=.
//   Each object: { object_id, kind, status, sha256, size_bytes, content_type, filename, public_url,
//   run_id, commit_sha, reject_reason, upload_expires_at, created_at, completed_at, removed_at }.

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    const pid = Number(new URL(req.url).searchParams.get("project_id")) || null;
    const { objects } = await listPublicEvidenceObjects(caller, pid);
    return objectsEnvelope(objects);
  });
}
