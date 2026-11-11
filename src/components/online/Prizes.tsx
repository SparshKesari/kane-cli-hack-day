import { onlinePrizes as p } from "@/data/online";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";
import Statue from "@/components/art/Statue";
import Caption from "@/components/art/Caption";

// Light fold: the cash podium, then one row of what else you get.
export default function Prizes() {
  return (
    <Fold id="prizes" light>
      <div className="grid items-end gap-10 md:grid-cols-[minmax(0,1fr)_auto]">
        <SectionHeading eyebrow="Prizes" dim="Three on the podium," bright="$3,000 in cash." intro={p.note} />
        <figure className="mx-auto w-56">
          <Statue name="discobolus" ink="#141414" paper="#f2f2f2" alt="The Discobolus, an athlete throwing a discus, printed as a halftone" className="mx-auto w-32 lg:w-36" />
          <Caption n={4}>Myron&rsquo;s discus thrower: winners were crowned with olive, yours get cash.</Caption>
        </figure>
      </div>

      <div className="mt-14 grid border-t border-dashed border-hairline sm:grid-cols-3">
        {p.podium.map((w, i) => (
          <Reveal key={w.place} delay={i * 90} className="border-b border-dashed border-hairline py-8 sm:border-b-0 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0">
            <p className="font-dots text-7xl leading-none font-black text-bright sm:text-8xl">{w.place}</p>
            <p className="mt-6 font-display text-4xl text-bright">
              {w.prize} <span className="font-plex text-sm text-lightgray">cash</span>
            </p>
            <p className="mt-4 inline-flex items-baseline gap-2 bg-lime px-3 py-2 text-[#0a0a0a]">
              <span className="font-dots text-3xl leading-none font-black sm:text-4xl">+{w.credits.split(" ")[0]}</span>
              <span className="font-plex text-sm">{w.credits.split(" ").slice(1).join(" ")}</span>
            </p>
          </Reveal>
        ))}
      </div>

      <dl className="mt-10 grid gap-px border border-dashed border-hairline bg-hairline md:grid-cols-3">
        {p.perks.map((x) => (
          <div key={x.who} className="bg-ink p-6">
            <dt className="font-pixel text-xs uppercase tracking-[0.18em] text-lightgray">{x.who}</dt>
            <dd className="mt-3 font-display text-lg text-bright">{x.what}</dd>
          </div>
        ))}
      </dl>
    </Fold>
  );
}
