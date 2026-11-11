import { onlineEvent } from "@/data/online";
import { OG_SIZE, ogCard } from "@/lib/online/og";

// The share card for the homepage and every /online page without its own.
export const alt = `${onlineEvent.name}: ${onlineEvent.tagline}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Welcome to",
    corner: "by TestMu AI",
    title: onlineEvent.name,
    subtitle: onlineEvent.tagline,
    facts: ["12 – 19 November", "$3,000 in prizes", "Online"],
    path: "kaneclihack.sh",
  });
}
