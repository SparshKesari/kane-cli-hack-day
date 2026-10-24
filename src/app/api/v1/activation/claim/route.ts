import { envelopeResponse } from "@/server/core";
import { claimPlan } from "@/server/event-activation";
import { resolveCaller } from "@/server/pairing";

// POST /api/v1/activation/claim: `kanehack claim`, /activate step 2 from the CLI. The member's
// TestMu AI password (their kaneclihack.sh one) comes from the CLI's local store and goes to
// TestMu AI once, never stored. Same rules as the page: team required, rate-limited, audited,
// and the captain's team invites follow a successful claim.
export async function POST(req: Request) {
  return envelopeResponse<unknown>(async () => {
    const { member } = await resolveCaller(req);
    const raw = (await req.json().catch(() => ({}))) as { password?: unknown };
    const r = await claimPlan(member, typeof raw.password === "string" ? raw.password : "");
    return {
      status: r.outcome === "claimed" ? "ok" : "needs_action",
      message: r.message,
      data: { outcome: r.outcome, message: r.message },
      fallbackText: r.message,
    };
  });
}
