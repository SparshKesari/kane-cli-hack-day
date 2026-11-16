import { onlineQuery } from "@/lib/online/db";

// The tiny image at the bottom of each email the online hackathon sends. A mail
// app loading it marks that email as opened in online_emails (see /admin → Emails).
// It always answers with the same 1×1 transparent GIF, whatever the token.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: Request, ctx: RouteContext<"/o/e/[token]">) {
  const { token } = await ctx.params;
  if (/^[0-9a-f]{32}$/.test(token)) {
    await onlineQuery(`update online_emails set open_count = open_count + 1, opened_at = coalesce(opened_at, now()), last_opened_at = now() where token = $1 and status = 'sent'`, [token]).catch(() => {});
  }
  return new Response(GIF, { headers: { "content-type": "image/gif", "content-length": String(GIF.length), "cache-control": "no-store, max-age=0" } });
}
