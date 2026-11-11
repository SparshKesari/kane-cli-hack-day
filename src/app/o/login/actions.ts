"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/password";
import { onlineQuery } from "@/lib/online/db";
import { emailPasswordReset, emailWelcome } from "@/lib/online/email";
import { emailProblem } from "@/lib/online/email-check";
import { createResetLink, tokenHash } from "@/lib/online/reset";
import { clearOnlineSession, setOnlineSession } from "@/lib/online/session";

export type AuthState = { error: string } | { done: string } | null;

const link = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v) || null)
  .pipe(z.url({ protocol: /^https?$/, message: "Enter a full link, like https://x.com/you" }).nullable());

const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const email = z.email("Enter a valid email").trim().toLowerCase().max(200);

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email,
  password,
  x_url: link,
  linkedin_url: link,
  other_links: z.string().trim().max(500).transform((v) => v || null),
});

/** Step 1 of registration: yourself. Step 2 (/online/team) is your team. */
export async function registerAction(_: AuthState, form: FormData): Promise<AuthState> {
  const get = (k: string) => String(form.get(k) ?? "");
  const p = signupSchema.safeParse({ name: get("name"), email: get("email"), password: get("password"), x_url: get("x_url"), linkedin_url: get("linkedin_url"), other_links: get("other_links") });
  if (!p.success) return { error: p.error.issues[0].message };
  if (form.get("terms") !== "on") return { error: "Accept the contest rules and guidelines to register." };
  const problem = await emailProblem(p.data.email);
  if (problem) return { error: problem };

  const hash = await hashPassword(p.data.password);
  const [row] = await onlineQuery<{ id: number }>(
    `insert into online_participants (email, name, password_hash, x_url, linkedin_url, other_links, last_login_at, accepted_terms_at)
     values ($1, $2, $3, $4, $5, $6, now(), now())
     on conflict (lower(email)) do nothing returning id`,
    [p.data.email, p.data.name, hash, p.data.x_url, p.data.linkedin_url, p.data.other_links],
  );
  if (!row) return { error: "That email is already registered. Log in, or reset your password." };
  await emailWelcome(p.data.email, p.data.name);
  await setOnlineSession(row.id);
  redirect("/online/team");
}

const MAX_FAILS = 8;

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const p = z.object({ email, password: z.string().min(1, "Enter your password").max(200) }).safeParse({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
  if (!p.success) return { error: p.error.issues[0].message };
  const [row] = await onlineQuery<{ id: number; password_hash: string; locked: boolean }>(
    `select id, password_hash, coalesce(locked_until > now(), false) as locked from online_participants where lower(email) = $1`,
    [p.data.email],
  );
  // Too many wrong passwords: wait, or reset. Stops password guessing.
  if (row?.locked) return { error: "Too many wrong passwords. Wait 15 minutes, or reset your password." };
  if (!row || !(await verifyPassword(p.data.password, row.password_hash))) {
    if (row) {
      await onlineQuery(
        `update online_participants set failed_logins = failed_logins + 1,
                locked_until = case when failed_logins + 1 >= $2 then now() + interval '15 minutes' else locked_until end where id = $1`,
        [row.id, MAX_FAILS],
      );
    }
    return { error: "Wrong email or password." };
  }
  await onlineQuery(`update online_participants set last_login_at = now(), failed_logins = 0, locked_until = null where id = $1`, [row.id]);
  await setOnlineSession(row.id);
  redirect("/online/submit");
}

export async function logoutAction() {
  await clearOnlineSession();
  redirect("/");
}

/** Always answers the same way, so nobody can learn which emails are registered. */
export async function forgotAction(_: AuthState, form: FormData): Promise<AuthState> {
  const p = email.safeParse(String(form.get("email") ?? ""));
  if (!p.success) return { error: "Enter a valid email." };
  const [row] = await onlineQuery<{ id: number; name: string; email: string }>(`select id, name, email from online_participants where lower(email) = $1`, [p.data]);
  if (row) await emailPasswordReset(row.email, row.name, await createResetLink(row.id));
  return { done: "If that email is registered, a reset link is on its way. It expires in one hour. Check your spam folder too." };
}

export async function resetAction(token: string, _: AuthState, form: FormData): Promise<AuthState> {
  const p = password.safeParse(String(form.get("password") ?? ""));
  if (!p.success) return { error: p.error.issues[0].message };
  if (form.get("password") !== form.get("confirm")) return { error: "The two passwords don't match." };
  const [row] = await onlineQuery<{ id: number }>(
    `update online_participants set password_hash = $2, reset_token_hash = null, reset_expires_at = null, failed_logins = 0, locked_until = null
      where reset_token_hash = $1 and reset_expires_at > now() returning id`,
    [tokenHash(String(token)), await hashPassword(p.data)],
  );
  if (!row) return { error: "This reset link has expired or was already used. Ask for a new one." };
  await setOnlineSession(row.id);
  redirect("/online/submit");
}
