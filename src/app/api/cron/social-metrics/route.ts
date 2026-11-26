import { createHash, timingSafeEqual } from "node:crypto";
import { refreshSnapshots } from "@/lib/social-snapshots";

// Vercel Cron → reads every tracked post's likes, comments, reposts and views
// and saves them for /social-media. See src/lib/social-snapshots.ts. CRON_SECRET protected.
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await refreshSnapshots()) });
  } catch (err) {
    console.error("cron.social-metrics failed", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
