import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { onlineEvent, submissionsClosed } from "@/data/online";
import { getOnlineSession } from "@/lib/online/session";
import { RegisterForm } from "../login/AuthForms";
import Steps from "../Steps";

export const metadata: Metadata = { title: "Register" };

// Step 1: yourself. Step 2 (/o/team) is your team.
export default function OnlineRegister() {
  return (
    <section className="container-page max-w-md py-16">
      <Suspense>
        <SignedInRedirect />
      </Suspense>
      <Suspense>
        <RegisterOrClosed />
      </Suspense>
      <p className="mt-8 font-plex text-sm text-lightgray">
        Already registered?{" "}
        <Link href="/o/login" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
          Log in →
        </Link>
      </p>
    </section>
  );
}

async function SignedInRedirect() {
  if ((await getOnlineSession()) !== null) redirect("/o/team");
  return null;
}

/** The form until the deadline. After it, a closed notice (the action refuses late posts too). */
async function RegisterOrClosed() {
  await connection();
  if (submissionsClosed()) {
    return (
      <>
        <h1 className="font-display text-4xl text-bright">Registration is closed</h1>
        <p className="mb-8 mt-3 font-plex text-sm text-lightgray">
          {onlineEvent.closedTitle}. {onlineEvent.closedNote}
        </p>
        <Link href="/showcase" className="inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime">
          See the projects →
        </Link>
      </>
    );
  }
  return (
    <>
      <Steps current={1} />
    <h1 className="font-display text-4xl text-bright">Register yourself</h1>
    <p className="mb-8 mt-3 font-plex text-sm text-lightgray">Start with you. Your team comes next.</p>
    <RegisterForm />
    </>
  );
}
