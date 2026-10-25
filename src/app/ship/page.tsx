import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { FINAL_STATS, type FinalStats } from "@/components/live/final-stats";
import StatusPill from "@/components/ui/StatusPill";
import { isEnabled } from "@/lib/flags";
import { getFinalStats } from "@/server/final-stats";
import { PROJECT_TYPES, PROJECT_TYPE_LABEL, listGallery, type ProjectType } from "@/server/showcase";

export const metadata: Metadata = {
  title: "Showcase",
  description: "Everything shipped at Kane CLI Hack Day: what each team built, and the Kane evidence behind it.",
};

// /ship: every public showcase (never unlisted, draft or hidden), newest
// first, filterable by project type. Filters are plain links, so they work
// without JavaScript and can be shared.

export default function Gallery({ searchParams }: PageProps<"/ship">) {
  return (
    <main>
      <PageHeader
        eyebrow="Showcase"
        dim="Built fast,"
        bright="Shipped with proof."
        intro="Every project here was submitted at the hack day. Teal VERIFIED marks a passing Kane run from a verified channel; everything else is as the team reported it."
      />
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading projects…</p>}>
            <Projects searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

const isType = (s: unknown): s is ProjectType => typeof s === "string" && (PROJECT_TYPES as readonly string[]).includes(s);

async function Projects({ searchParams }: { searchParams: PageProps<"/ship">["searchParams"] }) {
  const raw = (await searchParams).type;
  const type = isType(raw) ? raw : null;
  // Organizer kill switch (T-005): the whole public showcase goes offline.
  if (!(await isEnabled("ship_pages"))) return <ShowcaseOffline />;
  const [cards, all, final] = await Promise.all([listGallery(type), type ? listGallery(null) : null, getFinalStats()]);
  const counts = new Map<string, number>();
  for (const c of all ?? cards) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  const total = (all ?? cards).length;

  return (
    <div className="space-y-10">
      {final && <KaneTotals final={final} />}
      <nav aria-label="Filter by project type" className="flex flex-wrap gap-2">
        <Chip href="/ship" on={!type}>
          All · {total}
        </Chip>
        {PROJECT_TYPES.filter((t) => counts.has(t)).map((t) => (
          <Chip key={t} href={`/ship?type=${t}`} on={type === t}>
            {PROJECT_TYPE_LABEL[t]} · {counts.get(t)}
          </Chip>
        ))}
      </nav>

      {cards.length === 0 ? (
        <div className="border border-dashed border-hairline p-10 text-center">
          <p className="font-plex text-sm text-lightgray">{type ? "No public projects of this type yet." : "No public projects yet. Pages appear here as teams finalize their submissions."}</p>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={c.slug}>
              <Link href={`/ship/${c.slug}`} className="brackets group block h-full border border-hairline bg-surface transition-colors hover:border-lime">
                <div className="relative aspect-video overflow-hidden border-b border-hairline bg-ink">
                  {c.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private blob served through an access-checked route
                    <img src={c.cover} alt={c.coverAlt} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden className="grid h-full place-items-center font-dots text-6xl font-black text-hairline">
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{PROJECT_TYPE_LABEL[c.type]}</p>
                  <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.03em] text-bright group-hover:text-lime">
                    {c.name}
                    <span aria-hidden className="ml-0.5 inline-block h-[0.2em] w-[0.2em] bg-lime" />
                  </h2>
                  {c.pitch && <p className="mt-2 line-clamp-2 font-plex text-sm text-lightgray">{c.pitch}</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-plex text-xs text-lightgray">{c.teamName}</span>
                    {c.verifiedRuns > 0 ? (
                      <StatusPill tone="verified">Verified · {c.verifiedRuns}</StatusPill>
                    ) : (
                      <StatusPill tone="unverified">Team reported</StatusPill>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The event's final Kane CLI numbers (participants' orgs only), once an organizer saves them. */
function KaneTotals({ final }: { final: FinalStats }) {
  return (
    <section aria-label="Kane CLI across the event">
      <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">
        Kane CLI across the event · {final.teams.length} {final.teams.length === 1 ? "team" : "teams"}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-6">
        {FINAL_STATS.map((s) => (
          <div key={s.key} className="bg-ink p-4">
            <dt className="min-h-8 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{s.label}</dt>
            <dd className="mt-2 font-display text-3xl tracking-[-0.03em] text-bright tabular-nums">{final.totals[s.key].toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`inline-flex min-h-11 items-center border px-3 font-plex text-xs transition-colors ${on ? "border-lime bg-lime-deep text-lime" : "border-hairline text-bright hover:border-lime hover:text-lime"}`}
    >
      {children}
    </Link>
  );
}

function ShowcaseOffline() {
  return (
    <div className="flex flex-wrap items-center gap-3 border border-warning bg-warning-deep px-4 py-3 font-plex text-sm text-bright" role="status">
      <StatusPill tone="pending">Offline</StatusPill>
      <span>The showcase is temporarily offline. Submissions are safe and unaffected.</span>
    </div>
  );
}
