import "server-only";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { onlineEvent, onlineLinks } from "@/data/online";
import { smtpConfig } from "@/lib/codex-coupon";
import { onlineQuery } from "./db";

// Every email the online hackathon sends. Each one is written to
// online_emails first (so organisers see it in /admin even when SMTP isn't set
// up or sending is switched off), then sent through the same SMTP settings the
// SF site uses (SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT) when ONLINE_EMAILS=on.
// ONLINE_MAIL_FROM overrides the sender.

export function siteUrl() {
  const u = process.env.ONLINE_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return u.replace(/\/+$/, "");
}

/**
 * Sending is off until ONLINE_EMAILS=on (and SMTP is configured). While off,
 * every email is still written to online_emails so organisers can see what
 * would have gone out, and pages stop promising an email.
 */
export function emailsOn() {
  return process.env.ONLINE_EMAILS === "on" && smtpConfig() !== null;
}

export const CONTACT = "conferences@testmuai.com";

/** `optOut` adds the line reminders carry; `replyTo` sends replies somewhere other than the sending mailbox. */
export type SendOptions = { optOut?: boolean; replyTo?: string };

const signOff = (optOut?: boolean) =>
  `\n\nQuestions? Join Slack: ${onlineLinks.slack}\nor write to ${CONTACT}${optOut ? `\n\nDon't want these reminders? Reply "stop" and we'll take you off the list.` : ""}\n\n${onlineEvent.name} · TestMu AI`;

/** "4 days", "1 day", "less than a day"; null once the deadline has passed. */
export function timeLeft(now = new Date()) {
  const ms = new Date(onlineEvent.submissionDeadline).getTime() - now.getTime();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  return days >= 2 ? `${days} days` : days === 1 ? "1 day" : "less than a day";
}

/**
 * The same words as the plain text, as HTML: links clickable, line breaks kept, plus the 1×1 image
 * that tells us the email was opened (src/app/o/e/[token]). Mail apps that show only text ignore it.
 */
function toHtml(text: string, token: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)]/g, (u) => `<a href="${u.replace(/"/g, "&quot;")}">${u}</a>`);
  const pixel = siteUrl().startsWith("https://") ? `<img src="${siteUrl()}/o/e/${token}" width="1" height="1" alt="" style="display:block;border:0">` : "";
  return `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111111;white-space:pre-wrap">${linked}</div>${pixel}`;
}

async function send(to: string, kind: string, subject: string, body: string, opts: SendOptions = {}) {
  const text = body + signOff(opts.optOut);
  const token = randomBytes(16).toString("hex");
  const [row] = await onlineQuery<{ id: number }>(`insert into online_emails (to_email, kind, subject, body, token) values ($1, $2, $3, $4, $5) returning id`, [to, kind, subject, text, token]);
  const smtp = emailsOn() ? smtpConfig() : null;
  if (!smtp) {
    await onlineQuery(`update online_emails set status = 'not_configured' where id = $1`, [row.id]);
    return;
  }
  try {
    const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
    await transport.sendMail({ from: process.env.ONLINE_MAIL_FROM?.trim() || `${onlineEvent.name} <${smtp.user}>`, to, subject, text, html: toHtml(text, token), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) });
    await onlineQuery(`update online_emails set status = 'sent' where id = $1`, [row.id]);
  } catch (err) {
    await onlineQuery(`update online_emails set status = 'failed', error = $2 where id = $1`, [row.id, String(err instanceof Error ? err.message : err).slice(0, 500)]);
  }
}

/** Never let a mail problem break the action that triggered it. */
const quiet = (p: Promise<void>) => p.catch(() => {});

/** For emails composed elsewhere (the deadline reminders): logged and sent the same way as the rest. */
export const sendEmail = (to: string, kind: string, subject: string, body: string, opts?: SendOptions) => quiet(send(to, kind, subject, body, opts));

