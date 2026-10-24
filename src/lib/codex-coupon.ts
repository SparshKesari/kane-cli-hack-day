// The Codex coupon by email (pure; unit tested): SMTP settings from the environment,
// the email a participant gets, the internal roster API's token check and the
// "add people to the participant list" request.
//
// Sending defaults to Gmail with an app password (SMTP_USER + SMTP_PASS): no DNS
// records or provider approval needed. SMTP_HOST / SMTP_PORT / MAIL_FROM switch
// to any other SMTP service.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

type Env = Record<string, string | undefined>;

export type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string };

export function smtpConfig(env: Env = process.env): SmtpConfig | null {
  const user = env.SMTP_USER?.trim();
  // Google shows an app password as four groups of four; the spaces are not part of it.
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");
  if (!user || !pass) return null;
  const port = Number(env.SMTP_PORT) || 465;
  return { host: env.SMTP_HOST?.trim() || "smtp.gmail.com", port, secure: port === 465, user, pass, from: env.MAIL_FROM?.trim() || `Kane CLI Hack Day <${user}>` };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function couponEmail(input: { name: string | null; code: string }) {
  const who = input.name?.trim() || "there";
  const subject = "Your OpenAI Codex coupon for Kane CLI Hack Day";
  const text = [
    `Hi ${who},`,
    "",
    "Here is your OpenAI Codex coupon for Kane CLI Hack Day:",
    "",
    `    ${input.code}`,
    "",
    "Redeem it on OpenAI to add the credits to your account, then go back to Codex and carry on with $hack-os.",
    "",
    "One coupon per person: please keep it to yourself.",
    "Questions? Ask at the help desk or at https://www.kaneclihack.sh/help.",
    "",
    "Kane CLI Hack Day",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(who)},</p>
<p>Here is your OpenAI Codex coupon for Kane CLI Hack Day:</p>
<p style="font:600 18px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.04em">${escapeHtml(input.code)}</p>
<p>Redeem it on OpenAI to add the credits to your account, then go back to Codex and carry on with <code>$hack-os</code>.</p>
<p>One coupon per person: please keep it to yourself.<br>Questions? Ask at the help desk or at <a href="https://www.kaneclihack.sh/help">kaneclihack.sh/help</a>.</p>
<p>Kane CLI Hack Day</p>`;
  return { subject, text, html };
}

/** `Authorization: Bearer <secret>`, compared in constant time. A secret under 16 characters counts as not set. */
export function bearerOk(header: string | null | undefined, secret: string | undefined) {
  if (!secret || secret.length < 16 || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const person = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).nullish().transform((s) => s || null),
});
const rosterAddSchema = z.union([z.object({ people: z.array(person).min(1).max(500) }), person.transform((p) => ({ people: [p] }))]);

export type RosterPerson = { email: string; name: string | null };

/** `{ email, name? }` or `{ people: [{ email, name? }, …] }` (up to 500) → people, first of each email kept. */
export function parseRosterAdd(body: unknown): RosterPerson[] {
  const { people } = rosterAddSchema.parse(body);
  const seen = new Set<string>();
  return people.filter((p) => !seen.has(p.email) && !!seen.add(p.email)).map((p) => ({ email: p.email, name: p.name }));
}
