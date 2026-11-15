import "server-only";
import { onlineEvent } from "@/data/online";
import { onlineQuery } from "./db";
import { CONTACT, emailsOn, sendEmail, siteUrl, type SendOptions } from "./email";
import { checkPosts } from "./links";

// The online hackathon's scheduled emails. Run by /api/cron/online-reminders.
//
//   3 days left     16 Nov, 7:00 PM IST   everyone, worded for where their team stands
//   1 day left      18 Nov, 7:00 PM IST   everyone, worded for where their team stands
//   Last call       3 hours before close  only teams with a saved draft that isn't submitted
//   After deadline  20 Nov, 10:00 AM IST  thank you to those who submitted, a closing note to the rest
//
// Who gets which wording is worked out when the email is sent, so a team that
// submits an hour before a send gets the "submitted" version. Each person gets
// each send once: an email already logged in online_emails under that kind is
// never sent again (a failed one is retried). People an organiser has taken off
// the list (/admin, People) get none of them. Nothing is sent, or logged, while
// emails are off (ONLINE_EMAILS).

const deadline = () => new Date(onlineEvent.submissionDeadline).getTime();
const HOUR = 3_600_000;

/** `at` opens the send; it stays open for `openHours` so a missed cron run or a slow batch still lands. */
export const SENDS = [
  { kind: "reminder_3d", left: "3 days", at: () => Date.parse("2026-11-16T19:00:00+05:30"), openHours: 6 },
  { kind: "reminder_1d", left: "1 day", at: () => Date.parse("2026-11-18T19:00:00+05:30"), openHours: 6 },
  { kind: "reminder_last_call", left: "3 hours", at: () => deadline() - 3 * HOUR, openHours: 1 },
  { kind: "after_deadline", left: "", at: () => Date.parse("2026-11-20T10:00:00+05:30"), openHours: 12 },
] as const;
export type Send = (typeof SENDS)[number];
export type SendKind = Send["kind"];

/**
 * The two after-deadline emails name things only an organiser knows. Until
 * these are filled in, that email is held back rather than sent with a gap.
 */
const AFTER_DEADLINE = {
  /** e.g. "20 to 24 November". Needed for the thank-you email. */
  judging: "",
  /** e.g. "25 November, on this page and in Slack". Needed for the thank-you email. */
  results: "",
  /** Set to true once it's confirmed the Kane CLI licence keeps working after the hackathon. Needed for the closing note. */
  licenceStaysValid: false,
};

/** We recommend three posts (kickoff, mid-week, launch); two are needed to submit. See /o/launch. */
const POSTS_RECOMMENDED = 3;
const POSTS_REQUIRED = 2;
/** Gmail accepts a few hundred messages a day; a run sends at most this many and the next run carries on. */
const BATCH = 40;

export function sendDue(now = new Date()): Send | null {
  const t = now.getTime();
  return SENDS.find((s) => t >= s.at() && t < s.at() + s.openHours * HOUR) ?? null;
}

type Person = {
  name: string;
  email: string;
  team: string | null;
  slug: string | null;
  hidden: boolean | null;
  /** The team's submission: null when nothing has been saved. */
  status: string | null;
  project_name: string | null;
  hn_url: string | null;
  x_url: string | null;
  reddit_url: string | null;
  linkedin_url: string | null;
  other_posts: string | null;
};

/** Where a person's team stands. */
export type Segment = "submitted" | "draft" | "not_started" | "no_team";

export function segmentOf(p: Person): Segment {
  if (!p.team) return "no_team";
  return p.status === "submitted" ? "submitted" : p.status === "draft" ? "draft" : "not_started";
}

const postCount = (p: Person) => checkPosts({ hn_url: p.hn_url, x_url: p.x_url, reddit_url: p.reddit_url, linkedin_url: p.linkedin_url, other_posts: p.other_posts }).count;
const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

export type Composed = { subject: string; body: string; opts: SendOptions };

