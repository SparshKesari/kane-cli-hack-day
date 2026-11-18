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

/**
 * `optOut` adds the line reminders carry; `replyTo` sends replies somewhere other than the sending
 * mailbox; `ownClosing` is for a body that ends with its own "questions?" line, so the Slack one is left out.
 */
export type SendOptions = { optOut?: boolean; replyTo?: string; ownClosing?: boolean };

const signOff = ({ optOut, ownClosing }: SendOptions) =>
  `${ownClosing ? "" : `\n\nQuestions? Join Slack: ${onlineLinks.slack}\nor write to ${CONTACT}`}${optOut ? `\n\nDon't want these reminders? Reply "stop" and we'll take you off the list.` : ""}\n\n${onlineEvent.name} · TestMu AI`;

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
  const text = body + signOff(opts);
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

/** The welcome. Written after the deadline moved to 26 November, so a new registrant's first email already carries it. */
export const emailWelcome = (to: string, name: string) =>
  quiet(
    send(
      to,
      "welcome",
      `You're in: ${onlineEvent.name}, submissions close ${onlineEvent.deadlineDay}`,
      `Hi ${name},\n\nYou're registered for the ${onlineEvent.name}. Welcome.\n\nThe deadline has been extended, so you have until ${onlineEvent.deadlineLabel} to build and submit.\n\nThe brief: build something with any coding agent, and use Kane CLI to prove it works.\n\nHow to get going:\n\n1. Create a team (solo is fine) or join with a teammate's code.\n2. Claim your 10,000 free Kane CLI credits and install Kane CLI:\n   npm install -g @testmuai/kane-cli\n3. Build your project and run Kane CLI against it as you go.\n4. Publish two public posts about your project, then submit. You can submit early and keep editing until the deadline.\n\nAll of it starts here:\n${siteUrl()}\n\nA small project that works beats a big one that doesn't, so start small and ship.\n\nStuck on something? Reply to this email and tell us where, or write to ${CONTACT}`,
      { ownClosing: true, replyTo: CONTACT },
    ),
  );

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
