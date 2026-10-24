import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/kane";
import { completePublicEvidenceUpload, receiptEnvelope } from "@/server/public-evidence-upload";

// POST /api/v1/evidence/public/uploads/{PE-n}/complete: check the PUT bytes and publish them.
//   → { object_id, status: "public", public_url, sha256, size_bytes, content_type, kind, run_id, commit_sha, receipt }
// The server re-reads the upload, re-hashes it, checks the type and scans text for credentials.
// A failed check rejects these bytes for good (VALIDATION_FAILED with the reason). A missing
// upload is NOT_FOUND and stays pending. Completing a public object returns the same receipt.

export async function POST(req: Request, ctx: RouteContext<"/api/v1/evidence/public/uploads/[id]/complete">) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    return receiptEnvelope(await completePublicEvidenceUpload(caller, (await ctx.params).id));
  });
}