/** The email for this person in this send, or null when this send has nothing for them. */
export function compose(s: Send, p: Person): Composed | null {
  const site = siteUrl();
  const seg = segmentOf(p);
  const n = postCount(p);
  const project = p.project_name ?? p.team ?? "your project";
  const closes = `${s.left} left. Submissions close ${onlineEvent.deadlineLabel}.`;
  const prizes = `${onlineEvent.facts[1]}. How projects are judged: ${site}/#judging`;
  const twoPosts = `You need two public posts about your project to submit`;
  const reminder: SendOptions = { optOut: true };
  const replies: SendOptions = { optOut: true, replyTo: CONTACT };

  if (s.kind === "reminder_3d" || s.kind === "reminder_1d") {
    const threeDays = s.kind === "reminder_3d";

    if (seg === "no_team") {
      return {
        subject: `${s.left} left: set up your team and submit`,
        body: `Hi ${p.name},\n\n${closes}\n\nYou're registered but not on a team yet. Create one (solo is fine) or join with a teammate's code:\n${site}/o/team\n\nThen get Kane CLI running, build, and submit:\n${site}/o/start\n${site}/o/submit\n\n${twoPosts}. Ideas and sample posts: ${site}/o/launch`,
        opts: reminder,
      };
    }

    if (seg === "not_started") {
      return threeDays
        ? {
            subject: `${s.left} left: is Kane CLI working for you?`,
            body: `Hi ${p.name},\n\n${closes}\n\nYour team "${p.team}" hasn't started a submission yet. If setup is what's in the way, here it is in four steps:\n1. Register on TestMu AI: https://www.testmuai.com/register/\n2. Claim your Kane CLI licence (10,000 free credits): https://www.testmuai.com/kane-cli/#creditOffer\n3. Install Kane CLI: npm install -g @testmuai/kane-cli\n4. Run one flow from the docs: https://www.testmuai.com/support/docs/kane-cli-introduction/\n\nEverything in order: ${site}/o/start\n\nStuck on something? Reply to this email and tell us where, or ask in Slack.\n\nThere's still time, and a small project that works beats a big one that doesn't. ${twoPosts}: ${site}/o/launch\n\n${prizes}`,
            opts: replies,
          }
        : {
            subject: `${s.left} left: a small project still counts`,
            body: `Hi ${p.name},\n\n${closes}\n\nYour team "${p.team}" hasn't started a submission. A day is enough for a small project that works, and that beats a big one that doesn't.\n\nSetup, in order: ${site}/o/start\nSubmit: ${site}/o/submit\n\n${twoPosts}: ${site}/o/launch\n\nStuck? Reply to this email or ask in Slack.`,
            opts: replies,
          };
    }

    if (seg === "draft") {
      const need = `${twoPosts}, and your draft has ${n} so far. Ideas and sample posts: ${site}/o/launch`;
      return threeDays
        ? {
            subject: `${s.left} left: finish ${p.team}'s submission`,
            body: `Hi ${p.name},\n\n${closes}\n\nYour team "${p.team}" has a draft saved but hasn't submitted. Anyone on the team can finish it:\n${site}/o/submit\n\nYou can submit now and keep editing until the deadline, so there's no reason to wait for the last hour.\n\n${need}\n\n${prizes}`,
            opts: reminder,
          }
        : {
            subject: `${s.left} left: ${p.team}'s draft isn't submitted`,
            body: `Hi ${p.name},\n\n${closes}\n\nYour team "${p.team}" has a draft saved but hasn't submitted. Anyone on the team can finish it:\n${site}/o/submit\n\nSubmit today and keep editing until the deadline. A submitted draft counts; an unsubmitted one doesn't.\n\n${need}`,
            opts: reminder,
          };
    }

    // Submitted. A team an organiser has hidden has no public page to share or check.
    const page = `${site}/o/p/${p.slug}`;
    if (threeDays) {
      const share = p.hidden ? "" : `\n\nIts showcase page is live. This is the link to share:\n${page}`;
      const posting =
        n >= POSTS_RECOMMENDED
          ? `Your team has logged ${posts(n)} so far. Keep going: every extra post, and its reach, earns brownie points.`
          : `A gentle nudge on posting: your team has logged ${posts(n)} so far, and we recommend at least ${POSTS_RECOMMENDED} (kickoff, mid-week, launch). Posts are how people find your project, and every one earns brownie points. Ideas and sample posts: ${site}/o/launch`;
      return {
        subject: `${s.left} left: share ${project}`,
        body: `Hi ${p.name},\n\n${closes}\n\n"${project}" is submitted. Nice work.${share}\n\n${posting}\n\nAdd new post links to your submission, and keep improving it, any time before the deadline:\n${site}/o/submit`,
        opts: reminder,
      };
    }
    const checks = [
      ...(p.hidden ? [] : [`- Open your showcase page while logged out and read it as a judge would: ${page}`]),
      `- Click every link in your submission and make sure it opens for someone outside your team`,
      `- Add any post links you haven't logged yet. Your team has ${n} so far.${n < POSTS_RECOMMENDED ? ` We recommend at least ${POSTS_RECOMMENDED} (kickoff, mid-week, launch).` : ""}`,
    ];
    return {
      subject: `${s.left} left: final check on ${project}`,
      body: `Hi ${p.name},\n\n${closes}\n\n"${project}" is submitted. Before the deadline, take five minutes to check it:\n${checks.join("\n")}\n\nEdit until the deadline: ${site}/o/submit`,
      opts: reminder,
    };
  }

  if (s.kind === "reminder_last_call") {
    if (seg !== "draft") return null;
    const missing = n < POSTS_REQUIRED ? `\n\nYour draft has ${n} of the ${POSTS_REQUIRED} post links you need. Add the missing ones first, or Submit won't go through.` : "";
    return {
      subject: `3 hours left: your draft isn't submitted yet`,
      body: `Hi ${p.name},\n\nSubmissions close in 3 hours, at ${onlineEvent.deadlineLabel}.\n\nYour team "${p.team}" has a draft saved but it isn't submitted. Press Submit here:\n${site}/o/submit${missing}`,
      opts: {},
    };
  }

  // After the deadline.
  if (seg === "submitted") {
    if (!AFTER_DEADLINE.judging || !AFTER_DEADLINE.results) return null;
    const page = p.hidden ? "" : `Your showcase page stays up: ${site}/o/p/${p.slug}\n`;
    return {
      subject: `Thank you for submitting: what happens next`,
      body: `Hi ${p.name},\n\nSubmissions are closed, and "${project}" is in. Thank you for building with us this week.\n\nWhat happens next:\n- Judging: ${AFTER_DEADLINE.judging}\n- Results: ${AFTER_DEADLINE.results}\n\n${page}Every project is at ${site}/showcase\n\nPosts still count for reach, so keep sharing.`,
      opts: {},
    };
  }
  if (!AFTER_DEADLINE.licenceStaysValid) return null;
  return {
    subject: `The ${onlineEvent.name} has closed`,
    body: `Hi ${p.name},\n\nSubmissions for the ${onlineEvent.name} are closed. Your team didn't get one in this time, and that's fine: a week is short.\n\nYour Kane CLI licence still works, so whatever you started doesn't have to stop here. Docs: https://www.testmuai.com/support/docs/kane-cli-introduction/\n\nSee what other teams built: ${site}/showcase\n\nIf something got in your way this week, reply and tell us. It helps us run the next one better.`,
    opts: { replyTo: CONTACT },
  };
}

