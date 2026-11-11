import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOnlineSession } from "@/lib/online/session";
import { RegisterForm } from "../login/AuthForms";
import Steps from "../Steps";

export const metadata: Metadata = { title: "Register" };

// Step 1: yourself. Step 2 (/online/team) is your team.
export default function OnlineRegister() {
  return (
    <section className="container-page max-w-md py-16">
      <Suspense>
        <SignedInRedirect />
      </Suspense>
      <Steps current={1} />
      <h1 className="font-display text-4xl text-bright">Register yourself</h1>
      <p className="mb-8 mt-3 font-plex text-sm text-lightgray">Start with you. Your team comes next.</p>
      <RegisterForm />
      <p className="mt-8 font-plex text-sm text-lightgray">
        Already registered?{" "}
        <Link href="/online/login" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
          Log in →
        </Link>
      </p>
    </section>
  );
}

async function SignedInRedirect() {
  if ((await getOnlineSession()) !== null) redirect("/online/team");
  return null;
}
