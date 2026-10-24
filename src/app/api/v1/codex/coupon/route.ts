import { COUPON_MESSAGES, requestCodexCoupon } from "@/server/codex-coupon";
import { envelopeResponse } from "@/server/core";
import { clientKey, enforceRateLimit } from "@/server/ratelimit";

// POST /api/v1/codex/coupon: email a participant their OpenAI Codex coupon if they are on the list.
// Body { email }; the hack-os skill calls it at the Codex step. On the participant list → the
// person's coupon is emailed to that address (the same code on every request). The response
// never carries the code: data.outcome is sent / not_on_list / out_of_codes. Three emails an
// hour per listed address; a generous per-IP limit, since the whole venue shares one address.
export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await enforceRateLimit(`codex-coupon-ip:${await clientKey(req)}`, { limit: 300, windowSec: 600 });
    const raw = (await req.json().catch(() => ({}))) as { email?: unknown };
    const r = await requestCodexCoupon(raw.email);
    const message = COUPON_MESSAGES[r.outcome](r.emailHint);
    return {
      status: r.outcome === "sent" ? "ok" : "needs_action",
      message,
      data: { outcome: r.outcome, resent: r.resent, email_hint: r.emailHint },
      fallbackText: message,
    };
  });
}
