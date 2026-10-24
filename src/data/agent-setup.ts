// The participant path through Hack OS with an AI agent: install the helper,
// sign this machine in, connect Codex to the event MCP server, then work
// through the day with the hack-os skill. /setup, the team hub's Setup tab,
// /readiness and the passport all read from here, so a command changes in one
// place. Commands must match public/install.*, packages/kanehack and
// plugin/README.md.

export const SITE = "https://kaneclihack.sh";
/** The MCP endpoint uses the www host directly, so Codex never has to follow the apex redirect. */
export const MCP_URL = "https://www.kaneclihack.sh/mcp";

export type Cmd = { label: string; value: string; note?: string };

export const INSTALL: Cmd[] = [
  { label: "macOS / Linux", value: `curl -fsSL ${SITE}/install.sh | sh` },
  {
    label: "Windows (PowerShell)",
    value: "irm https://www.kaneclihack.sh/install.ps1 | iex",
    note: "Use the www address: Windows PowerShell 5.1 doesn't follow the redirect.",
  },
  {
    label: "From an AI agent (no terminal)",
    value: `curl -fsSL ${SITE}/install.sh | sh -s -- --yes`,
    note: "When Codex runs the installer it can't answer prompts; --yes answers them.",
  },
];

export const PAIR: Cmd[] = [
  { label: "In your own terminal, once", value: "kanehack password", note: "Your kaneclihack.sh password, typed hidden and kept in ~/.kanehack (mode 600). Never in a Codex chat." },
  {
    label: "Then (you or Codex)",
    value: "kanehack signin --email you@example.com",
    note: 'New here? kanehack register --name "Your Name" --email you@example.com --linkedin <handle> --x <handle> saves your profile and signs in.',
  },
  { label: "Or approve in the browser", value: "kanehack pair", note: "Approve the code it shows at /pair, signed in as yourself." },
];

export const CONNECT: Cmd[] = [
  {
    label: "Codex",
    value: "kanehack connect codex",
    note: "The skills load from ~/.agents/skills (the installer puts them there). Start a new Codex session, then type $hack-os.",
  },
];

export const PROVE: Cmd[] = [
  { label: "Your first reported run", value: `kanehack report -- kane-cli run "Open ${SITE} and find the schedule" --agent`, note: "It lands on your team's Proof tab." },
  { label: "Check your setup", value: "kanehack doctor" },
];

export type SkillInfo = { name: string; does: string; ask: string };

/** The two skills (plugin/skills/hack-os and hack-gtm) and what to ask them, by when in the day you'd reach for each. */
export const SKILL_GROUPS: { phase: string; skills: SkillInfo[] }[] = [
  {
    phase: "Get set up",
    skills: [{ name: "hack-os", does: "Checks your machine, signs it in to your passport and connects Codex to the event, with the exact fix for anything missing.", ask: "Show my Hack Day status and do my next step." }],
  },
  {
    phase: "Team and idea",
    skills: [{ name: "hack-os", does: "Creates, joins or finds a team, then checks your idea against the challenge. Advisory, never a score.", ask: "Find me a team that needs a frontend builder." }],
  },
  {
    phase: "Build and prove",
    skills: [{ name: "hack-os", does: "Tests your project with Kane CLI and records runs on your team's Proof tab, failures included.", ask: "Test our login flow with Kane and record it." }],
  },
  {
    phase: "Launch",
    skills: [{ name: "hack-gtm", does: "Drafts your X and LinkedIn posts, blog, Show HN post, deck and a demo video with voice-over from your project and Kane evidence. Samples: you approve and post them yourself.", ask: "Write our launch posts." }],
  },
  {
    phase: "Stuck",
    skills: [{ name: "hack-os", does: "Tries first-line fixes, then drafts a GitHub issue on Kane CLI (you approve it) or opens a mentor ticket.", ask: "I'm stuck: kane-cli run hangs." }],
  },
];
