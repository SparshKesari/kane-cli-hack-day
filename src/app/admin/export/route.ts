import { adminEmails, adminPeople, adminTeams, isAdmin } from "@/lib/online/admin";
import { checkPosts } from "@/lib/online/links";

// CSV exports for organisers. Cells that a spreadsheet would run as a formula are neutralised.
const cell = (v: unknown) => {
  let s = v instanceof Date ? v.toISOString() : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
const csv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");

export async function GET(request: Request) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const what = q.get("what") === "people" ? "people" : q.get("what") === "emails" ? "emails" : "submissions";
  const body =
    what === "emails"
      ? csv(
          ["Sent at", "To", "Kind", "Subject", "Status", "Error", "Opened", "First opened", "Last opened", "Times opened"],
          (await adminEmails(q.get("to"), 50_000)).map((e) => [e.created_at, e.to_email, e.kind, e.subject, e.status, e.error, e.status !== "sent" ? "" : e.opened_at ? "yes" : e.token_missing ? "not tracked" : "no", e.opened_at, e.last_opened_at, e.status === "sent" && !e.token_missing ? e.open_count : ""]),
        )
      : what === "people"
      ? csv(["Name", "Email", "Team", "X", "LinkedIn", "Other links", "Registered", "Last login", "Emails sent", "Emails opened"], (await adminPeople()).map((p) => [p.name, p.email, p.team, p.x_url, p.linkedin_url, p.other_links, p.created_at, p.last_login_at, p.emails_sent, p.emails_opened]))
      : csv(
          ["Status", "Receipt", "Project", "One-liner", "Team", "Solo", "Captain", "Captain email", "Members", "Agent", "Repo", "Video", "Live URL", "Post count", "X posts", "LinkedIn posts", "Hacker News posts", "Reddit posts", "Other posts", "Attachments", "First submitted", "Last saved", "Showcase page", "Hidden", "Details", "More details"],
          (await adminTeams()).map((t) => [t.status ?? "no draft", t.receipt_code, t.project_name, t.one_line_pitch, t.name, t.solo ? "yes" : "no", t.captain, t.captain_email, t.members, t.agent_used, t.repo_url, t.video_url, t.live_url, checkPosts(t as unknown as Record<string, string | null>).count, t.x_url, t.linkedin_url, t.hn_url, t.reddit_url, t.other_posts, t.files, t.submitted_at, t.updated_at, `/o/p/${t.slug}`, t.hidden ? "yes" : "no", t.project_description, t.more_details]),
        );
  return new Response(`﻿${body}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="online-hackathon-${what}.csv"`, "cache-control": "no-store" } });
}
