import Link from "next/link";
import Button from "@/components/ui/Button";
import StepBlock, { Checklist } from "@/components/ui/StepBlock";
import { submissions } from "@/data/hackday";
import { to12h } from "@/lib/time";
import Afterburner from "@/components/machines/Afterburner";

// The three deadlines, in order, with what each one needs.
export default function SubmitBody({ dashboard }: { dashboard: string }) {
  const { team, idea, final } = submissions;
  return (
    <>
      <StepBlock id="team" kicker="Step 1 · Team registration" time={to12h(team.deadline)} tag="Due" title="Register your team">
        <Checklist label="You’ll need" items={team.needs} />
        <p>{team.solo}</p>
        {/* Only signed-in teams see this tab, so registration is already done. */}
        <p className="border-l-2 border-lime pl-4 text-bright">
          You’re registered. Add late teammates from the{" "}
          <Link href={dashboard} className="underline decoration-hairline underline-offset-4 hover:text-lime">
            dashboard
          </Link>
          .
        </p>
      </StepBlock>

      <StepBlock id="idea" kicker="Step 2 · Idea submission" time={to12h(idea.deadline)} tag="Due" title="Save your idea in the hub">
        <Checklist label="Add" items={idea.needs} />
        <p>{idea.note}</p>
        <Button href={idea.devpost.href}>{idea.devpost.label} →</Button>
      </StepBlock>

      <StepBlock id="final" kicker="Step 3 · Final submission" time={to12h(final.deadline)} tag="Due" title="Submit your project">
        <p>All three essentials, plus at least two content pieces. Tick them off as you ship.</p>
        {/* The bundle checklist as an engine: every piece adds thrust, all four content pieces light the afterburner. */}
        <Afterburner />

        <p className="border-l-2 border-lime pl-4 text-bright">{final.closing}</p>
        <div className="flex flex-wrap gap-3">
          <Button href={final.devpost.href}>{final.devpost.label} →</Button>
          <Button href="/content-hour" variant="secondary">
            Content hour plan
          </Button>
        </div>
      </StepBlock>
    </>
  );
}
