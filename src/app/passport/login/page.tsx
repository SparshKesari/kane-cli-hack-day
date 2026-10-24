import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/ui/PageHeader";
import PersonalLoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Personal sign-in: email + your own password, or a one-time code from the desk.
// There is no team password in the event-day flow.

export default function PersonalLoginPage({ searchParams }: PageProps<"/passport/login">) {
  return (
    <main>
      <PageHeader eyebrow="Sign in" dim="Welcome back," bright="Just you." intro="Use the email and password from your profile. Forgot it, or never set one? The help desk can give you a one-time code." />
      <section className="py-16 sm:py-20">
        <div className="container-page max-w-md space-y-8">
          <Suspense fallback={<PersonalLoginForm next="/me" />}>
            <WithNext searchParams={searchParams} />
          </Suspense>
          <p className="font-plex text-sm text-lightgray">
            New here?{" "}
            <Link href="/register" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
              Start here
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

async function WithNext({ searchParams }: Pick<PageProps<"/passport/login">, "searchParams">) {
  const sp = await searchParams;
  const next = sp.next;
  const code = typeof sp.code === "string" ? sp.code.slice(0, 20) : "";
  return <PersonalLoginForm next={typeof next === "string" ? next : "/me"} initialMode={sp.mode === "code" || code ? "code" : "password"} initialCode={code} />;
}
