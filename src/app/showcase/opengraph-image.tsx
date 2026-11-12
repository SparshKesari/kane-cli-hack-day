import { onlineEvent } from "@/data/online";
import { OG_SIZE, ogCard } from "@/lib/online/og";

// The share card for /showcase.
export const alt = `Showcase: every project built for the ${onlineEvent.name}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: onlineEvent.name,
    corner: "by TestMu AI",
    title: "Showcase",
    subtitle: "Every project: built with an AI agent, verified with Kane CLI.",
    facts: ["The demo", "The code", "The story"],
    path: "kaneclihack.sh/showcase",
  });
}
