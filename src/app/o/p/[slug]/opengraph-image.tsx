import { connection } from "next/server";
import { onlineEvent } from "@/data/online";
import { OG_SIZE, ogCard } from "@/lib/online/og";
import { getSubmission } from "@/lib/online/submission";
import { getMembers, getTeamBySlug } from "@/lib/online/team";

// A project's share card. Only submitted, visible projects get their name on
// it; anything else gets the event's card, so a draft never leaks through a crawler.
export const alt = "A project built for the KaneCLI Online Hackathon";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const team = await getTeamBySlug(slug).catch(() => null);
  const sub = team && !team.hidden ? await getSubmission(team.id).catch(() => null) : null;
  if (!team || sub?.status !== "submitted") {
    return ogCard({ eyebrow: "Welcome to", corner: "by TestMu AI", title: onlineEvent.name, subtitle: onlineEvent.tagline, facts: ["12 – 19 November", "$3,000 in prizes", "Online"], path: "kaneclihack.sh" });
  }
  const members = await getMembers(team.id).catch(() => []);
  return ogCard({
    eyebrow: "Built for the KaneCLI Online Hackathon",
    corner: team.solo ? (members[0]?.name ?? "") : `Team ${team.name}`,
    title: sub.project_name ?? team.name,
    subtitle: sub.one_line_pitch ?? "",
    facts: [sub.agent_used ?? "AI agent", "Tested with Kane CLI"],
    path: `kaneclihack.sh/online/p/${team.slug}`,
  });
}
