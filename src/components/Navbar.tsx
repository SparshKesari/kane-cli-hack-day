"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { event } from "@/data/hackday";

// Public sections of the home page; everything else lives in the team hub.
const links = [
  { href: "/start", label: "Start" },
  { href: "/#schedule", label: "Schedule" },
  { href: "/#challenge", label: "Challenge" },
  { href: "/#prizes", label: "Prizes" },
  { href: "/#judges", label: "Judges" },
  { href: "/#rules", label: "Rules" },
];

/** `account` is the server-rendered Log in / Register or My team control. */
export default function Navbar({ account }: { account: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header id="nav-bar" className="sticky top-0 z-50 border-b border-hairline bg-ink/85 backdrop-blur">
      <nav className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
          <img src="/logos/kaneai-mascot.png" alt="" width={140} height={122} className="h-9 w-auto" />
          <span className="font-pixel text-xs uppercase tracking-[0.18em] text-bright">{event.name}</span>
        </Link>

        <ul className="hidden items-center gap-6 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              {/* The pathname is runtime data on dynamic routes (/t/[slug]), so only the highlight waits for it. */}
              <Suspense fallback={<DesktopLink {...l} active={false} />}>
                <ActiveDesktopLink {...l} />
              </Suspense>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-4 lg:flex">{account}</div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="p-2 text-bright lg:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div className="border-t border-dashed border-hairline lg:hidden">
          <ul className="container-page flex flex-col py-3">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block border-b border-dashed border-hairline py-3 font-plex text-sm text-bright"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="container-page pb-4" onClick={() => setOpen(false)}>
            {account}
          </div>
        </div>
      )}
    </header>
  );
}

function ActiveDesktopLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  return <DesktopLink href={href} label={label} active={!href.startsWith("/#") && pathname.startsWith(href)} />;
}

function DesktopLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`font-plex text-sm transition-colors hover:text-lime ${active ? "text-lime" : "text-bright"}`}>
      {label}
    </Link>
  );
}
