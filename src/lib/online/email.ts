import "server-only";
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

const SIGN_OFF = `\n\nQuestions? Join Slack: ${onlineLinks.slack}\nor write to conferences@testmuai.com\n\n${onlineEvent.name} · TestMu AI`;

async function send(to: string, kind: string, subject: string, body: string) {
  const text = body + SIGN_OFF;
  const [row] = await onlineQuery<{ id: number }>(`insert into online_emails (to_email, kind, subject, body) values ($1, $2, $3, $4) returning id`, [to, kind, subject, text]);
  const smtp = emailsOn() ? smtpConfig() : null;
  if (!smtp) {
    await onlineQuery(`update online_emails set status = 'not_configured' where id = $1`, [row.id]);
    return;
  }
  try {
    const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
    await transport.sendMail({ from: process.env.ONLINE_MAIL_FROM?.trim() || `${onlineEvent.name} <${smtp.user}>`, to, subject, text });
    await onlineQuery(`update online_emails set status = 'sent' where id = $1`, [row.id]);
  } catch (err) {
    await onlineQuery(`update online_emails set status = 'failed', error = $2 where id = $1`, [row.id, String(err instanceof Error ? err.message : err).slice(0, 500)]);
  }
}

/** Never let a mail problem break the action that triggered it. */
const quiet = (p: Promise<void>) => p.catch(() => {});

export const emailWelcome = (to: string, name: string) =>
  quiet(
    send(
      to,
      "welcome",
      `You're registered for the ${onlineEvent.name}`,
      `Hi ${name},\n\nYou're in. ${onlineEvent.tagline}\n\nBuilding runs 12 to 19 November. Submissions close ${onlineEvent.deadlineLabel}.\n\nYour cheat sheet:\n1. Set up your team: ${siteUrl()}/online/team\n2. Register on TestMu AI: ${onlineLinks.register}\n3. Claim your Kane CLI licence (10,000 free credits): ${onlineLinks.claim}\n4. Install Kane CLI: npm install -g @testmuai/kane-cli\n5. Run one flow from the docs: ${onlineLinks.docs}\n6. Get your social accounts ready and plan your posts: ${siteUrl()}/online/launch\n\nWhen you're ready, submit here: ${siteUrl()}/online/submit`,
    ),
  );

export const emailTeamCreated = (to: string, name: string, team: string, code: string) =>
  quiet(send(to, "team_created", `Your team code: ${code}`, `Hi ${name},\n\nYou're the captain of "${team}".\n\nShare this code with your teammates (up to 4 people in total):\n\n    ${code}\n\nThey register at ${siteUrl()}/online/register, choose "Join a team", and enter it.\n\nManage your team: ${siteUrl()}/online/team`));

export const emailTeammateJoined = (to: string, captain: string, joiner: string, team: string) =>
  quiet(send(to, "teammate_joined", `${joiner} joined ${team}`, `Hi ${captain},\n\n${joiner} just joined your team "${team}" with your code.\n\nNot someone you know? Remove them here: ${siteUrl()}/online/team`));

export const emailJoinedTeam = (to: string, name: string, team: string) =>
  quiet(send(to, "joined_team", `You joined ${team}`, `Hi ${name},\n\nYou're on the team "${team}". Anyone on the team can edit the submission.\n\nGet set up: ${siteUrl()}/online/start\nSubmission: ${siteUrl()}/online/submit`));

export const emailReceipt = (to: string, name: string, p: { project: string; team: string; receipt: string; when: string; slug: string; updated: boolean }) =>
  quiet(
    send(
      to,
      p.updated ? "submission_updated" : "submission_receipt",
      `${p.updated ? "Submission updated" : "Submission received"}: ${p.project} (${p.receipt})`,
      `Hi ${name},\n\n${p.updated ? "Your team's submission was updated." : "We have your team's submission."}\n\nProject:  ${p.project}\nTeam:     ${p.team}\nReceipt:  ${p.receipt}\nSaved at: ${p.when}\n\nYour showcase page: ${siteUrl()}/online/p/${p.slug}\n\nYou can keep editing until ${onlineEvent.deadlineLabel}: ${siteUrl()}/online/submit\nKeep posting about it. Every extra post earns brownie points.`,
    ),
  );

export const emailPasswordReset = (to: string, name: string, link: string) =>
  quiet(send(to, "password_reset", `Reset your ${onlineEvent.name} password`, `Hi ${name},\n\nUse this link to choose a new password. It works once and expires in one hour:\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.`));
