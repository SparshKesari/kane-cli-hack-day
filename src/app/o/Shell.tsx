import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { onlineEvent, onlineLinks } from "@/data/online";
import { getOnlineSession } from "@/lib/online/session";
import { logoutAction } from "./login/actions";

// The four sections people look for; the rest are a scroll away.
const NAV = [
  { href: "/#challenge", label: "Challenge" },
  { href: "/#prizes", label: "Prizes" },
  { href: "/#judging", label: "Judging" },
  { href: "/#rules", label: "Rules" },
];

// The online hackathon has its own header. The root layout's SF Hack Day
// navbar and footer are hidden here with CSS, so no shared component changes.
export default function OnlineShell({ children }: { children: ReactNode }) {
  return (
    <div data-online className="flex min-h-svh flex-col">
      {/* Online pages: hide the SF navbar/footer, and lift the secondary text
          colour from #7e7e7e to #a8a8a8 (5:1 → 8:1 contrast on black). Light folds
          set their own --lightgray, so they are unaffected. */}
      <style>{`body:has([data-online]) > #nav-bar, body:has([data-online]) > footer { display: none; } [data-online] { --lightgray: #a8a8a8; }`}</style>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-lime focus:px-4 focus:py-2 focus:font-plex focus:text-sm focus:text-ink">
        Skip to content
      </a>
      <header className="sticky top-0 z-50 border-b border-hairline bg-ink/85 backdrop-blur">
        <nav aria-label="Main" className="container-page flex h-16 items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
            <img src="/logos/kaneai-mascot.png" alt="" width={140} height={122} className="h-9 w-auto" />
            <span className="font-pixel text-xs uppercase tracking-[0.18em] whitespace-nowrap text-bright">{onlineEvent.name}</span>
          </Link>
          <ul className="hidden items-center gap-8 font-plex text-sm whitespace-nowrap text-lightgray lg:flex">
            {NAV.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-block py-2 transition-colors hover:text-bright">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 items-center gap-3 font-plex text-sm whitespace-nowrap">
            <a href={onlineLinks.slack} target="_blank" rel="noreferrer" className="hidden border border-lime px-4 py-2 text-lime transition-colors hover:bg-lime hover:text-ink sm:inline-block">
              Join Slack
            </a>
            <Suspense fallback={<LoginLink />}>
              <AccountLinks />
            </Suspense>
          </div>
        </nav>
        {/* Small screens: the section links as a row you can swipe. */}
        <ul aria-label="Sections" className="container-page flex gap-6 overflow-x-auto border-t border-hairline py-1 font-plex text-sm whitespace-nowrap text-lightgray lg:hidden">
          {NAV.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="inline-block py-2 hover:text-bright">
                {l.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={onlineLinks.slack} target="_blank" rel="noreferrer" className="inline-block py-2 text-lime">
              Join Slack
            </a>
          </li>
        </ul>
      </header>
      {/* flex-1: on short pages the footer still sits at the bottom of the window. */}
      <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      <footer className="border-t border-hairline">
        <div className="container-page py-8 font-plex text-sm text-lightgray">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p>{onlineEvent.name} · by TestMu AI</p>
            <p className="flex flex-wrap gap-x-5 gap-y-1">
              <a href={onlineLinks.slack} target="_blank" rel="noreferrer" className="hover:text-bright">Slack</a>
              <a href={onlineLinks.docs} target="_blank" rel="noreferrer" className="hover:text-bright">Kane CLI docs</a>
              <a href={onlineLinks.support} className="hover:text-bright">conferences@testmuai.com</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

async function AccountLinks() {
  if ((await getOnlineSession()) === null) return <LoginLink />;
  return (
    <>
      <Link href="/o/team" className="hidden text-lightgray hover:text-bright sm:inline">
        My team
      </Link>
      <Link href="/o/submit" className="text-bright hover:text-lime">
        My submission
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="text-lightgray hover:text-bright">
          Log out
        </button>
      </form>
    </>
  );
}

function LoginLink() {
  return (
    <>
      <Link href="/o/login" className="text-lightgray hover:text-bright">
        Log in
      </Link>
      <Link href="/o/register" className="bg-bright px-4 py-2 text-ink transition-colors hover:bg-lime">
        Register
      </Link>
    </>
  );
}
