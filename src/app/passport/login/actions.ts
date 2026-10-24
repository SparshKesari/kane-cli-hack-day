"use server";

import { redirect } from "next/navigation";
import { personalNext } from "@/lib/next-path";
import { redeemActivationCode } from "@/server/activation";
import { formObject, parse, sha256, toAppError, z } from "@/server/core";
import { clientKey, rateLimit } from "@/server/ratelimit";
import { memberLoginWithCode, memberLoginWithPassword } from "@/server/pairing";

export type PersonalLoginState = { error?: string; email?: string } | null;

const schema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().max(200).optional(),
  code: z.string().trim().max(20).optional(),
  next: z.string().max(200).optional(),
});

// Personal sign-in: email + the password chosen on /register, or email + a
// one-time code from the help desk (a sign-in code, or an activation code).
// Both prove the person.
export async function personalLogin(_prev: PersonalLoginState, form: FormData): Promise<PersonalLoginState> {
  const input = parse(schema, formObject(form));
  // Throttle per email, so passwords and one-time codes can't be guessed here, and per client
  // only against floods: everyone at the venue shares one public IP.
  const [byClient, byEmail] = await Promise.all([
    rateLimit(`member-login:${await clientKey()}`, { limit: 200, windowSec: 300 }),
    rateLimit(`member-login-email:${sha256(input.email)}`, { limit: 10, windowSec: 900 }),
  ]);
  if (!byClient.ok || !byEmail.ok) return { error: "Too many tries. Wait a few minutes and try again.", email: input.email };
  try {
    if (input.code) {
      try {
        await memberLoginWithCode(input.email, input.code);
      } catch (e) {
        // Not a sign-in code: maybe the desk's activation code (it checks the email against the roster).
        const r = await redeemActivationCode(input.code, input.email).catch(() => null);
        if (!r || r.kind !== "ok") throw e;
      }
    } else if (input.password) await memberLoginWithPassword(input.email, input.password);
    else return { error: "Enter your password or a one-time code.", email: input.email };
  } catch (e) {
    return { error: toAppError(e).userMessage, email: input.email };
  }
  redirect(personalNext(input.next ?? "/me"));
}
