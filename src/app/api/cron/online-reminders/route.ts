import { createHash, timingSafeEqual } from "node:crypto";
import { runReminders } from "@/lib/online/reminders";

// Vercel Cron → the online hackathon's scheduled emails (the deadline-extended
// notice, "3 days to go", "1 day to go", last call). See src/lib/online/reminders.ts. CRON_SECRET protected.
// Does nothing outside a reminder's window, and nothing while emails are off.
//
// ?dry=1 sends nothing and reports who would get which version;
// add &preview=deadline_extended or &preview=reminder_1d (any kind in SENDS) to check one ahead of time.
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    return Response.json({ ok: true, ...(await runReminders({ dry: q.get("dry") === "1", preview: q.get("preview") })) });
  } catch (err) {
    console.error("cron.online-reminders failed", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
