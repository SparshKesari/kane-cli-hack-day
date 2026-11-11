import { lanes } from "@/data/online";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";

// Ideas you can build, in four groups, each with one line and three starters. The wildcard lane
// sits in lime; the others light their number on hover.
export default function Lanes() {
  return (
    <Fold id="lanes">
      <SectionHeading eyebrow="Need an idea?" dim="Some ideas," bright="You can build." intro={lanes.intro} />
      <div className="mt-14 grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {lanes.items.map((l, i) => {
          const wild = "wild" in l && l.wild;
          return (
            <Reveal key={l.n} delay={i * 60} className={`group flex flex-col p-6 transition-colors ${wild ? "bg-lime text-[#0a0a0a]" : "bg-ink hover:bg-surface"}`}>
              <div className="flex items-start justify-between gap-3">
                <span aria-hidden className={`font-dots text-5xl leading-none font-black transition-colors ${wild ? "" : "text-hairline group-hover:text-lime"}`}>{String(l.n).padStart(2, "0")}</span>
                <span className={`border px-2 py-0.5 font-pixel text-xs uppercase tracking-[0.15em] whitespace-nowrap ${wild ? "border-[#0a0a0a]" : "border-lime text-lime"}`}>{l.tag}</span>
              </div>
              <h3 className={`mt-6 font-display text-2xl ${wild ? "" : "text-bright"}`}>{l.title}</h3>
              <p className={`mt-2 font-plex text-sm leading-relaxed ${wild ? "" : "text-lightgray"}`}>{l.lead}</p>
              <ul className={`mt-5 space-y-2 border-t border-dashed pt-5 ${wild ? "border-[#0a0a0a]/40" : "border-hairline"}`}>
                {l.ideas.map((idea) => (
                  <li key={idea} className={`flex gap-2 font-plex text-sm leading-relaxed ${wild ? "" : "text-bright"}`}>
                    <span aria-hidden className={wild ? "" : "text-lime"}>→</span>
                    <span>{idea}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          );
        })}
      </div>
    </Fold>
  );
}
