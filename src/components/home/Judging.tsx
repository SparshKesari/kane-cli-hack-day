import { judgingCriteria as j } from "@/data/hackday";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";

// The published rubric: three gates, then four criteria at 25 each. The first
// three break into weighted parts; GTM is a per-asset points table.
export default function Judging() {
  return (
    <Fold id="judging">
      <SectionHeading eyebrow="Judging" dim="Four criteria," bright="100 points." intro={j.intro} />

      {/* The gates sit in lime: miss one and you can't place. */}
      <Reveal className="mt-14 bg-lime p-6 text-[#0a0a0a] sm:p-8">
        <p className="font-pixel text-xs uppercase tracking-[0.25em]">{j.gates.title}</p>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {j.gates.items.map((g, i) => (
            <li key={g} className="flex items-baseline gap-3 font-display text-lg">
              <span className="font-dots text-2xl leading-none font-black">{i + 1}</span>
              {g}
            </li>
          ))}
        </ol>
        <p className="mt-6 font-plex text-sm">{j.gates.note}</p>
      </Reveal>

      <div className="mt-10 border-t border-dashed border-hairline">
        {j.criteria.map((c) => (
          <Reveal key={c.n} className="grid gap-6 border-b border-dashed border-hairline py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <Criterion n={c.n} title={c.title} points={c.points} lead={"lead" in c ? c.lead : undefined} />
            <dl className="grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-3">
              {c.parts.map((p) => (
                <div key={p.name} className="bg-ink p-4">
                  <dt className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-lg text-bright">{p.name}</span>
                    <span className="shrink-0 whitespace-nowrap font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">{p.points} pts</span>
                  </dt>
                  <dd className="mt-2 font-plex text-xs leading-relaxed text-lightgray">{p.body}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        ))}

        <Reveal className="grid gap-6 border-b border-dashed border-hairline py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <Criterion n={j.gtm.n} title={j.gtm.title} points={j.gtm.points} when={j.gtm.when} lead={j.gtm.lead} />
          <table className="w-full border border-dashed border-hairline text-left">
            <thead>
              <tr className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">
                <th className="px-4 py-3 font-normal">Asset</th>
                <th className="px-4 py-3 font-normal">Pts</th>
                <th className="hidden px-4 py-3 font-normal sm:table-cell">What earns full marks</th>
              </tr>
            </thead>
            <tbody>
              {j.gtm.assets.map((a) => (
                <tr key={a.asset} className="border-t border-dashed border-hairline align-top">
                  <td className="px-4 py-3">
                    <span className="font-display text-base text-bright">{a.asset}</span>
                    {/* On phones the description folds under the asset name. */}
                    <span className="mt-1 block font-plex text-xs leading-relaxed text-lightgray sm:hidden">{a.full}</span>
                  </td>
                  <td className="px-4 py-3 font-dots text-xl leading-none font-black text-lime">{a.points}</td>
                  <td className="hidden px-4 py-3 font-plex text-xs leading-relaxed text-lightgray sm:table-cell">{a.full}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </Fold>
  );
}

function Criterion({ n, title, points, when, lead }: { n: string; title: string; points: number; when?: string; lead?: string }) {
  return (
    <div>
      <p className="font-pixel text-xs uppercase tracking-[0.25em] text-lightgray">{n}</p>
      <h3 className="mt-3 font-display text-2xl text-bright">{title}</h3>
      <p className="mt-4 inline-flex items-baseline gap-2">
        <span className="font-dots text-5xl leading-none font-black text-lime">{points}</span>
        <span className="font-plex text-sm text-lightgray">points</span>
      </p>
      {when && <p className="mt-3 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{when}</p>}
      {lead && <p className="mt-4 max-w-sm font-plex text-sm leading-relaxed text-lightgray">{lead}</p>}
    </div>
  );
}
