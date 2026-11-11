"use client";

import { useSyncExternalStore } from "react";
import { week, type WeekSlot } from "@/data/online";
import { Fold, SectionHeading } from "@/components/ui/Section";

// The week as a dashed-rule table, like the SF day schedule: the deadline is
// tagged Due, the optional check-ins Check, and rows behind us dim.
export default function Week() {
  // The browser's clock, to the minute; null while server-rendering.
  const now = useSyncExternalStore(subscribeMinute, minuteNow, () => null);

  // The current row: the last dated slot that has started.
  const started = (s: WeekSlot) => now !== null && !!s.at && Date.parse(s.at) <= now;
  const currentIndex = week.slots.reduce((acc, s, i) => (started(s) ? i : acc), -1);

  return (
    <Fold id="schedule">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <SectionHeading
          eyebrow="The week"
          dim="One week,"
          bright="Ship by the 19th."
          intro={
            <>
              {week.intro}
              <br />
              The deadline is marked <span className="text-lime">Due</span>.
            </>
          }
        />
        <ol className="border-t border-dashed border-hairline">
          {week.slots.map((s, i) => {
            const isNow = i === currentIndex && s.kind !== "deadline";
            const past = currentIndex > i && !!s.at;
            return (
              <li
                key={s.title}
                className={`grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-dashed border-hairline px-2 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] ${
                  isNow ? "bg-lime text-ink" : past ? "opacity-45" : ""
                }`}
              >
                <span className={`font-plex text-sm tabular-nums ${isNow ? "" : "text-lightgray"}`}>
                  {s.date}
                  {s.time && <span className="block text-xs">{s.time}</span>}
                </span>
                <span>
                  <span className={`font-display text-lg ${isNow ? "" : "text-bright"}`}>{s.title}</span>
                  {s.note && <span className={`block font-plex text-sm ${isNow ? "" : "text-lightgray"}`}>{s.note}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {isNow && <span className="font-pixel text-xs uppercase tracking-[0.15em]">Now</span>}
                  {s.kind === "deadline" && <Tag strong={isNow}>Due</Tag>}
                  {s.kind === "check" && <Tag strong={isNow} muted>Check</Tag>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </Fold>
  );
}

function subscribeMinute(onChange: () => void) {
  const t = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(t);
}

function minuteNow() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function Tag({ children, strong, muted }: { children: string; strong: boolean; muted?: boolean }) {
  return (
    <span
      className={`border px-1.5 py-0.5 font-pixel text-xs uppercase tracking-[0.15em] ${
        strong ? "border-ink" : muted ? "border-hairline text-lightgray" : "border-lime text-lime"
      }`}
    >
      {children}
    </span>
  );
}