export const emailWelcome = (to: string, name: string) => {
  const left = timeLeft();
  return quiet(
    send(
      to,
      "welcome",
      `You're registered for the ${onlineEvent.name}`,
      `Hi ${name},\n\nYou're in. Build it with any agent. Verify it with Kane. Ship by 19 November.\n\nSubmissions close ${onlineEvent.deadlineLabel}.${left ? ` You have ${left}.` : ""}\n\nOne rule to know now: you need two public posts about your project to submit.\n\nYour cheat sheet:\n1. Set up your team (solo is fine): ${siteUrl()}/o/team\n2. Register on TestMu AI: ${onlineLinks.register}\n3. Claim your Kane CLI licence (10,000 free credits): ${onlineLinks.claim}\n4. Install Kane CLI: npm install -g @testmuai/kane-cli\n5. Run one flow from the docs: ${onlineLinks.docs}\n6. Plan your two posts: ${siteUrl()}/o/launch\n\nWhen you're ready, submit here: ${siteUrl()}/o/submit`,
    ),
  );
};

export const emailTeamCreated = (to: string, name: string, team: string, code: string) =>
  quiet(send(to, "team_created", `Your team code: ${code}`, `Hi ${name},\n\nYou're the captain of "${team}".\n\nShare this code with your teammates (up to 4 people in total):\n\n    ${code}\n\nThey register at ${siteUrl()}/o/register, choose "Join a team", and enter it.\n\nManage your team: ${siteUrl()}/o/team`));

export const emailTeammateJoined = (to: string, captain: string, joiner: string, team: string) =>
  quiet(send(to, "teammate_joined", `${joiner} joined ${team}`, `Hi ${captain},\n\n${joiner} just joined your team "${team}" with your code.\n\nNot someone you know? Remove them here: ${siteUrl()}/o/team`));

export const emailJoinedTeam = (to: string, name: string, team: string) =>
  quiet(send(to, "joined_team", `You joined ${team}`, `Hi ${name},\n\nYou're on the team "${team}". Anyone on the team can edit the submission.\n\nGet set up: ${siteUrl()}/o/start\nSubmission: ${siteUrl()}/o/submit\n\nSubmissions close ${onlineEvent.deadlineLabel}. Your team needs two public posts about the project to submit.`));

export const emailReceipt = (to: string, name: string, p: { project: string; team: string; receipt: string; when: string; slug: string; updated: boolean; editor: string }) =>
  quiet(
    send(
      to,
      p.updated ? "submission_updated" : "submission_receipt",
      `${p.updated ? "Submission updated" : "Submission received"}: ${p.project} (${p.receipt})`,
      `Hi ${name},\n\n${p.updated ? `${p.editor} updated your team's submission.` : "We have your team's submission."}\n\nProject:  ${p.project}\nTeam:     ${p.team}\nReceipt:  ${p.receipt}\nSaved at: ${p.when}\n\nYour showcase page: ${siteUrl()}/o/p/${p.slug}\n\nYou can keep editing until ${onlineEvent.deadlineLabel}: ${siteUrl()}/o/submit${p.updated ? "" : "\nKeep posting about it. Every extra post earns brownie points."}`,
    ),
  );

/** Whether this team was already told about an update in the last hour: a team saving often gets one email an hour, not one per save. */
export async function updateEmailedRecently(memberEmails: string[]) {
  if (!memberEmails.length) return false;
  const [row] = await onlineQuery<{ n: number }>(
    `select count(*)::int as n from online_emails where kind = 'submission_updated' and created_at > now() - interval '1 hour' and lower(to_email) = any($1::text[])`,
    [memberEmails.map((e) => e.toLowerCase())],
  );
  return (row?.n ?? 0) > 0;
}

export const emailPasswordReset = (to: string, name: string, link: string) =>
  quiet(send(to, "password_reset", `Reset your ${onlineEvent.name} password`, `Hi ${name},\n\nUse this link to choose a new password. It works once and expires in one hour:\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.`));
