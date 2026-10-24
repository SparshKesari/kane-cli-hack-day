import { getMemberById } from "@/server/auth";
import { envelopeResponse, parse, sha256, z } from "@/server/core";
import { issueBearerToken, shortName, verifyMemberPassword } from "@/server/pairing";
import { clientKey, enforceRateLimit } from "@/server/ratelimit";

// POST /api/v1/auth/token: `kanehack signin`. Email + the member's own password → a bearer
// token for this machine, the same one pairing hands out, without the browser step.
// The password comes from the CLI's local store (kanehack password), never from a chat.
const body = z.object({ email: z.string().trim().max(200), password: z.string().min(1).max(200), label: z.string().trim().max(80).optional() });

export async function POST(req: Request) {
  return envelopeResponse<unknown>(async () => {
    const input = parse(body, await req.json().catch(() => ({})));
    // Per email, like the sign-in form: that's what stops guessing. The venue shares one public IP,
    // so the per-IP cap only stops a flood.
    await enforceRateLimit(`api-token-email:${sha256(input.email.toLowerCase())}`, { limit: 10, windowSec: 900 });
    await enforceRateLimit(`api-token:${await clientKey(req)}`, { limit: 200, windowSec: 300 });
    const row = await verifyMemberPassword(input.email, input.password);
    const t = await issueBearerToken(row.id, input.label ?? null, "password");
    const m = await getMemberById(row.id);
    const member = { public_code: m?.public_code ?? null, name: m ? shortName(m.display_name ?? m.name) : "" };
    return {
      message: `Signed in as ${member.name}.`,
      data: { ...t, member },
      warnings: ["Store this token securely. It is shown once; revoke it from /pair if it leaks."],
      fallbackText: `Signed in. Send "Authorization: Bearer <token>" on /api/v1 and /mcp calls. Expires ${t.expires_at}.`,
    };
  });
}
