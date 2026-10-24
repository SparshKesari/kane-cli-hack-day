import Link from "next/link";
import { FLOW_STEPS, stepOfStage, type FlowStage, type FlowStep } from "@/server/flow";

// The participant's place in the event-day flow: Profile → Team → Activate →
// Hub. The Codex step isn't a gate in the site (src/server/flow-ui.ts), so it
// isn't drawn here. Steps before the current one are done (and link back), the
// current one is lime, later ones are dim. Text + glyph, never colour alone.

const HREF: Record<FlowStep, string> = { profile: "/register", team: "/team", activate: "/activate", codex: "/setup", hub: "/me" };

const STEPS = FLOW_STEPS.filter((s) => s.id !== "codex");

export default function FlowProgress({ stage, viewing }: { stage: FlowStage | null; viewing?: FlowStep }) {
  const at = STEPS.findIndex((s) => s.id === stepOfStage(stage ?? "profile"));
  return (
    <nav aria-label="Your progress" className="border-b border-dashed border-hairline py-4" data-flow-stage={stage ?? "signed_out"}>
      <ol className="container-page flex flex-wrap items-center gap-x-2 gap-y-2 font-plex text-xs">
        {STEPS.map((s, i) => {
          const done = i < at;
          const current = i === at;
          const here = viewing === s.id;
          const glyph = done ? "■" : current ? "→" : "○";
          const cls = current ? "border-lime bg-lime-deep text-lime" : done ? "border-hairline text-bright" : "border-hairline text-lightgray";
          const body = (
            <span className={`inline-flex min-h-9 items-center gap-1.5 border px-2.5 ${cls} ${here ? "underline underline-offset-4" : ""}`}>
              <span aria-hidden="true">{glyph}</span>
              <span className="font-pixel text-[10px] uppercase tracking-[0.18em]">
                {i + 1} · {s.label}
              </span>
              <span className="sr-only">{done ? "(done)" : current ? "(current step)" : "(later)"}</span>
            </span>
          );
          return (
            <li key={s.id} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
              {done || current ? <Link href={HREF[s.id]}>{body}</Link> : body}
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="text-lightgray">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
