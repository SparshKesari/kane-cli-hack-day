"use client";

import Link from "next/link";
import { onGroundHelp, schedule, type Slot } from "@/data/hackday";
import { Fold, SectionHeading } from "@/components/ui/Section";
import { slotLabel, toMinutes } from "@/lib/time";
import { useDayState } from "@/lib/useDayState";
import Antikythera from "@/components/machines/Antikythera";

// The run of the day as a dashed-rule table (like Phonon's model table), with
// hard deadlines tagged and the current slot lit while the event is live.
// The public page shows only the key times, unlinked; the hub shows the full day.
export default function Schedule({ keyOnly = false }: { keyOnly?: boolean }) {
  const day = useDayState();
  const slots = keyOnly ? schedule.filter((s) => s.key) : schedule;
  // Public rows aren't links: the pages they point at are behind the team login.
  const linkOf = (s: Slot) => (keyOnly ? undefined : s.href);
  const isNow = (s: Slot) => day?.phase === "during" && day.current === s;
  const isPast = (s: Slot) =>
    day?.phase === "after" || (day?.phase === "during" && toMinutes(s.end ?? s.start) <= day.minutes && day.current !== s);

  return (
    <Fold id="schedule">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <SectionHeading
            eyebrow="Schedule"
            dim="One day,"
            bright="Ship by six."
            intro={
              <>
                Deadlines are marked <span className="text-lime">Due</span>.
                {keyOnly ? (
                  <>
                    <br />
                    Key times only. Log in for the full day.
                  </>
                ) : (
                  <>
                    <br />
                    On-ground help: {onGroundHelp}
                  </>
                )}
              </>
            }
          />
          {/* The Antikythera mechanism, the ancient Greek clockwork computer, keeps the day. */}
          <Antikythera className="mt-10" />
        </div>

        <ol className="border-t border-dashed border-hairline">
          {slots.map((s, i) => {
            const now = isNow(s);
            const row = (
              <div
                className={`grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-dashed border-hairline px-2 py-4 transition-colors sm:grid-cols-[8rem_minmax(0,1fr)_auto] ${
                  now ? "bg-lime text-ink" : isPast(s) ? "opacity-45" : ""
                } ${linkOf(s) ? `group ${now ? "" : "hover:bg-surface"}` : ""}`}
              >
                <span className={`font-plex text-sm tabular-nums ${now ? "" : "text-lightgray"}`}>{slotLabel(s)}</span>
                <span>
                  <span className={`font-display text-lg ${now ? "" : "text-bright"}`}>{s.title}</span>
                  {s.note && <span className={`block font-plex text-xs ${now ? "" : "text-lightgray"}`}>{s.note}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {now && <span className="font-pixel text-[10px] uppercase tracking-[0.2em]">Now</span>}
                  {s.deadline && (
                    <span
                      className={`border px-1.5 py-0.5 font-pixel text-[10px] uppercase tracking-[0.2em] ${
                        now ? "border-ink" : "border-lime text-lime"
                      }`}
                    >
                      Due
                    </span>
                  )}
                  {linkOf(s) && <span className="font-plex text-sm text-lightgray group-hover:text-lime">→</span>}
                </span>
              </div>
            );
            return (
              <li key={`${s.start}-${i}`}>
                {linkOf(s) ? (
                  <Link href={linkOf(s)!} className="block">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </Fold>
  );
}
