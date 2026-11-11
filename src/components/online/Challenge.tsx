import { onlineChallenge as c } from "@/data/online";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";
import Statue from "@/components/art/Statue";
import Caption from "@/components/art/Caption";

// The brief in two sentences and its three rules.
export default function Challenge() {
  return (
    <Fold id="challenge">
      <div className="grid items-end gap-10 md:grid-cols-[minmax(0,1fr)_auto]">
        <SectionHeading eyebrow="The challenge" dim="Build it with any agent," bright="Verify it with Kane." intro={<><p className="text-bright">{c.statement}</p><p className="mt-3">{c.why}</p></>} />
        <figure className="mx-auto w-56">
          <Statue name="hercules" alt="Herakles fighting the Lernaean Hydra, printed as a halftone" className="mx-auto w-28 lg:w-32" />
          <Caption n={3}>Cut one head off the Hydra and two grow back. Bugs work the same way, unless Kane is watching.</Caption>
        </figure>
      </div>

      <ol className="mt-14 grid gap-px border border-dashed border-hairline bg-hairline md:grid-cols-3">
        {c.rules.map((r, i) => (
          <Reveal key={r.title} delay={i * 90} className="bg-ink p-6 sm:p-8">
            <p className="font-dots text-4xl leading-none font-black text-lime">{String(i + 1).padStart(2, "0")}</p>
            <h3 className="mt-5 font-display text-xl text-bright">{r.title}</h3>
            <p className="mt-2 font-plex text-sm leading-relaxed text-lightgray">{r.body}</p>
          </Reveal>
        ))}
      </ol>
    </Fold>
  );
}
