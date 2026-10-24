import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/kane";
import { readMutation } from "@/server/kane-http";
import { requestPublicEvidenceUpload, uploadEnvelope } from "@/server/public-evidence-upload";

// POST /api/v1/evidence/public/uploads: get a presigned S3 PUT for one participant-approved public file.
//   { kind, filename, content_type, size_bytes, sha256, run_id? | kane_execution_id?, commit_sha?,
//     participant_approved: true, idempotency_key }   (or the Idempotency-Key header)
//   → { object_id: "PE-n", status: "upload_required", method: "PUT", url, headers, expires_at, max_bytes }
//   or { object_id, status: "exists", public_url, … } when the team already published this sha256.
// Team members only. The URL lasts 10 minutes and signs content-type, content-length and
// x-amz-checksum-sha256, so S3 refuses any other body. Contract: docs/api/PUBLIC_EVIDENCE.md.

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    const { payload, idempotencyKey } = await readMutation(req);
    return uploadEnvelope(await requestPublicEvidenceUpload(caller, { ...payload, idempotency_key: idempotencyKey ?? undefined }));
  });
}
