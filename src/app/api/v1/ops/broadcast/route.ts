import { envelopeResponse } from "@/server/core";
import { readMutation } from "@/server/kane-http";
import { setPhaseOverride } from "@/server/metrics";

// PATCH /api/v1/ops/broadcast { phase: <phase> | "auto", reason? }   organizer (staff cookie)
// Put a phase on air on the TV (/live), or "auto" to follow the clock again.
// Same audited write as the /live operator controls; the TV picks it up on
// the next snapshot.

export async function PATCH(req: Request) {
  return envelopeResponse(async () => {
    const { payload, idempotencyKey } = await readMutation(req);
    const r = await setPhaseOverride({ ...payload, idempotency_key: idempotencyKey ?? payload.idempotency_key });
    return { message: r.data.phase ? `On air: ${r.data.phase}.` : "On air: automatic (follows the clock).", data: { ...r.data, receipt: r.receipt } };
  });
}
