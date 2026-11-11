/* eslint-disable @next/next/no-img-element -- small inline SVG logos */
import HalftoneHand from "./hero/HalftoneHand";
import DissolveWordmark from "./hero/DissolveWordmark";
import HeroLens from "./hero/HeroLens";
import LensText from "./hero/LensText";
import Link from "next/link";
import { onlineEvent } from "@/data/online";

// The homepage is the online hackathon now; same hero, new words.
const WORDMARK = ["KaneCLI Online", "Hackathon"];

export default function Hero() {
  return (
    <HeroLens
      id="top"
      className="relative grid grid-cols-2 content-center items-center gap-y-12 overflow-x-clip bg-black pt-8 pb-16 text-[#f2f2f2] lg:min-h-[calc(100svh-64px-57px)] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-y-0 lg:pb-24"
    >
      <HalftoneHand
        id="hero-hand-left"
        side="left"
        alt="A hand reaching to the right, printed as a halftone"
        className="w-full lg:-translate-y-[12%]"
      />
      <HalftoneHand
        id="hero-hand-right"
        side="right"
        alt="A hand reaching to the left, printed as a halftone"
        className="w-full lg:order-3 lg:translate-y-[18%]"
      />

      <div className="relative z-10 col-span-2 flex flex-col items-center px-4 text-center lg:order-2 lg:col-span-1 lg:px-8">
        <LensText
          text="Welcome to"
          className="font-pixel text-xl uppercase tracking-[0.25em] text-[#8a8a8a] sm:text-2xl"
        />

        <h1 className="mt-3 inline-block w-[min(clamp(15.2rem,30.4vw,28.85rem),calc(100vw-2rem))]">
          <span className="sr-only">KaneCLI Online Hackathon</span>
          <DissolveWordmark lines={WORDMARK} fontVar="--font-display" />
        </h1>

        <div className="mt-5 flex flex-col items-center gap-3 font-plex text-[21px] text-[#8a8a8a]">
          <span className="flex items-center gap-2">
            by
            <img src="/logos/testmu-ai.svg" alt="TestMu AI" width={1388} height={215} className="h-6 w-auto" />
          </span>
        </div>

        <p className="mt-8 max-w-md font-plex text-sm leading-relaxed text-lightgray">{onlineEvent.tagline}</p>
        <p className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-1 font-pixel text-sm uppercase tracking-[0.2em] text-lime sm:text-base">
          {onlineEvent.facts.map((f, i) => (
            <span key={f}>
              {i > 0 && <span aria-hidden className="mr-3 text-lightgray">·</span>}
              {f}
            </span>
          ))}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 font-plex text-sm">
          <Link href="/o/register" className="inline-flex min-h-11 items-center bg-bright px-5 text-ink transition-colors hover:bg-lime">
            Register yourself and your team →
          </Link>
          <Link href="/o/submit" className="inline-flex min-h-11 items-center border border-hairline px-5 text-bright transition-colors hover:border-lime">
            Submit your project
          </Link>
        </div>
      </div>
    </HeroLens>
  );
}
