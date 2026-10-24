import Link from "next/link";
import { contentHour, submissions } from "@/data/hackday";
import { Fold, SectionHeading } from "@/components/ui/Section";
import Reveal from "@/components/ui/Reveal";
import { to12h } from "@/lib/time";

// The three things attendees hand in, in order, each linking to the full
// instructions on /submit. Content hour sits between evaluation and the 6:00 due time.
const steps = [
  {
    id: "team",
    title: "Register your team",
    deadline: submissions.team.deadline,
    summary: submissions.team.needs.join(" · "),
    href: "/submit#team",
  },
  {
    id: "idea",
    title: "Submit your idea",
    deadline: submissions.idea.deadline,
    summary: submissions.idea.needs.join(" · "),
    href: "/submit#idea",
  },
  {
    id: "final",
    title: "Submit your project",
    deadline: submissions.final.deadline,
    summary: `${submissions.final.minimum.join(" · ")} + content`,
    href: "/submit#final",
  },
];

export default function Deliverables() {
  const totalMinutes = contentHour.steps.reduce((n, s) => n + s.minutes, 0);
  return (
    <Fold id="submit">
      <SectionHeading
        eyebrow="Submissions"
        dim="Three deadlines,"
        bright="One submission."
        intro="Everything you hand in today, in order. Each one has a due time."
      />

      <ol className="mt-14 grid gap-px border border-dashed border-hairline bg-hairline md:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal as="li" key={s.id} delay={i * 80} className="bg-ink">
            <Link href={s.href} className="group flex h-full flex-col gap-6 p-6 transition-colors hover:bg-surface">
              <div className="flex items-baseline justify-between">
                <span className="font-pixel text-xs tracking-[0.25em] text-lightgray">Step {i + 1}</span>
                <span className="border border-lime px-1.5 py-0.5 font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">
                  Due {to12h(s.deadline)}
                </span>
              </div>
              <p className="font-dots text-6xl leading-none font-black text-bright">{to12h(s.deadline)}</p>
              <div>
                <h3 className="font-display text-xl text-bright">{s.title}</h3>
                <p className="mt-2 font-plex text-xs leading-relaxed text-lightgray">{s.summary}</p>
              </div>
              <span className="mt-auto font-plex text-sm text-bright group-hover:text-lime">How to submit →</span>
            </Link>
          </Reveal>
        ))}
      </ol>

      <Reveal className="mt-6">
        <Link
          href="/content-hour"
          className="group flex flex-col gap-4 border border-dashed border-hairline p-6 transition-colors hover:border-lime sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-pixel text-xs uppercase tracking-[0.25em] text-lightgray">5:00 – 6:00 · Content hour</p>
            <p className="mt-2 font-display text-xl text-bright">Ship it, then tell people. A {totalMinutes}-minute plan.</p>
          </div>
          {/* Proportional bar of the content-hour steps. */}
          <div className="flex h-2 w-full gap-px sm:w-72" aria-hidden>
            {contentHour.steps.map((s) => (
              <span key={s.title} className="bg-hairline transition-colors group-hover:bg-lime" style={{ flex: s.minutes }} />
            ))}
          </div>
        </Link>
      </Reveal>
      <Link href="/submit#final" className="mt-4 inline-block font-plex text-sm text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
        Track your final bundle →
      </Link>
    </Fold>
  );
}
