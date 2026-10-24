import { envelopeResponse, siteUrl } from "@/server/core";
import { resolveCaller } from "@/server/pairing";
import { getBadgeToken } from "@/server/passport";

// GET /api/v1/passport/badge
// Your QR badge token: expiring and revocable, no email or PII in it. Issues
// one if none is live. Staff scan it at /passport/b/{token}.

export async function GET(req: Request) {
  return envelopeResponse(async () => {
    const { member, actor } = await resolveCaller(req);
    const b = await getBadgeToken(member.id, actor);
    const url = siteUrl(`/passport/b/${b.token}`);
    return {
      message: "Your badge QR is ready.",
      data: { badge_id: b.id, token: b.token, scan_url: url },
      links: [{ label: "Badge", url: "/passport/badge" }],
      fallbackText: `Badge: ${url}`,
    };
  });
}
