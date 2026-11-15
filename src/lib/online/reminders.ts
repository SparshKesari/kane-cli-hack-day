import "server-only";
import { onlineEvent } from "@/data/online";
import { onlineQuery } from "./db";
import { emailsOn, sendEmail, siteUrl } from "./email";
import { checkPosts } from "./links";

// Deadline reminders for the online hackathon: one "3 days to go" and one
// "24 hours to go" email to every registered person, worded for where their
// team stands:
//   - submitted, 3+ posts logged  → the showcase page to share, keep posting
//   - submitted, fewer than 3     → the showcase page, plus a gentle nudge to post
//   - on a team, not submitted    → submit before the deadline
//   - no team yet                 → set up or join a team, then submit
// Run by /api/cron/online-reminders. Each person gets each reminder once: an
// email already logged in online_emails under that kind is never sent again.
// Nothing is sent, or logged, while emails are off (ONLINE_EMAILS).

/** Each reminder may go out during the 12 hours after its mark, so a missed cron run or a slow batch still lands. */
export const REMINDERS = [
  { kind: "reminder_3d", left: "3 days", fromHours: 72, toHours: 60 },
  { kind: "reminder_24h", left: "24 hours", fromHours: 24, toHours: 12 },
] as const;
export type Reminder = (typeof REMINDERS)[number];

/** We recommend three posts: kickoff, mid-week, launch (see /o/launch). */
const POSTS_RECOMMENDED = 3;
/** Gmail accepts a few hundred messages a day; a run sends at most this many and the next run carries on. */
const BATCH = 40;

export function reminderDue(now = new Date()): Reminder | null {
  const hoursLeft = (new Date(onlineEvent.submissionDeadline).getTime() - now.getTime()) / 3_600_000;
  return REMINDERS.find((r) => hoursLeft <= r.fromHours && hoursLeft > r.toHours) ?? null;
}

type Person = {
  name: string;
  email: string;
  team: string | null;
  slug: string | null;
  hidden: boolean | null;
  status: string | null;
  project_name: string | null;
  hn_url: string | null;
  x_url: string | null;
  reddit_url: string | null;
  linkedin_url: string | null;
  other_posts: string | null;
};

export type Variant = "share" | "nudge" | "submit" | "no_team";

export function variantFor(p: Person): { variant: Variant; posts: number } {
  if (!p.team) return { variant: "no_team", posts: 0 };
  if (p.status !== "submitted") return { variant: "submit", posts: 0 };
  const posts = checkPosts({ hn_url: p.hn_url, x_url: p.x_url, reddit_url: p.reddit_url, linkedin_url: p.linkedin_url, other_posts: p.other_posts }).count;
  return { variant: posts >= POSTS_RECOMMENDED ? "share" : "nudge", posts };
}

export function reminderEmail(r: Reminder, p: Person): { subject: string; body: string } {
  const site = siteUrl();
  const { variant, posts } = variantFor(p);
  const closes = `${r.left} to go. Submissions close ${onlineEvent.deadlineLabel}.`;
  const project = p.project_name ?? p.team ?? "your project";

  if (variant === "no_team") {
    return {
      subject: `${r.left} to go: set up your team and submit`,
      body: `Hi ${p.name},\n\n${closes}\n\nYou're registered but not on a team yet. Create one (solo is fine) or join with a teammate's code:\n${site}/o/team\n\nThen build, verify with Kane CLI, and submit here:\n${site}/o/submit\n\nTwo public posts about your project are needed to submit. Ideas and sample posts: ${site}/o/launch`,
    };
  }
  if (variant === "submit") {
    return {
      subject: `${r.left} to go: submit ${p.team}'s project`,
      body: `Hi ${p.name},\n\n${closes}\n\nYour team "${p.team}" hasn't submitted yet${p.status === "draft" ? ", but your draft is saved" : ""}. Anyone on the team can finish it:\n${site}/o/submit\n\nYou can submit now and keep editing until the deadline, so there's no reason to wait for the last hour.\n\nTwo public posts about your project are needed to submit. Ideas and sample posts: ${site}/o/launch`,
    };
  }

  // Submitted. A team an organiser has hidden has no public page to share.
  const page = p.hidden ? "" : `\n\nIts showcase page is live. This is the link to share:\n${site}/o/p/${p.slug}`;
  const logged = `${posts} ${posts === 1 ? "post" : "posts"}`;
  const posting =
    variant === "nudge"
      ? `A gentle nudge on posting: your team has logged ${logged} so far, and we recommend at least ${POSTS_RECOMMENDED} (kickoff, mid-week, launch). Posts are how people find your project, and every one earns brownie points. Ideas and sample posts: ${site}/o/launch`
      : `Your team has logged ${logged} so far. Keep going: every extra post, and its reach, earns brownie points.`;
  return {
    subject: `${r.left} to go: share ${project}`,
    body: `Hi ${p.name},\n\n${closes}\n\n"${project}" is submitted. Nice work.${page}\n\n${posting}\n\nAdd new post links to your submission, and keep improving it, any time before the deadline:\n${site}/o/submit`,
  };
}

/** Everyone registered who hasn't been sent this reminder yet (a failed attempt is tried again). */
async function pending(kind: string) {
  return onlineQuery<Person>(
    `select p.name, p.email, t.name as team, t.slug, t.hidden, s.status, s.project_name,
            s.hn_url, s.x_url, s.reddit_url, s.linkedin_url, s.other_posts
       from online_participants p
       left join online_teams t on t.id = p.team_id
       left join online_submissions s on s.team_id = t.id
      where not exists (
        select 1 from online_emails e where e.kind = $1 and lower(e.to_email) = lower(p.email) and e.status <> 'failed'
      )
      order by p.id`,
    [kind],
  );
}

export type ReminderRun = { due: string | null; emailsOn: boolean; pending: number; sent: number; byVariant: Record<Variant, number> };

/**
 * Sends the reminder that is due now, a batch at a time. With `dry`, sends
 * nothing and reports who would get what; `preview` picks a reminder even
 * when none is due, for checking the counts ahead of time.
 */
export async function runReminders(opts: { dry?: boolean; preview?: string | null } = {}): Promise<ReminderRun> {
  const due = (opts.dry && REMINDERS.find((r) => r.kind === opts.preview)) || reminderDue();
  const byVariant: Record<Variant, number> = { share: 0, nudge: 0, submit: 0, no_team: 0 };
  const on = emailsOn();
  if (!due) return { due: null, emailsOn: on, pending: 0, sent: 0, byVariant };

  const people = await pending(due.kind);
  for (const p of people) byVariant[variantFor(p).variant]++;
  let sent = 0;
  if (!opts.dry && on) {
    for (const p of people.slice(0, BATCH)) {
      const { subject, body } = reminderEmail(due, p);
      await sendEmail(p.email, due.kind, subject, body);
      sent++;
    }
  }
  return { due: due.kind, emailsOn: on, pending: people.length, sent, byVariant };
}
