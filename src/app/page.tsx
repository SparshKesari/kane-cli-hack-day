import type { Metadata } from "next";
import Hero from "@/components/Hero";
import BootScreen from "@/components/BootScreen";
import Mentions from "@/components/home/Mentions";
import Challenge from "@/components/online/Challenge";
import Lanes from "@/components/online/Lanes";
import Week from "@/components/online/Week";
import Start from "@/components/online/Start";
import SlackBand from "@/components/online/SlackBand";
import Prizes from "@/components/online/Prizes";
import Judging from "@/components/online/Judging";
import Rules from "@/components/online/Rules";
import Closer from "@/components/online/Closer";
import { onlineEvent } from "@/data/online";
import OnlineShell from "./o/Shell";

// The KaneCLI Online Hackathon homepage, in the SF Hack Day's visual language.
// Its sections live in components/online and read data/online.ts; the SF
// sections in components/home stay as they were for the team hub.
// Homepage only: the root layout's title template still names the SF event for /ship pages.
export const metadata: Metadata = {
  metadataBase: new URL("https://www.kaneclihack.sh"),
  title: { absolute: onlineEvent.name },
  description: onlineEvent.tagline,
  // The share card is generated at /o/opengraph-image (src/app/o/opengraph-image.tsx).
  openGraph: { title: onlineEvent.name, description: onlineEvent.tagline, url: "/", siteName: onlineEvent.name, type: "website", images: [{ url: "/o/opengraph-image", width: 1200, height: 630, alt: `${onlineEvent.name}: ${onlineEvent.tagline}` }] },
  twitter: { card: "summary_large_image", title: onlineEvent.name, description: onlineEvent.tagline, images: ["/o/opengraph-image"] },
};

export default function Home() {
  return (
    <OnlineShell>
      <Hero />
      <Challenge />
      <Week />
      <Start />
      <SlackBand />
      <Prizes />
      <Judging />
      <Lanes />
      <Rules />
      <Closer />
      <Mentions />
      <BootScreen />
    </OnlineShell>
  );
}
