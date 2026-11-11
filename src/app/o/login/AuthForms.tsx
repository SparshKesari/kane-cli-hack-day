"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import { FormError, Label, inputCls } from "@/components/forms/fields";
import { onlineLinks } from "@/data/online";
import { forgotAction, loginAction, registerAction, resetAction, type AuthState } from "./actions";

// Submitted this way (not the form's `action` prop) so an error never wipes what was typed.
const keep = (action: (fd: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => action(fd));
};

function Btn({ pending, label, children }: { pending: boolean; label: string; children: ReactNode }) {
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center bg-bright px-4 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:cursor-wait disabled:opacity-60">
      {pending ? label : children}
    </button>
  );
}

const errorOf = (s: AuthState) => (s && "error" in s ? s.error : null);
const linkCls = "text-bright underline decoration-hairline underline-offset-4 hover:text-lime";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form onSubmit={keep(action)} className="space-y-5">
      <div>
        <Label htmlFor="email">Email</Label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
      </div>
      <div>
        <Label htmlFor="password" hint={<Link href="/online/forgot" className={linkCls}>Forgot password?</Link>}>
          Password
        </Label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </div>
      <FormError message={errorOf(state)} />
      <Btn pending={pending} label="Logging in…">Log in</Btn>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, null);
  return (
    <form onSubmit={keep(action)} className="space-y-5">
      <div>
        <Label htmlFor="name">Name</Label>
        <input id="name" name="name" autoComplete="name" required maxLength={100} className={inputCls} />
      </div>
      <div>
        <Label htmlFor="email" hint="One you check: winners are contacted here">Email</Label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
      </div>
      <div>
        <Label htmlFor="password" hint="8+ characters">Password</Label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="x_url" hint="Optional">X (Twitter)</Label>
          <input id="x_url" name="x_url" inputMode="url" placeholder="https://x.com/you" className={inputCls} />
        </div>
        <div>
          <Label htmlFor="linkedin_url" hint="Optional">LinkedIn</Label>
          <input id="linkedin_url" name="linkedin_url" inputMode="url" placeholder="https://linkedin.com/in/you" className={inputCls} />
        </div>
      </div>
      <div>
        <Label htmlFor="other_links" hint="Optional">Other links</Label>
        <input id="other_links" name="other_links" maxLength={500} placeholder="GitHub, website, Reddit, Hacker News…" className={inputCls} />
      </div>
      <label className="flex cursor-pointer items-start gap-3 font-plex text-sm leading-relaxed text-lightgray">
        <input type="checkbox" name="terms" required className="mt-1 h-4 w-4 shrink-0 accent-[#daff52]" />
        <span>
          I accept the{" "}
          <a href={onlineLinks.terms} target="_blank" rel="noreferrer" className={linkCls}>
            contest rules and guidelines
          </a>
          , and I agree that TestMu AI may feature my project with attribution and email me about this hackathon.
        </span>
      </label>
      <FormError message={errorOf(state)} />
      <Btn pending={pending} label="Registering…">Next: your team →</Btn>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotAction, null);
  if (state && "done" in state) {
    return (
      <p role="status" className="border-l-2 border-lime pl-4 font-plex text-sm leading-relaxed text-bright">
        {state.done}
      </p>
    );
  }
  return (
    <form onSubmit={keep(action)} className="space-y-5">
      <div>
        <Label htmlFor="email">Email you registered with</Label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
      </div>
      <FormError message={errorOf(state)} />
      <Btn pending={pending} label="Sending…">Email me a reset link</Btn>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction.bind(null, token), null);
  return (
    <form onSubmit={keep(action)} className="space-y-5">
      <div>
        <Label htmlFor="password" hint="8+ characters">New password</Label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
      </div>
      <div>
        <Label htmlFor="confirm">Type it again</Label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
      </div>
      <FormError message={errorOf(state)} />
      <Btn pending={pending} label="Saving…">Save new password</Btn>
    </form>
  );
}