/** The marker an organiser's "stop reminders" leaves in online_emails. Never an email. */
export const OPT_OUT_KIND = "reminder_optout";

/** Everyone registered who hasn't had this send and hasn't been taken off the list. */
async function pending(kind: string) {
  return onlineQuery<Person>(
    `select p.name, p.email, t.name as team, t.slug, t.hidden, s.status, s.project_name,
            s.hn_url, s.x_url, s.reddit_url, s.linkedin_url, s.other_posts
       from online_participants p
       left join online_teams t on t.id = p.team_id
       left join online_submissions s on s.team_id = t.id
      where not exists (
        select 1 from online_emails e
         where lower(e.to_email) = lower(p.email) and ((e.kind = $1 and e.status <> 'failed') or e.kind = $2)
      )
      order by p.id`,
    [kind, OPT_OUT_KIND],
  );
}

export type ReminderRun = { due: string | null; emailsOn: boolean; pending: number; held: number; sent: number; bySegment: Record<Segment, number> };

/**
 * Sends whatever is due now, a batch at a time. With `dry`, sends nothing and
 * reports who would get what; `preview` picks a send even when none is due.
 * `held` counts people this send has no email for (wrong segment, or details
 * an organiser still has to fill in).
 */
export async function runReminders(opts: { dry?: boolean; preview?: string | null } = {}): Promise<ReminderRun> {
  const due = (opts.dry && SENDS.find((s) => s.kind === opts.preview)) || sendDue();
  const bySegment: Record<Segment, number> = { submitted: 0, draft: 0, not_started: 0, no_team: 0 };
  const on = emailsOn();
  if (!due) return { due: null, emailsOn: on, pending: 0, held: 0, sent: 0, bySegment };

  const queue: { to: string; mail: Composed }[] = [];
  let held = 0;
  for (const p of await pending(due.kind)) {
    const mail = compose(due, p);
    if (!mail) {
      held++;
      continue;
    }
    bySegment[segmentOf(p)]++;
    queue.push({ to: p.email, mail });
  }
  let sent = 0;
  if (!opts.dry && on) {
    for (const { to, mail } of queue.slice(0, BATCH)) {
      await sendEmail(to, due.kind, mail.subject, mail.body, mail.opts);
      sent++;
    }
  }
  return { due: due.kind, emailsOn: on, pending: queue.length, held, sent, bySegment };
}
