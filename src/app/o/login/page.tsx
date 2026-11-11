import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOnlineSession } from "@/lib/online/session";
import { LoginForm } from "./AuthForms";

export const metadata: Metadata = { title: "Log in" };

export default function OnlineLogin() {
  return (
    <section className="container-page max-w-md py-20">
      <Suspense>
        <SignedInRedirect />
      </Suspense>
      <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">Online hackathon</p>
      <h1 className="mb-8 mt-2 font-display text-4xl text-bright">Welcome back</h1>
      <LoginForm />
      <p className="mt-8 font-plex text-sm text-lightgray">
        New here?{" "}
        <Link href="/o/register" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
          Register yourself and your team →
        </Link>
      </p>
    </section>
  );
}

async function SignedInRedirect() {
  if ((await getOnlineSession()) !== null) redirect("/o/submit");
  return null;
}
