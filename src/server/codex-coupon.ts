import "server-only";
import nodemailer from "nodemailer";
import { query } from "@/lib/db";
import { couponEmail, smtpConfig } from "@/lib/codex-coupon";
import { PLAN_MESSAGES } from "@/data/activation-steps";
import { AppError, emailHash, maskEmail, parse, transaction, writeAudit, zx, type Actor } from "./core";
import { log } from "./log";
import { enforceRateLimit } from "./ratelimit";

// The OpenAI Codex coupon by email (POST /api/v1/codex/coupon). The hack-os skill sends
// the participant's email when they reach the Codex step:
// - On the participant list (roster_guests: the Luma import, walk-ins, /api/import/roster)
//   and not revoked → the next code from the pool is mapped to that roster row (and to the
//   member with that email, if there is one) and emailed to the address. Asking again
//   re-sends the same code. A member who already had a code keeps it.
// - Not on the list, or revoked → nothing is sent.
// The code only ever goes to the inbox: the API answers sent / not_on_list / out_of_codes.
// Three emails an hour per listed address, so nobody can flood someone's inbox. Misses don't
// count against an address (someone added at the desk can retry at once); callers are capped
// instead: per IP on the REST route, per member on the event tool.

export type CouponOutcome = "sent" | "not_on_list" | "out_of_codes";
export type CouponResult = { outcome: CouponOutcome; resent: boolean; emailHint: string };

const PER_ADDRESS = { limit: 3, windowSec: 3600 };

export async function requestCodexCoupon(rawEmail: unknown): Promise<CouponResult> {
  const email = parse(zx.email, rawEmail);
  const hash = emailHash(email);
  const emailHint = maskEmail(email);
  const actor: Actor = { type: "anonymous", label: emailHint };
  const smtp = smtpConfig();
  if (!smtp) throw new AppError("FEATURE_DISABLED", { userMessage: "Coupon emails aren't set up yet. Ask at the help desk." });

  const guests = await query<{ id: number; name: string; admission_status: string }>(
    "select id, name, admission_status from roster_guests where event_id = current_event_id() and email_hash = $1 order by id",
    [hash],
  );
  if (!guests.length || guests.some((g) => g.admission_status === "revoked")) {
    await writeAudit(actor, { action: "codex_code.email_not_on_list", resourceType: "roster_guest", resourceId: hash.slice(0, 16) });
    return { outcome: "not_on_list", resent: false, emailHint };
  }
  await enforceRateLimit(`codex-coupon:${hash}`, PER_ADDRESS);
  const guest = guests[0];
  const [member] = await query<{ id: number }>("select id from members where lower(email) = $1 and deleted_at is null order by id limit 1", [email]);
  const memberId = member?.id ?? null;

  const got = await transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`codex-coupon:${hash}`]);
    // Theirs already: sent before (to any of their roster rows), or handed to their member by the old /activate
    // flow or a staff reassignment. A code already on a roster row wins, so linking never gives a row two codes.
    const { rows: mine } = await tx.query<{ id: number; code: string; extra: Record<string, unknown>; email_count: number }>(
      `select id, code, extra, email_count from codex_credit_codes
        where status = 'assigned' and event_id = current_event_id()
          and (assigned_guest_id = any($1::bigint[]) or ($2::bigint is not null and assigned_member_id = $2))
        order by (assigned_guest_id is not null) desc, assigned_at, id limit 1`,
      [guests.map((g) => g.id), memberId],
    );
    if (mine[0]) {
      await tx.query("update codex_credit_codes set assigned_guest_id = coalesce(assigned_guest_id, $2) where id = $1", [mine[0].id, guest.id]);
      return mine[0];
    }
    const { rows } = await tx.query<{ id: number; code: string; extra: Record<string, unknown>; email_count: number }>(
      `update codex_credit_codes set status = 'assigned', assigned_guest_id = $1, assigned_member_id = $2, assigned_at = now(), assigned_by = 'email'
        where id = (select id from codex_credit_codes where status = 'available' and event_id = current_event_id()
                     order by id for update skip locked limit 1)
        returning id, code, extra, email_count`,
      [guest.id, memberId],
    );
    if (rows[0]) await writeAudit(actor, { action: "codex_code.assign", resourceType: "codex_credit_code", resourceId: rows[0].id, payload: { guest_id: guest.id, member_id: memberId, code_suffix: rows[0].code.slice(-4), by: "email" } }, tx);
    return rows[0] ?? null;
  });
  if (!got) {
    await writeAudit(actor, { action: "codex_code.pool_empty", resourceType: "codex_credit_code", resourceId: guest.id });
    return { outcome: "out_of_codes", resent: false, emailHint };
  }

  // The pool CSV can carry a redemption link per code (a `link` column, kept in `extra`).
  const mail = couponEmail({ name: guest.name, code: got.code, link: got.extra?.link });
  try {
    const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
    await transport.sendMail({ from: smtp.from, to: email, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (err) {
    // The code stays mapped to them; a retry sends the same one.
    log.warn("codex_coupon.send_failed", { code_id: got.id, err });
    await writeAudit(actor, { action: "codex_code.email_failed", resourceType: "codex_credit_code", resourceId: got.id });
    throw new AppError("DOWNSTREAM_DEGRADED", { userMessage: "We couldn't send the email just now. Try again in a minute." });
  }
  await query("update codex_credit_codes set emailed_at = now(), email_count = email_count + 1, revealed_at = coalesce(revealed_at, now()) where id = $1", [got.id]);
  await writeAudit(actor, { action: "codex_code.email", resourceType: "codex_credit_code", resourceId: got.id, payload: { guest_id: guest.id, member_id: memberId, code_suffix: got.code.slice(-4), resent: got.email_count > 0 } });
  return { outcome: "sent", resent: got.email_count > 0, emailHint };
}

export const COUPON_MESSAGES: Record<CouponOutcome, (hint: string) => string> = {
  sent: (hint) => `Sent the Codex coupon to ${hint}. Check the inbox, and spam if it isn't there in a minute.`,
  not_on_list: () => "That email isn't on the participant list. Use the email you registered for the event with, or ask at the help desk.",
  out_of_codes: () => PLAN_MESSAGES.outOfCodes,
};
