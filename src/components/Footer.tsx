import Link from "next/link";
import { event } from "@/data/hackday";

// Link columns over a giant dot-matrix wordmark, as in gradium.ai's footer.
// Public links go to the home page; /me resumes a signed-in participant's flow.
const columns = [
  {
    title: "The day",
    links: [
      { href: "/#schedule", label: "Schedule" },
      { href: "/#challenge", label: "The challenge" },
      { href: "/#prizes", label: "Prizes" },
      { href: "/#judges", label: "Judges" },
      { href: "/#rules", label: "Rules" },
    ],
  },
  {
    title: "Your day",
    links: [
      { href: "/#start", label: "Start here" },
      { href: "/me", label: "Continue where you left off" },
      { href: "/setup", label: "Set up Codex" },
    ],
  },
  {
    title: "During the event",
    links: [
      { href: "/match", label: "Matchmaking" },
      { href: "/help", label: "Help" },
      { href: "/live", label: "Live" },
      { href: "/judging", label: "Judging" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-hairline bg-gradient-to-t from-[#0f1011] to-ink pt-16">
      <div className="container-page">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-[auto_repeat(3,minmax(0,1fr))]">
          {/* The Kane CLI mascot, drawn in ASCII. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- static artwork */}
          <img
            src="/logos/kane-ascii-lg.png"
            alt="Kane CLI"
            width={480}
            height={465}
            loading="lazy"
            className="col-span-2 w-36 sm:col-span-3 lg:col-span-1 lg:w-44"
          />
          {columns.map((c) => (
            <div key={c.title}>
              <p className="font-plex text-sm text-bright">{c.title}</p>
              <ul className="mt-3 space-y-2">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="font-plex text-sm text-lightgray transition-colors hover:text-bright">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 h-px bg-hairline" />
        <p
          aria-hidden
          className="mt-6 select-none font-dots text-[17vw] leading-[0.85] font-black tracking-[-0.04em] text-[#3a3a3a] lg:text-[13.5rem]"
        >
          Kane CLI
        </p>
        <div className="flex flex-col gap-2 py-6 font-plex text-xs text-lightgray sm:flex-row sm:justify-between">
          <p>
            {event.name} {event.city} · by TestMu AI · supported by {event.supporter}
          </p>
          <p>{event.hashtag}</p>
        </div>
      </div>
    </footer>
  );
}
