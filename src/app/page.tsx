import Hero from "@/components/Hero";
import BootScreen from "@/components/BootScreen";
import NowNext from "@/components/home/NowNext";
import HomeStats from "@/components/live/HomeStats";
import { Suspense } from "react";
import Schedule from "@/components/home/Schedule";
import Challenge from "@/components/home/Challenge";
import Prizes from "@/components/home/Prizes";
import Judging from "@/components/home/Judging";
import Judges from "@/components/home/Judges";
import Rules from "@/components/home/Rules";
import Closer from "@/components/home/Closer";
import Mentions from "@/components/home/Mentions";

// The public pitch: when it is, what to build, what's at stake, who judges, and
// the rules. Setup, resources, submissions and help live in each team's hub.
export default function Home() {
  return (
    <main>
      <Hero />
      <NowNext />
      <Suspense fallback={null}>
        <HomeStats />
      </Suspense>
      <Schedule keyOnly />
      <Challenge />
      <Prizes />
      <Judging />
      <Judges />
      <Rules />
      <Closer />
      <Mentions />
      <BootScreen />
    </main>
  );
}
