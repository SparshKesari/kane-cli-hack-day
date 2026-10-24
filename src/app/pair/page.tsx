import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import DegradedServiceAlert from "@/components/ui/DegradedServiceAlert";
import PageHeader from "@/components/ui/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { formatEventTime, getEvent } from "@/lib/event";
import { getMember, getPersonalMember } from "@/server/auth";
import { describePairing, shortName } from "@/server/pairing";
import { decide, lookup } from "./actions";

export const metadata: Metadata = { title: "Pair a device", robots: { index: false } };

// Same look as fields.tsx inputCls (that module is client-only, so not imported here).
const inputCls =
  "w-full border border-hairline bg-surface px-3 py-2.5 font-plex text-sm text-bright placeholder:text-lightgray/60 outline-none transition-colors focus:border-lime";

// /pair?code=XXXX-XXXX : approve a `kanehack pair` (or MCP client) pairing.
// The code alone grants nothing; it binds to whoever approves it here, so
// we show which machine asked and make the person press Approve.

export default function PairPage({ searchParams }: PageProps<"/pair">) {
  return (
    <main>
      <PageHeader eyebrow="Pair" dim="Connect your agent," bright="Pair a device." intro="Your terminal showed a code. Approve it here and kanehack and Codex get their own revocable token." />
      <section className="py-12 sm:py-16">
        <div className="container-page max-w-xl">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Checking…</p>}>
            <Body searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/pair">, "searchParams">) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : "";
  const result = typeof sp.result === "string" ? sp.result : "";
  const member = await getPersonalMember();
  if (!member) {
    const next = `/pair${code ? `?code=${encodeURIComponent(code)}` : ""}`;
    // Signed in with the shared team password: that opens the team hub but can't
    // prove who you are, and a paired device acts as you. Say so instead of looping.
    if (await getMember()) {
      return (
        <div className="max-w-xl space-y-4 font-plex text-sm">
          <p className="text-bright">You&apos;re signed in with your team password. Pairing gives this device a token that acts as you, so it needs a personal sign-in.</p>
          <p className="text-lightgray">
            Use a one-time code from the help desk or an organizer, or your personal password if you&apos;ve set one. Already signed in on another device personally? Make a code there under
            Passport → Sign-in and devices.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/passport/login?mode=code&next=${encodeURIComponent(next)}`}
              className="inline-flex min-h-11 items-center bg-bright px-5 text-ink transition-colors hover:bg-lime"
            >
              Use a one-time code →
            </Link>
            <Link
              href={`/passport/login?next=${encodeURIComponent(next)}`}
              className="inline-flex min-h-11 items-center border border-hairline px-5 text-bright transition-colors hover:border-lime hover:text-lime"
            >
              Personal password
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4 font-plex text-sm">
        <p className="text-bright">Sign in first, so the token is yours.</p>
        <Link href={`/passport/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center bg-bright px-5 text-ink transition-colors hover:bg-lime">
          Sign in →
        </Link>
      </div>
    );
  }

  if (result === "approved") {
    return (
      <div className="space-y-4 font-plex text-sm">
        <p className="flex flex-wrap items-center gap-3 text-bright">
          <StatusPill tone="neutral">Approved</StatusPill> Go back to your terminal; it will finish by itself. (Agent with no terminal: run{" "}
          <code>kanehack pair --wait</code>.)
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/setup#connect" className="inline-flex min-h-11 items-center bg-bright px-5 text-ink transition-colors hover:bg-lime">
            Next: connect your agent →
          </Link>
          <Link href="/passport#devices" className="inline-flex min-h-11 items-center text-bright underline underline-offset-4 hover:text-lime">
            See paired devices →
          </Link>
        </div>
      </div>
    );
  }
  if (result === "denied") return <p className="font-plex text-sm text-bright">Denied. That code can’t be used now.</p>;

  const view = code ? await describePairing(code) : null;
  if (!code || result === "invalid") return <CodeEntry />;
  if (!view || view.expired || view.status !== "pending" || result === "expired") {
    return (
      <div className="space-y-6">
        <DegradedServiceAlert state="stale" system="Pairing code">
          That code has expired or was already used. Run <code>kanehack pair</code> again for a fresh one.
        </DegradedServiceAlert>
        <CodeEntry />
      </div>
    );
  }
  const ev = await getEvent();
  return (
    <div className="brackets space-y-6 border border-hairline bg-surface p-5 sm:p-8">
      <dl className="grid gap-4 font-plex text-sm sm:grid-cols-2">
        <div>
          <dt className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Code</dt>
          <dd className="mt-1 font-dots text-3xl text-bright">{code.toUpperCase()}</dd>
        </div>
        <div>
          <dt className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Device</dt>
          <dd className="mt-1 text-bright">{view.label ?? "kanehack CLI"}</dd>
        </div>
        <div>
          <dt className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Signed in as</dt>
          <dd className="mt-1 text-bright">
            {shortName(member.display_name ?? member.name)} · {member.public_code}
          </dd>
        </div>
        <div>
          <dt className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Expires</dt>
          <dd className="mt-1 text-bright">{formatEventTime(view.expires_at, ev)}</dd>
        </div>
      </dl>
      <p className="font-plex text-sm text-lightgray">Only approve a code you just saw in your own terminal. The token can read and update your passport, record Kane runs and open help tickets for you.</p>
      <form action={decide} className="flex flex-wrap gap-3">
        <input type="hidden" name="code" value={code} />
        <button name="decision" value="approve" className="min-h-11 bg-lime px-5 font-plex text-sm text-ink transition-colors hover:bg-bright">
          Approve this device →
        </button>
        <button name="decision" value="deny" className="min-h-11 border border-hairline px-5 font-plex text-sm text-bright transition-colors hover:border-danger hover:text-danger">
          Deny
        </button>
      </form>
    </div>
  );
}

function CodeEntry() {
  return (
    <form action={lookup} className="space-y-4">
      <label htmlFor="pair-code" className="block font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">
        Code from your terminal
      </label>
      <input id="pair-code" name="code" required placeholder="XXXX-XXXX" autoComplete="one-time-code" className={`${inputCls} uppercase tracking-[0.2em]`} />
      <button className="min-h-11 bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime">Look up →</button>
    </form>
  );
}
