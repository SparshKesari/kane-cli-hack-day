import { envelopeResponse } from "@/server/core";
import { getFullReceipt, verifyReceipt } from "@/server/submission";

// GET /api/v1/submissions/receipt/{code}: the frozen snapshot and a fresh
// hash/signature check. Team members, judges and organizers only (cookie);
// anyone else gets NOT_FOUND, same as /submit/receipt/{code}.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return envelopeResponse(async () => {
    const { id } = await ctx.params;
    const r = await getFullReceipt(id);
    const check = await verifyReceipt(r.code);
    return {
      message: `Receipt ${r.code}: ${r.status}. Hash ${check.hash}, signature ${check.signature}.`,
      data: { ...r, verification: check },
      evidence: [{ kind: "submission_receipt", id: r.code, confidence: check.hash === "match" && check.signature === "valid" ? "verified" : "unverified" }],
      fallbackText: `${r.code} ${r.status} ${r.snapshotSha256}`,
    };
  });
}
