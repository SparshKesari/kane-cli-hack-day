"use client";

import Link from "next/link";
import { ctas, schedule } from "@/data/hackday";
import { slotLabel, to12h, toMinutes } from "@/lib/time";
import { useDayState } from "@/lib/useDayState";

// Thin live strip under the hero (where Phonon has its "trusted by" row):
// what's happening now, what's next, and how long until it.
export default function NowNext() {
  const day = useDayState();
  const deadlines = schedule.filter((s) => s.deadline);

  let now = "Hack Day";
  let next: { label: string; href?: string } | null = null;
  let eta = "";

  if (day?.phase === "before") {
    now = "Doors open at 9:30";
    next = { label: `Teams due at ${to12h(deadlines[0].start)}`, href: ctas.register.href };
  } else if (day?.phase === "during") {
    now = day.current ? day.current.title : "Doors open soon";
    if (day.next) {
      next = { label: `${day.next.title} · ${slotLabel(day.next)}`, href: day.next.href };
      const mins = toMinutes(day.next.start) - day.minutes;
      eta = mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins}m`;
    }
  } else if (day?.phase === "after") {
    now = "That’s a wrap. Thanks for building with us";
  }

  return (
    <div className="border-t border-dashed border-hairline">
      <div className="container-page flex flex-col gap-2 py-4 font-plex text-sm sm:flex-row sm:items-center sm:gap-6">
        <p className="flex items-center gap-2 font-pixel text-[10px] uppercase tracking-[0.25em] text-lime">
          <span aria-hidden className="h-1.5 w-1.5 animate-blink bg-lime" />
          {day?.phase === "during" ? "Live" : "Today"}
        </p>
        <p className="text-bright" aria-live="polite">
          <span className="text-lightgray">Now </span>
          {now}
        </p>
        {next && (
          <p className="text-bright sm:ml-auto">
            <span className="text-lightgray">Next </span>
            {next.href ? (
              <Link href={next.href} className="underline decoration-hairline underline-offset-4 hover:text-lime">
                {next.label}
              </Link>
            ) : (
              next.label
            )}
            {eta && <span className="text-lime"> {eta}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
