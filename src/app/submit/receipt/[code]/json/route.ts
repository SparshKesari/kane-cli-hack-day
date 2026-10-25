import { toAppError } from "@/server/core";
import { getFullReceipt } from "@/server/submission";

// The frozen receipt as a JSON file, for the team's records and for judges.
// Same access as the receipt page: the team, judges and organizers.
export async function GET(_request: Request, ctx: RouteContext<"/submit/receipt/[code]/json">) {
  const { code } = await ctx.params;
  try {
    const r = await getFullReceipt(code);
    const body = {
      receipt_code: r.code,
      status: r.status,
      source: r.source,
      finalized_at: new Date(r.finalizedAt).toISOString(),
      received_at: r.receivedAt ? new Date(r.receivedAt).toISOString() : null,
      snapshot_sha256: r.snapshotSha256,
      signature: r.signature,
      signature_alg: r.signature ? "HMAC-SHA256 over snapshot_sha256, base64url" : null,
      hash_alg: "sha256 over the snapshot serialised as JSON with sorted keys",
      snapshot: r.snapshot,
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="receipt-${r.code}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const e = toAppError(err);
    return Response.json({ error: e.toJSON() }, { status: e.status });
  }
}
