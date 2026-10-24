import Rubric from "@/components/judging/Rubric";
import { Fold, SectionHeading } from "@/components/ui/Section";
import StepBlock, { Checklist } from "@/components/ui/StepBlock";
import { evaluations, judging, judgingCriteria } from "@/data/hackday";

// Both table rounds, the rubric, and the stage format.
export default function JudgingBody() {
  const { mid, final } = evaluations;
  return (
    <>
      <StepBlock id="mid" kicker="Round 1 · Feedback only" time={mid.time} tag="Not scored" title={mid.title}>
        <p>{mid.body}</p>
        <Checklist label="Mentors check for" items={mid.checks} />
      </StepBlock>

      <StepBlock id="final" kicker="Round 2 · Scored" time={final.time} tag="Scored" title={final.title}>
        <p>{final.body}</p>
        <Checklist items={final.checks} />
      </StepBlock>

      <Fold id="rubric">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <SectionHeading eyebrow="Rubric" dim="Same rubric," bright="Every track." intro={`Four criteria, 25 points each. Three gates first: ${judgingCriteria.gates.items.join("; ")}. ${judgingCriteria.gates.note}`} />
            <p className="mt-6 max-w-xl font-plex text-sm leading-relaxed text-lightgray">{judging.eligibilityNote}</p>
          </div>
          <Rubric />
        </div>
      </Fold>

      <Fold id="stage">
        <SectionHeading eyebrow="Stage · 6:00 – 7:00" dim="Top 7," bright="Five minutes each." intro={judging.shortlist} />
        <div className="mt-12 grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-2">
          <div className="bg-ink p-8">
            <p className="font-dots text-6xl leading-none font-black text-lime">3:00</p>
            <p className="mt-4 font-display text-xl text-bright">{judging.stage.demo}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 font-plex text-sm text-lightgray">
              {judging.demoChecklist.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </div>
          <div className="bg-ink p-8">
            <p className="font-dots text-6xl leading-none font-black text-bright">2:00</p>
            <p className="mt-4 font-display text-xl text-bright">{judging.stage.qa}</p>
            <p className="mt-2 font-plex text-sm text-lightgray">{judging.shippedNote}</p>
          </div>
        </div>
      </Fold>

    </>
  );
}
