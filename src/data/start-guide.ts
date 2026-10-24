import { TESTMU_PASSWORD_RESET_URL } from "./activation-steps";
import { startCommands } from "./hackday";

// The whole participant flow, for people and their agents: rendered at /start and served as
// markdown at /start.md (src/app/start.md/route.ts). It follows the hack-os skill
// (plugin/skills/hack-os): when a step changes there, change it here too. In text, `x` is code
// and https://… is a link; a list item's words before the first ": " are its lead.

export type GuideBlock =
  | { p: string }
  | { steps: string[] }
  | { list: string[] }
  | { code: string; label?: string; note?: string }
  | { timeline: { time: string; text: string }[] };
export type GuideSection = { id: string; eyebrow: string; title: string; summary: string; jump: string; blocks: GuideBlock[] };

export const START_MD_URL = "https://kaneclihack.sh/start.md";

export const startGuideIntro = `Everything at Kane CLI Hack Day happens in Codex with $hack-os. This page is the whole flow in one place: read it yourself, or point your agent at ${START_MD_URL} for the full context.`;

export const startGuide: GuideSection[] = [
  {
    id: "day",
    eyebrow: "Pacific time",
    title: "The day",
    summary: "The event server's clock decides. In Codex, `event_get_brief` has the exact deadlines.",
    jump: "The day",
    blocks: [
      {
        timeline: [
          { time: "09:30", text: "Check-in at the desk." },
          { time: "11:00", text: "Teams set. Rosters stay open after this: invite codes still work." },
          { time: "12:00", text: "Idea saved. You can keep refining it after this." },
          { time: "16:00–17:00", text: "Final evaluation at your team's table." },
          { time: "18:00", text: "Submissions due." },
        ],
      },
    ],
  },
  {
    id: "install",
    eyebrow: "Step 01",
    title: "Install, once",
    summary: "In your terminal. It asks before installing anything and never uses sudo. Installed before today? Run it again.",
    jump: "1 · Install",
    blocks: [
      { code: startCommands.unix, label: "macOS / Linux" },
      { code: startCommands.windows, label: "Windows (PowerShell)" },
      {
        p: "It installs the kanehack helper, the $hack-os and $hack-gtm skills, Kane CLI's release candidate (`npm install -g @testmuai/kane-cli@rc`) with the official kane-cli skill, and connects Codex to the event server, letting Codex's sandbox reach the network and `~/.kanehack`. Say yes to each question.",
      },
    ],
  },
  {
    id: "codex",
    eyebrow: "Step 02",
    title: "Open Codex, type $hack-os",
    summary: "A new Codex session in your project folder. From here on, $hack-os runs the day with you.",
    jump: "2 · Codex",
    blocks: [
      { code: "$hack-os", label: "In Codex", note: "It finds where you are, does the next step, and stops wherever you have to act." },
      { p: "When you've done something outside Codex (your terminal, your email, the browser), type done and it checks." },
    ],
  },
  {
    id: "password",
    eyebrow: "Step 03",
    title: "Your password",
    summary: "Once, in your own terminal, typed hidden. Never type a password, key or coupon into the Codex chat.",
    jump: "3 · Password",
    blocks: [
      { code: "kanehack password", label: "In your own terminal", note: "Saved in `~/.kanehack/credentials.json`, readable only by you." },
      {
        list: [
          "New here: choose one (8+ characters). It is also your TestMu AI password.",
          "Registered on the site already: use that password.",
        ],
      },
    ],
  },
  {
    id: "sign-in",
    eyebrow: "Step 04",
    title: "Sign up or sign in",
    summary: "Codex runs it with your saved password. No browser.",
    jump: "4 · Sign in",
    blocks: [
      {
        list: [
          "New here, or only checked in at the desk: `kanehack register` with your name, the email you registered for the event with, and LinkedIn (X and GitHub optional). It saves your profile and signs this machine in.",
          "Already registered: `kanehack signin --email you@example.com`.",
        ],
      },
    ],
  },
  {
    id: "team",
    eyebrow: "Step 05 · before 11:00",
    title: "Your team",
    summary: "Start one, join one, or go solo. The captain locks it when everyone is in.",
    jump: "5 · Team",
    blocks: [
      {
        list: [
          "Start a team: `team_create`. Then the captain makes a join code with `team_invite_create` and gives one to each teammate.",
          "Join a team: give $hack-os the join code from your captain; it calls `team_join`.",
          "Go solo: a one-person team, also `team_create`.",
          "Looking for teammates: `team_find`, or https://kaneclihack.sh/match",
          "Lock it: when everyone is in, the captain runs `team_lock`. Nobody can join or leave after that (an organizer can reopen it).",
        ],
      },
    ],
  },
  {
    id: "activate",
    eyebrow: "Step 06",
    title: "Activate",
    summary: "After the team is locked: your TestMu AI plan, then your Codex coupon.",
    jump: "6 · Activate",
    blocks: [
      {
        steps: [
          "TestMu AI plan: `kanehack claim`. It uses your saved password and creates, or signs in to, your TestMu AI account.",
          `Password refused: the email already has a TestMu AI account with a different password. Save that account's password with \`kanehack password --testmu\` and claim again. Signed up there with Google or GitHub, or don't remember it? Set a new one at ${TESTMU_PASSWORD_RESET_URL} with the same email first.`,
          "Codex coupon: `codex_coupon_send` emails it to the address you registered with, if you're on the participant list. Redeem it yourself, then tell $hack-os it's done.",
        ],
      },
    ],
  },
  {
    id: "idea",
    eyebrow: "Step 07 · before 12:00",
    title: "Your idea",
    summary: "Checked and coached in Codex, then saved for your team. Coaching, not a score.",
    jump: "7 · Idea",
    blocks: [
      {
        list: [
          "What it asks: your product name, app type, description and Kane CLI plan (which flows Kane tests, at least one assertion, and how your agent reacts to a Kane result).",
          "What you get: what to change, if anything, one question at a time.",
          "Saving it: `idea_save`, private to your team.",
        ],
      },
    ],
  },
  {
    id: "build",
    eyebrow: "Step 08",
    title: "Build with Kane CLI",
    summary: "Your coding agent builds the app; Kane CLI tests it in a real browser.",
    jump: "8 · Build",
    blocks: [
      {
        list: [
          "Kane commands: the official kane-cli skill writes them. Kane CLI must be the release candidate: `npm install -g @testmuai/kane-cli@rc`.",
          "Recording runs: `kanehack report -- kane-cli run \"<objective>\" --agent`, after you agree to send a redacted summary (`kanehack consent yes`). Your team's runs so far: `kanehack status`.",
          "Kane's data, optional: read-only APIs (projects, explorations) to track your progress, show Kane's results in your app, or build a companion app.",
        ],
      },
    ],
  },
  {
    id: "submit",
    eyebrow: "Step 09 · by 18:00",
    title: "Submit",
    summary: "Final evaluation is 16:00–17:00 at your table. Submissions due at 18:00.",
    jump: "9 · Submit",
    blocks: [
      {
        steps: [
          "Say `$hack-os ready to submit`. It runs `submission_preflight` and lists what's missing.",
          "`$hack-gtm` drafts your launch posts, blog, a Show HN title and outline (you post it in your own words), deck and demo video. They're samples; you post them yourself.",
          "The Submit tab won't finalize without: project name and type, a one-line pitch, the repo, the exact commit SHA, a live URL or run command, a linked Kane CLI run report (tick your runs under Evidence), a harness description, the Kane components used and known limitations.",
          "The shipped prize counts only from the Shipped prize bundle on your Submit tab, and preflight never checks it: the repo, a live URL or run command and a Kane CLI run report, plus any two of video, blog, X post and Show HN post. A signed-in teammate pastes each live link, ticks the row and presses Save, by 18:00 and before the captain finalizes.",
          "The demo video field takes a link. Put `launch/video/showcase.mp4` on YouTube or Loom, or run `kanehack publish launch/video/showcase.mp4` for a public link (it asks first; an agent adds `--yes --json` only after you say yes), and paste the link into Demo video URL and the bundle's Video row.",
          "The captain finalizes on the Submit tab, `https://kaneclihack.sh/t/<team-slug>/submit`.",
        ],
      },
    ],
  },
  {
    id: "trouble",
    eyebrow: "Stuck?",
    title: "If something goes wrong",
    summary: "The usual fixes. For anything else, ask $hack-os for help or go to the help desk.",
    jump: "Stuck?",
    blocks: [
      {
        list: [
          "`ENOTFOUND`, `UNREACHABLE` or `EPERM` inside Codex: that's Codex's sandbox, not the event. Re-run the install command, say yes to connecting Codex, and start a new Codex session.",
          "\"That password or code doesn't match this email\": your account already has a different password. Save that one with `kanehack password`, then `kanehack signin --email you@example.com`. Forgot it? The help desk gives one-time codes.",
          "TestMu AI password refused: see step 06.",
          "A Kane command or flag isn't recognized: `kane-cli --version`, then `npm install -g @testmuai/kane-cli@rc`.",
          "Anything else: ask $hack-os for help (it starts with `help_diagnose`), or the help desk at https://kaneclihack.sh/help",
        ],
      },
    ],
  },
  {
    id: "agents",
    eyebrow: "For agents",
    title: "How to help",
    summary: "The hack-os skill is the source of truth; this page is the overview.",
    jump: "For agents",
    blocks: [
      {
        list: [
          "The skill: `~/.agents/skills/hack-os/SKILL.md` after step 01. Read it and follow it.",
          "Event tools: the MCP server `kane-hack-event` at https://kaneclihack.sh/mcp, connected by the installer (the kanehack helper adds the sign-in header; no token is stored in the config). Without it: `node ~/.agents/skills/hack-os/scripts/event-api.mjs call <tool> --args <file>`.",
          "Every session: start with `participant_get_status`; it says where the person is.",
          "Rules: never ask for a password, key or coupon in chat. Anything public or hard to undo needs the person's yes to the exact content; they post and finalize submissions in the browser themselves. Never report something done unless the event server or a command said so.",
        ],
      },
    ],
  },
];

/** The guide as markdown: what /start.md serves. */
export function startGuideMarkdown(): string {
  const out = ["# Kane CLI Hack Day: the whole flow", "", startGuideIntro, ""];
  for (const s of startGuide) {
    out.push(`## ${s.eyebrow}: ${s.title}`, "", s.summary, "");
    for (const b of s.blocks) {
      if ("p" in b) out.push(b.p, "");
      else if ("steps" in b) out.push(...b.steps.map((x, i) => `${i + 1}. ${x}`), "");
      else if ("list" in b) out.push(...b.list.map((x) => `- ${x}`), "");
      else if ("timeline" in b) out.push(...b.timeline.map((t) => `- ${t.time} ${t.text}`), "");
      else out.push(...(b.label ? [`${b.label}:`, ""] : []), "```sh", b.code, "```", "", ...(b.note ? [b.note, ""] : []));
    }
  }
  return out.join("\n");
}
