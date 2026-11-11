import type { Metadata } from "next";
import Link from "next/link";
import CopyField from "@/components/ui/CopyField";
import { launchGuide as g, socialAccounts } from "@/data/online";
import Icon, { iconFor, type IconName } from "../Icons";

export const metadata: Metadata = { title: "Launch guide" };

// How to post about your project: the rules, the hashtags and tags per
// platform, and sample posts. Linked from the setup page and from the Launch
// buzz section of the submission form. Public, no login needed.

/** The platform a sample post is for, from its label ("X · launch thread"). */
const sampleIcon = (label: string): IconName =>
  /^x\b/i.test(label) ? "x" : /^linkedin/i.test(label) ? "linkedin" : /^hacker/i.test(label) ? "hackernews" : /^reddit/i.test(label) ? "reddit" : "link";
const anchor = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const FACTS = [
  { big: "2", label: "public posts required to submit" },
  { big: "3+", label: "posts recommended: kickoff, mid-week, launch" },
  { big: "+", label: "brownie points for every extra post and its reach" },
];

export default function LaunchGuide() {
  return (
    <>
      <header className="relative isolate overflow-hidden border-b border-dashed border-hairline">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(#3a3a3a_1px,transparent_1.5px)] [background-size:10px_10px] [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_65%)]"
        />
        <div className="container-page max-w-4xl py-14 sm:py-20">
          <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">Launch guide</p>
          <h1 className="mt-4 font-dots text-5xl leading-[0.95] font-black text-bright sm:text-7xl">Earn brownie points</h1>
          <p className="mt-5 max-w-2xl font-plex text-base leading-relaxed text-lightgray">{g.intro}</p>
          {/* The platforms, as jump links to their cards. */}
          <ul className="mt-8 flex flex-wrap gap-2">
            {g.platforms.map((pf) => (
              <li key={pf.label}>
                <a href={`#${anchor(pf.label)}`} className="inline-flex min-h-11 items-center gap-2 border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                  <Icon name={iconFor(pf.href)} />
                  {pf.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="container-page max-w-4xl pb-16">
        <dl className="mt-10 grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
          {FACTS.map((f, i) => (
            <div key={f.label} className={`p-6 ${i === 0 ? "bg-lime text-ink" : "bg-ink"}`}>
              <dt className={`font-dots text-6xl leading-none font-black ${i === 0 ? "" : "text-lime"}`}>{f.big}</dt>
              <dd className={`mt-3 font-plex text-sm leading-relaxed ${i === 0 ? "" : "text-bright"}`}>{f.label}</dd>
            </div>
          ))}
        </dl>

        <H2 n="01">How it works</H2>
        <ol className="grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-3">
          {g.tips.map((t, i) => (
            <li key={t.title} className="bg-ink p-6">
              <p className="font-dots text-3xl leading-none font-black text-lime">{i + 1}</p>
              <h3 className="mt-3 font-display text-lg text-bright">{t.title}</h3>
              <p className="mt-2 font-plex text-sm leading-relaxed text-lightgray">{t.body}</p>
            </li>
          ))}
        </ol>

        <H2 n="02">Hashtags and who to tag</H2>
        <div className="grid gap-4 sm:grid-cols-2">
          {g.platforms.map((pf) => (
            <section key={pf.label} id={anchor(pf.label)} className="brackets scroll-mt-24 p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-3 font-display text-xl text-bright">
                  <span className="grid h-11 w-11 place-items-center bg-bright text-ink">
                    <Icon name={iconFor(pf.href)} className="h-5 w-5" />
                  </span>
                  {pf.label}
                </h3>
                <a href={pf.href} target="_blank" rel="noreferrer" className="shrink-0 border border-hairline px-3 py-2 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                  Post ↗
                </a>
              </div>
              <dl className="mt-5 space-y-4 font-plex text-sm leading-relaxed">
                <div>
                  <dt className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">Hashtags</dt>
                  <dd className="mt-2">
                    {pf.hashtags.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {pf.hashtags.map((h) => (
                          <span key={h} className="bg-lime px-2 py-0.5 text-ink">
                            {h}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-lightgray">None. This platform doesn&rsquo;t use them.</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">Tag</dt>
                  <dd className="mt-2 text-bright">
                    {"tagHref" in pf && pf.tagHref ? (
                      <a href={pf.tagHref} target="_blank" rel="noreferrer" className="bg-lime px-2 py-0.5 text-ink hover:bg-bright">
                        {pf.tag} ↗
                      </a>
                    ) : (
                      pf.tag
                    )}
                    {"tagNote" in pf && pf.tagNote && <span className="ml-2 text-lightgray">{pf.tagNote}</span>}
                  </dd>
                </div>
                <dd className="border-t border-dashed border-hairline pt-4 text-lightgray">{pf.note}</dd>
              </dl>
            </section>
          ))}
        </div>

        <H2 n="03">Sample posts</H2>
        <p className="mb-6 font-plex text-sm text-lightgray">Copy one, fill in the [brackets], and make it yours.</p>
        <div className="space-y-4">
          {g.samples.map((s) => (
            <section key={s.label} className="border border-hairline bg-surface/40 p-5 sm:p-6">
              <h3 className="flex items-center gap-3 font-display text-xl text-bright">
                <span className="grid h-10 w-10 shrink-0 place-items-center border border-hairline">
                  <Icon name={sampleIcon(s.label)} className="h-5 w-5" />
                </span>
                {s.label}
              </h3>
              <p className="mt-3 mb-4 font-plex text-sm leading-relaxed text-lightgray">{s.note}</p>
              <CopyField value={s.text} className="[&_pre]:text-sm [&_pre]:whitespace-pre-wrap" />
            </section>
          ))}
        </div>

        <H2 n="04">No account yet?</H2>
        <p className="mb-6 font-plex text-sm leading-relaxed text-lightgray">Register now. New accounts get filtered, and a week of real activity fixes that before launch day.</p>
        <ul className="grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-5">
          {socialAccounts.items.map((a) => (
            <li key={a.name} className="bg-ink">
              <a href={a.href} target="_blank" rel="noreferrer" className="group flex h-full flex-col items-start gap-3 p-5 hover:bg-surface">
                <Icon name={a.icon} className="h-6 w-6 text-bright group-hover:text-lime" />
                <span className="font-display text-base text-bright">{a.name}</span>
                <span className="font-plex text-xs text-lightgray group-hover:text-lime">Register ↗</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-wrap gap-3 border-t border-dashed border-hairline pt-8">
          <Link href="/o/submit" className="inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime">
            Paste your post links →
          </Link>
          <Link href="/o/start" className="inline-flex min-h-11 items-center border border-hairline px-5 font-plex text-sm text-bright transition-colors hover:border-lime">
            Back to setup
          </Link>
        </div>
      </div>
    </>
  );
}

// A numbered part of the page: the number in lime dots, then the heading.
function H2({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="mt-16 mb-6 flex items-center gap-4 border-t border-hairline pt-8 font-display text-3xl text-bright">
      <span aria-hidden className="font-dots text-4xl leading-none font-black text-lime">
        {n}
      </span>
      <span>
        <span className="sr-only">Part {Number(n)}: </span>
        {children}
      </span>
    </h2>
  );
}
