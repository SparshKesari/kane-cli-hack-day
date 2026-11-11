import { onlineJudging as j } from "@/data/online";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";

// Three bars to clear (in lime), then four dimensions weighted equally.
export default function Judging() {
  return (
    <Fold id="judging">
      <SectionHeading eyebrow="How we'll judge it" dim="Three bars," bright="Four dimensions." intro={j.intro} />

      <Reveal className="mt-14 bg-lime p-6 text-[#0a0a0a] sm:p-8">
        <p className="font-pixel text-xs uppercase tracking-[0.18em]">Ready to ship means</p>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {j.bars.map((b, i) => (
            <li key={b} className="flex items-baseline gap-3 font-display text-lg">
              <span className="font-dots text-2xl leading-none font-black">{i + 1}</span>
              {b}
            </li>
          ))}
        </ol>
        <p className="mt-6 font-plex text-sm">{j.barsNote}</p>
      </Reveal>

      <div className="mt-4 grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {j.criteria.map((c, i) => (
          <Reveal key={c.n} delay={i * 60} className="bg-ink p-6">
            <p className="font-pixel text-xs uppercase tracking-[0.18em] text-lightgray">{c.n} · 25%</p>
            <h3 className="mt-4 font-dots text-3xl leading-none font-black text-bright">{c.title}</h3>
            <p className="mt-3 font-plex text-sm leading-relaxed text-lightgray">{c.body}</p>
          </Reveal>
        ))}
      </div>
      <p className="mt-6 font-plex text-sm text-lightgray">{j.scoring}</p>
      <p className="mt-3 border-l-2 border-lime pl-4 font-plex text-sm text-bright">{j.bonus}</p>
    </Fold>
  );
}
