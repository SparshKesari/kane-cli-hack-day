import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { onlineEvent } from "@/data/online";
import { isEnabled } from "@/lib/flags";
import { listShowcase, type ShowcaseCard } from "@/lib/online/showcase";
import { listSfShowcase, type Cover, type SfCard } from "@/lib/sf-showcase";
import { PROJECT_TYPE_LABEL } from "@/server/showcase";
import OnlineShell from "../o/Shell";

// /showcase: every project in one place. The online hackathon's submitted
// projects first, once there are any (each links to its /o/p/{slug} page), then the SF Hack Day's
// public ship pages (each links to /ship/{slug}). Read-only: it lists what those
// pages already show and changes nothing about them. The two events live in
// separate databases, so each list loads, and fails, on its own.

const TITLE = "Showcase";
const DESCRIPTION = "Every project built for the KaneCLI hackathons: what each team shipped, built with an AI agent and verified with Kane CLI.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.kaneclihack.sh"),
  title: { absolute: `${TITLE} · ${onlineEvent.name}` },
  description: DESCRIPTION,
  openGraph: { title: `${TITLE} · ${onlineEvent.name}`, description: DESCRIPTION, url: "/showcase", siteName: onlineEvent.name, type: "website" },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${onlineEvent.name}`, description: DESCRIPTION, images: ["/showcase/opengraph-image"] },
};

export default function ShowcasePage() {
  return (
    <OnlineShell>
      <header className="relative isolate overflow-hidden border-b border-dashed border-hairline">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(#3a3a3a_1px,transparent_1.5px)] [background-size:10px_10px] [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_65%)]"
        />
        <div className="container-page py-14 sm:py-20">
          <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">Showcase</p>
          <h1 className="mt-5 font-dots text-5xl leading-[0.95] font-black tracking-[-0.01em] text-bright sm:text-7xl">
            Every project<span className="text-lime">.</span>
          </h1>
          <p className="mt-5 max-w-2xl font-display text-xl leading-snug text-lightgray sm:text-2xl">Built with an AI agent, verified with Kane CLI. Open any card for the demo, the code and the story.</p>
        </div>
      </header>

      <Suspense fallback={<p className="container-page py-14 font-plex text-sm text-lightgray">Loading projects…</p>}>
        <OnlineProjects />
        <HackDayProjects />
      </Suspense>
    </OnlineShell>
  );
}

/** The online hackathon's submitted projects. The section appears with the first submission. */
async function OnlineProjects() {
  await connection(); // live data: a project appears the moment it's submitted
  let cards: ShowcaseCard[] = [];
  try {
    // No online database on this machine (local dev without ONLINE_DATABASE_URL): nothing to list, not an error.
    if (process.env.ONLINE_DATABASE_URL) cards = await listShowcase();
  } catch (e) {
    console.error("showcase: online projects failed to load", e);
  }
  if (cards.length === 0) return null;

  return (
    <section aria-labelledby="online-heading" className="border-b border-dashed border-hairline">
      <div className="container-page py-14">
        <SectionHead id="online-heading" title={onlineEvent.name} count={cards.length} note={onlineEvent.facts[0]} />
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={c.slug}>
              <Card
                href={`/o/p/${c.slug}`}
                cover={c.cover ? { kind: "image", src: c.cover, alt: "" } : null}
                name={c.name}
                pitch={c.pitch}
                eyebrow={c.agent ?? "AI agent"}
                by={c.solo ? c.teamName : `${c.teamName} · ${c.members}`}
                tags={[c.hasLive && "Live", c.hasRepo && "Code"].filter((t): t is string => Boolean(t))}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The SF Hack Day's public ship pages. Shown only when there are some, and only while the ship pages are on. */
async function HackDayProjects() {
  await connection();
  let cards: SfCard[] = [];
  try {
    if (await isEnabled("ship_pages")) cards = await listSfShowcase();
  } catch (e) {
    console.error("showcase: hack day projects failed to load", e);
  }
  if (cards.length === 0) return null;

  const winners = cards.filter((c) => c.rank !== null);
  const rest = cards.filter((c) => c.rank === null);
  const tile = (c: SfCard) => (
    <li key={c.slug}>
      <Card
        href={c.href}
        external={c.external}
        cover={c.cover}
        name={c.name}
        pitch={c.pitch}
        eyebrow={PROJECT_TYPE_LABEL[c.type]}
        by={c.teamName}
        place={c.rank}
        tags={[c.verifiedRuns > 0 && `✓ Verified · ${c.verifiedRuns}`, c.external && (/github\.com/i.test(c.href) ? "Code ↗" : "Demo ↗")].filter((t): t is string => Boolean(t))}
      />
    </li>
  );

  return (
    <section aria-labelledby="sf-heading">
      <div className="container-page py-14">
        <SectionHead id="sf-heading" title="Kane CLI Hack Day SF" count={cards.length} note="In person, San Francisco" />
        {winners.length > 0 && (
          <>
            <h3 className="mt-10 font-pixel text-xs uppercase tracking-[0.15em] text-lime">Winners</h3>
            <ul className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">{winners.map(tile)}</ul>
            <h3 className="mt-14 font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">All projects</h3>
          </>
        )}
        <ul className={`${winners.length > 0 ? "mt-4" : "mt-8"} grid gap-6 sm:grid-cols-2 lg:grid-cols-3`}>{rest.map(tile)}</ul>
      </div>
    </section>
  );
}

const PLACE = ["", "1st place", "2nd place", "3rd place"];

function SectionHead({ id, title, count, note }: { id: string; title: string; count: number; note: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <h2 id={id} className="font-display text-3xl tracking-[-0.03em] text-bright sm:text-4xl">
        {title}
      </h2>
      <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">
        <span className="text-lime">{count}</span> {count === 1 ? "project" : "projects"} · {note}
      </p>
    </div>
  );
}

function Card({ href, external, cover, name, pitch, eyebrow, by, tags, place }: { href: string; external?: boolean; cover: Cover | null; name: string; pitch: string | null; eyebrow: string; by: string; tags: string[]; place?: number | null }) {
  const cls = `brackets group flex h-full flex-col border bg-surface transition-colors hover:border-lime ${place ? "border-lime/60" : "border-hairline"}`;
  const body = (
    <>
      <div className="relative aspect-video overflow-hidden border-b border-hairline bg-ink">
        {cover?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a video still, a team's own image, or an access-checked ship-page screenshot
          <img src={cover.src} alt={cover.alt} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : cover?.kind === "video" ? (
          // An uploaded demo with no still: the video itself, paused a second in. Only its first bytes load.
          <video src={`${cover.src}#t=1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden className="pointer-events-none h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <span aria-hidden className="grid h-full place-items-center font-dots text-6xl font-black text-hairline">
            {name.trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        {place ? <span className="absolute top-0 left-0 bg-lime px-3 py-1.5 font-pixel text-[11px] uppercase tracking-[0.15em] text-ink">{PLACE[place] ?? `#${place}`}</span> : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="truncate font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{eyebrow}</p>
        <h4 className="mt-2 font-display text-2xl leading-tight tracking-[-0.03em] break-words text-bright group-hover:text-lime">{name}</h4>
        {pitch && <p className="mt-2 line-clamp-3 font-plex text-sm text-lightgray">{pitch}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
          <span className="min-w-0 truncate font-plex text-xs text-lightgray">{by}</span>
          {tags.length > 0 && (
            <span className="flex gap-1.5">
              {tags.map((t) => (
                <span key={t} className="border border-hairline px-2 py-0.5 font-pixel text-[10px] uppercase tracking-[0.15em] text-bright">
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </>
  );
  // A project whose /ship page is off opens its demo or repo instead, in a new tab.
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}
