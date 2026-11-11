import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { onlineLinks } from "@/data/online";
import { emailsOn } from "@/lib/online/email";
import { ForgotForm } from "../login/AuthForms";

export const metadata: Metadata = { title: "Reset your password" };

export default function OnlineForgot() {
  return (
    <section className="container-page max-w-md py-20">
      <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">Online hackathon</p>
      <h1 className="mt-2 font-display text-4xl text-bright">Forgot your password?</h1>
      <Suspense>
        <Body />
      </Suspense>
      <p className="mt-8 font-plex text-sm text-lightgray">
        <Link href="/online/login" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
          ← Back to log in
        </Link>
      </p>
    </section>
  );
}

// With email switched off, an organiser makes the reset link by hand (in /admin).
async function Body() {
  const { connection } = await import("next/server");
  await connection();
  if (!emailsOn()) {
    return (
      <p className="mb-8 mt-3 border-l-2 border-lime pl-4 font-plex text-sm leading-relaxed text-bright">
        Message the organisers on{" "}
        <a href={onlineLinks.slack} target="_blank" rel="noreferrer" className="underline decoration-hairline underline-offset-4 hover:text-lime">
          Slack
        </a>{" "}
        or write to{" "}
        <a href={onlineLinks.support} className="underline decoration-hairline underline-offset-4 hover:text-lime">
          conferences@testmuai.com
        </a>{" "}
        from the email you registered with. They&rsquo;ll send you a link to choose a new password.
      </p>
    );
  }
  return (
    <>
      <p className="mb-8 mt-3 font-plex text-sm leading-relaxed text-lightgray">Enter your email and we&rsquo;ll send a link to choose a new one.</p>
      <ForgotForm />
    </>
  );
}
