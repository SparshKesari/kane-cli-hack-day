import type { StaffRole } from "@/server/core";

// Every /ops section and which staff roles may open it (admin opens all).
// Pages enforce this themselves with requireRole(); the nav only hides links.
export const OPS_NAV: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: "/ops", label: "Overview", roles: ["organizer"] },
  { href: "/ops/workflow", label: "Workflow owners", roles: ["organizer"] },
  { href: "/ops/checkin", label: "Check-in", roles: ["organizer", "mentor"] },
  { href: "/ops/roster", label: "Roster", roles: ["organizer"] },
  { href: "/ops/matchmaking", label: "Matchmaking", roles: ["organizer"] },
  { href: "/ops/activation", label: "Activation", roles: ["organizer"] },
  { href: "/ops/help", label: "Help", roles: ["organizer", "mentor"] },
  { href: "/ops/submissions", label: "Submissions", roles: ["organizer"] },
  { href: "/ops/media", label: "Media", roles: ["organizer", "photographer"] },
  { href: "/ops/judging", label: "Judging", roles: ["organizer"] },
  { href: "/ops/integrations", label: "Integrations", roles: ["organizer"] },
  { href: "/ops/recovery", label: "Recovery", roles: ["organizer"] },
  { href: "/ops/announcements", label: "Announcements", roles: ["organizer"] },
  { href: "/ops/nudges", label: "Nudges", roles: ["organizer"] },
  { href: "/ops/settings", label: "Settings", roles: ["organizer"] },
  { href: "/ops/override", label: "Override", roles: ["organizer"] },
  { href: "/ops/audit", label: "Audit", roles: ["organizer"] },
];
