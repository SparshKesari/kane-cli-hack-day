import Link from "next/link";
import { beforeYouStart, whatToSubmit } from "@/data/online";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";
import CopyField from "@/components/ui/CopyField";

// Before you start (two steps) and what to submit (five things).
export default function Start() {
  return (
    <Fold id="start">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Before you start" dim="Two things," bright="Before any code." />
          <ol className="mt-10 border-t border-dashed border-hairline">
            {beforeYouStart.steps.map((s, i) => (
              <Reveal key={s.title} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 border-b border-dashed border-hairline py-6">
                <span className="font-dots text-3xl leading-none font-black text-lime">{i + 1}</span>
                <div>
                  <h3 className="font-display text-xl text-bright">{s.title}</h3>
                  {"command" in s && s.command && <CopyField value={s.command} className="mt-4" />}
                  {s.body && <p className="mt-2 font-plex text-sm text-lightgray">{s.body}</p>}
                  <a href={s.link.href} target="_blank" rel="noreferrer" className="mt-3 inline-block font-plex text-sm text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                    {s.link.label} →
                  </a>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>

        <div id="submit" className="scroll-mt-24">
          <SectionHeading eyebrow="What to submit" dim="Five things," bright="One form." intro={whatToSubmit.intro} />
          <ol className="mt-10 border-t border-dashed border-hairline">
            {whatToSubmit.items.map((it, i) => (
              <Reveal key={it.title} className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-4 border-b border-dashed border-hairline py-4">
                <span className="font-plex text-sm text-lightgray">{String(i + 1).padStart(2, "0")}</span>
                <p>
                  <span className="font-display text-lg text-bright">
                    {it.title}
                    {"bonus" in it && it.bonus && <span className="ml-2 border border-lime px-1.5 py-0.5 align-middle font-pixel text-xs uppercase tracking-[0.15em] text-lime">Required + bonus</span>}
                  </span>
                  <span className="block font-plex text-sm text-lightgray">{it.body}</span>
                </p>
              </Reveal>
            ))}
          </ol>
          <Link href="/o/submit" className="mt-8 inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime">
            Submit your project →
          </Link>
        </div>
      </div>
    </Fold>
  );
}
