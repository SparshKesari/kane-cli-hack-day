// Copy for the KaneCLI Online Hackathon (the homepage and /online/*). Edit
// freely: none of it is read by the SF Hack Day pages, the team hub or /ship.
// Anything in [square brackets] is still a placeholder.

export type OnlineLink = { label: string; href: string };

const SLACK = "https://join.slack.com/t/kaneai/shared_invite/zt-4gbmvhfsl-yGamCWg~qgSi~_OfZMScpw";
const REGISTER = "https://www.testmuai.com/register/";
const CLAIM = "https://www.testmuai.com/kane-cli/#creditOffer";
const DOCS = "https://www.testmuai.com/support/docs/kane-cli-introduction/";

export const onlineLinks = {
  slack: SLACK,
  register: REGISTER,
  claim: CLAIM,
  docs: DOCS,
  support: "mailto:conferences@testmuai.com",
  terms: "https://www.testmuai.com/testmuconf-2026/conference-terms-and-conditions/",
};

export const onlineEvent = {
  name: "KaneCLI Online Hackathon",
  tagline: "Build it with any agent. Verify it with Kane. Ship in a week.",
  /** One line under the hero. */
  facts: ["12 – 19 November", "$3,000 in prizes", "Anywhere in the world"],
  intro:
    "A one-week online hackathon for developers who build with AI coding agents and want to see what happens when you put a real verification layer next to them.",
  /** ISO time with offset. After this, submissions can't be changed. 19 Nov, 11:59 PM IST. */
  submissionDeadline: "2026-11-19T23:59:00+05:30",
  deadlineLabel: "19 November, 11:59 PM IST (10:29 AM PT)",
};

// ── The challenge ────────────────────────────────────────────────────────────

export const onlineChallenge = {
  statement: "Build an app, an agent or a workflow with an AI coding agent, on web or mobile. Verify it with Kane CLI. Ship by 11:59 PM IST on 19 November.",
  why: "Agents write code fast but can't check their own work. Kane CLI closes that loop: describe a flow in plain English, get a pass or fail from a real browser, iOS simulator or Android emulator.",
  rules: [
    { title: "Any agent, any stack.", body: "Claude Code, Cursor, Copilot, Codex, Windsurf, Kiro, or your own MCP setup." },
    { title: "Kane CLI verifies it.", body: "Best of all, wire it into the agent loop: a hook, a re-prompt, a spec." },
    { title: "It runs, it ships.", body: "Demo it on video. Solo or teams of up to four." },
  ],
};

// ── Judging ──────────────────────────────────────────────────────────────────

export const onlineJudging = {
  intro: "Scored by three TestMu AI engineers. Clear the three bars first, then four dimensions, weighted equally.",
  bars: ["It works end to end", "Kane CLI caught or proved something", "Your agent and Kane CLI talked to each other"],
  barsNote: "Miss a bar and the judges can't score the rest.",
  criteria: [
    { n: "01", title: "Ships", body: "A real flow that runs end to end. Not slides." },
    { n: "02", title: "Verified", body: "Kane CLI caught or confirmed something meaningful." },
    { n: "03", title: "Closed loop", body: "Kane's result feeds back to the agent. Tighter is better." },
    { n: "04", title: "Craft", body: "Would a developer want to install this tonight?" },
  ],
  scoring: "Scores are averaged. Ties break on Verified, then Closed loop.",
  bonus: "Launch buzz is required: post about your project at least twice on Hacker News, X, Reddit or LinkedIn. More posts, reach and engagement earn brownie points.",
};

// ── Idea lanes ───────────────────────────────────────────────────────────────

export const lanes = {
  intro: "Starting points, not limits. Build anything that hits the brief. The weirder, the better.",
  items: [
    {
      n: 1,
      tag: "Web + Mobile",
      title: "Apps that prove themselves",
      lead: "Your agent builds it. Kane checks it in a real browser or on a phone.",
      ideas: ["An app that refuses to deploy until Kane signs off", "A checkout that breaks itself on purpose, then heals", "One prompt, two platforms: web and mobile, both verified"],
    },
    {
      n: 2,
      tag: "Workflow",
      title: "Workflows with a spine",
      lead: "Kane on save, on push, on a schedule.",
      ideas: ["A PR bot that replies with the video of your bug", "A README lie detector that runs your docs and reports what's false", "Git bisect on autopilot: find the commit that broke the flow"],
    },
    {
      n: 3,
      tag: "Agent",
      title: "Agents with hands",
      lead: "Kane as your agent's hands on the real web. No APIs.",
      ideas: ["A subscription killer for everything you forgot to cancel", "An agent that beats a browser game on vision alone", "A Wikipedia speedrun bot"],
    },
    {
      n: 4,
      tag: "Wildcard",
      title: "Pure chaos",
      lead: "The thing nobody asked for and everyone will share.",
      ideas: ["Two agents: one builds, one breaks, Kane referees", "An app written only by fixing failed Kane runs", "An agent that ships a blog post about itself"],
      wild: true,
    },
  ],
};

// ── The week ─────────────────────────────────────────────────────────────────

export type WeekSlot = {
  /** Short date label, e.g. "Thu 12 Nov". */
  date: string;
  time?: string;
  title: string;
  note?: string;
  kind?: "deadline" | "check" | "milestone";
  /** ISO time used to light up "now" and dim past rows. */
  at?: string;
};

export const week: { intro: string; slots: WeekSlot[] } = {
  intro: "Times in IST, with Pacific (PT) alongside.",
  slots: [
    { date: "Thu 12 Nov", title: "Kickoff. Building starts", kind: "milestone", at: "2026-11-12T00:00:00+05:30" },
    { date: "Thu 19 Nov", time: "11:59 PM IST", title: "Submission deadline", note: "10:29 AM PT. No pushes after this.", kind: "deadline", at: "2026-11-19T23:59:00+05:30" },
  ],
};

// ── Before you start + what to submit ────────────────────────────────────────

export const beforeYouStart = {
  steps: [
    {
      title: "Register on TestMu AI, then claim 10,000 free credits",
      body: "Required to be scored. Use the same email on both.",
      link: { label: "Claim your credits", href: CLAIM },
    },
    {
      title: "Install Kane CLI and run one flow",
      body: "",
      command: "npm install -g @testmuai/kane-cli",
      link: { label: "Kane CLI docs", href: DOCS },
    },
  ],
};

export const whatToSubmit = {
  intro: "By 11:59 PM IST on 19 November.",
  items: [
    { title: "GitHub URL", body: "Your repo, started on or after 12 Nov." },
    { title: "About your app", body: "What you built, which agent, what Kane does." },
    { title: "Demo video", body: "Hosted on YouTube. About 3 to 5 minutes." },
    { title: "Live URL", body: "If your project is deployed. Optional." },
    { title: "Launch buzz", body: "At least two public posts about your project (Hacker News, X, Reddit or LinkedIn). More posts and engagement earn brownie points.", bonus: true },
  ],
};

// ── Prizes ───────────────────────────────────────────────────────────────────

export const onlinePrizes = {
  note: "$3,000 USD in cash, split across 3 winners.",
  podium: [
    { place: "1st", prize: "$1,500", credits: "$250 OpenAI credits" },
    { place: "2nd", prize: "$1,000", credits: "$250 OpenAI credits" },
    { place: "3rd", prize: "$500", credits: "$250 OpenAI credits" },
  ],
  perks: [
    { who: "Winners also get", what: "A 1:1 with the founders, 3 months of Kane CLI Pro, a featured blog post" },
    { who: "Every team that ships", what: "The Verified with Kane CLI badge" },
    { who: "Every team that submits", what: "A participation certificate" },
  ],
};

// ── Rules ────────────────────────────────────────────────────────────────────

export const whoCanEnter = ["Anyone 18 or older, anywhere in the world", "Solo or teams of up to four", "No application, no cap"];

// Rules and the questions people actually ask, as one list.
export const onlineRules: { title: string; body: string }[] = [
  { title: "Built during the event", body: "Your repo must be initialized on or after 12 November. We check commit history. An old idea is fine; an old codebase is not." },
  { title: "Any agent. Kane CLI is the only requirement", body: "Use any agent, framework or stack. You must be signed up on testmuai.com and have run Kane CLI." },
  { title: "Do I need a paid Kane CLI plan?", body: "No. Every new TestMu AI account gets 10,000 free credits, valid for one month. Running low? DM us on Slack before the deadline." },
  { title: "Judges must be able to run it", body: "Hand over working credentials for any login or paid service, and include a fallback (a recorded run or backup deploy) for third-party services." },
  { title: "Do the demos have to be live?", body: "No. Everything is a recorded YouTube video, about 3 to 5 minutes." },
  { title: "Public repo, YouTube demo, two posts", body: "Your GitHub repo must be public and your demo video on YouTube. At least two different public posts about your project are part of the submission." },
  { title: "Submissions lock at the deadline", body: "You can update your submission as often as you like until then. One submission per team; the team captain receives the prize." },
];

export const guidelines = [
  "All contest decisions rest with the TestMu AI team. Judging, scoring, eligibility, and winner selection are at the team's sole discretion, and the team's decision is final and binding. No correspondence will be entered into on individual results.",
  "You must be signed up on the testmuai.com website and must have run Kane CLI to be eligible.",
  "TestMu AI reserves the right to verify entries and to disqualify any entry it judges to be fraudulent, automated, duplicated, or otherwise gaming the mechanics.",
  "TestMu AI reserves the right to modify, suspend, or cancel the hackathon, or to substitute a prize of equivalent value, at any point.",
  "Prize fulfilment (delivery method, timing, and any tax or regional restrictions) is handled by the TestMu AI team. Winners may need to supply details before a prize can be issued.",
  "Employees of TestMu AI and participating partners are not eligible to win.",
  "Code stays yours. By submitting, you grant TestMu AI permission to feature your project in marketing materials with attribution.",
  "The Code of Conduct applies throughout the hackathon, including Slack and all event channels. Organizers can take any action they consider appropriate, up to removing someone from the event. Concerns go to the TestMu AI team at conferences@testmuai.com.",
];

// ── Resources ────────────────────────────────────────────────────────────────

export const onlineResources: OnlineLink[] = [
  { label: "Claim 10,000 credits", href: CLAIM },
  { label: "Docs and quickstart", href: DOCS },
  { label: "Kane CLI Cookbook", href: "https://www.testmuai.com/kane-cli-cookbook/" },
  { label: "GitHub repo", href: "https://github.com/LambdaTest/kane-cli" },
  { label: "Slack community", href: SLACK },
];

export const slackCta = {
  title: "Join our Slack group",
  body: "For any questions, help from the Kane CLI engineers, extra credits and updates during the week.",
  button: "Join Slack",
};

export const signOff = "Plain English. Real browser. Pass or fail. Ship in a week.";

// ── Launch buzz guide (/online/start) ────────────────────────────────────────

/** Step 2 on /online/start: have these accounts ready before launch day. */
export const socialAccounts = {
  intro: "You'll post your project on these, so set them up now. If you don't have one yet, this is the best time to register: new accounts get filtered, and a week of real activity fixes that before launch day.",
  items: [
    { icon: "x", name: "X (Twitter)", href: "https://x.com/i/flow/signup", cta: "Create an X account", body: "Then follow @kane_cli and @testmuai so you can tag them." },
    { icon: "linkedin", name: "LinkedIn", href: "https://www.linkedin.com/signup", cta: "Join LinkedIn", body: "Then follow the TestMu AI company page so the tag shows up when you type @." },
    { icon: "hackernews", name: "Hacker News", href: "https://news.ycombinator.com/login", cta: "Create an HN account", body: "Engage with other posts this week: read, upvote and leave thoughtful comments to earn karma. A brand-new account with no karma gets little reach on a Show HN." },
    { icon: "reddit", name: "Reddit", href: "https://www.reddit.com/register/", cta: "Sign up for Reddit", body: "Join the subreddits you'll post in and comment there first. Most filter posts from accounts with no karma." },
    { icon: "youtube", name: "YouTube", href: "https://www.youtube.com/account", cta: "Set up a YouTube channel", body: "Your demo video must be hosted on YouTube. Set it to Unlisted or Public, never Private." },
  ],
} as const;

export const launchGuide = {
  intro: "Posting about your project is part of the submission: at least two public posts are required. Every extra post, and the reach and engagement it gets, earns brownie points on top of your score.",
  tips: [
    { title: "Post at least twice. More is better", body: "Two public posts are required to submit. One post at kickoff, one mid-week with progress, one at launch with your demo video. Multiple posts are recommended and each one counts." },
    { title: "Show, don't tell", body: "Lead with the demo video or a GIF of Kane catching the bug. Say what you built, which agent you used, and what Kane verified." },
    { title: "Add the hashtags and tag us", body: "So we can find, count and amplify your posts. Each platform has its own, listed below." },
  ],
  /** Per platform: where to post, which hashtags fit there, and who to tag. */
  platforms: [
    {
      label: "X (Twitter)",
      href: "https://x.com/compose/post",
      hashtags: ["#KaneCLIHackathon", "#KaneCLI"],
      tag: "@kane_cli",
      tagHref: "https://x.com/kane_cli",
      tagNote: "and @testmuai",
      note: "Two hashtags at most, in the last post. Don't start a post with an @mention: it cuts reach. Tag the Kane CLI account, x.com/kane_cli.",
    },
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/feed/",
      hashtags: ["#KaneCLIHackathon", "#KaneCLI", "#AIAgents"],
      tag: "@TestMu AI",
      tagHref: "https://www.linkedin.com/company/testmu-ai",
      tagNote: "Plus your teammates.",
      note: "Three hashtags at most, at the end. Type @ then TestMu AI and pick the page, or it won't become a tag. Upload the demo video natively.",
    },
    {
      label: "Hacker News",
      href: "https://news.ycombinator.com/submit",
      hashtags: [],
      tag: "No tags. Name Kane CLI in the text.",
      note: "Title starts with “Show HN:”. Link your repo or demo. Write it in your own words from your own account, and reply to every comment.",
    },
    {
      label: "Reddit",
      href: "https://www.reddit.com/submit",
      hashtags: [],
      tag: "No tags. Name Kane CLI and the hackathon in the post.",
      note: "No hashtags on Reddit. Post in r/SideProject, r/webdev or r/programming, use the right flair, and read each subreddit's rules first.",
    },
  ],
  // Shapes taken from the SF Hack Day launch kit (X thread, LinkedIn post, Show HN).
  samples: [
    {
      label: "X · kickoff post",
      note: "Day one. One post, no thread.",
      text: "I'm building [what you're building] this week for the KaneCLI Online Hackathon.\n\n[Your agent] writes the code. Kane CLI checks it in a real browser, so the agent sees its own failures.\n\nPosting progress here all week. Tested with @kane_cli from @testmuai.\n\n#KaneCLIHackathon #KaneCLI",
    },
    {
      label: "X · launch thread",
      note: "4 to 6 posts, each under 280 characters. Links only in the first and last post. Attach the demo video to post 1.",
      text: "1/ We built [Project]: [what it does in 8 words].\n\nBuilt with [your agent], tested with @kane_cli from @testmuai. Demo and code:\n[showcase page link]\n\n2/ The problem: [one concrete scenario you've lived. Who hits it, what breaks].\n\n3/ The Kane CLI moment: we asked it to \`[the objective you ran]\`. It failed on [step]. The screenshot showed [what]. We changed [fix]. It passed.\n\n4/ The build: [your agent] did [what]. One tradeoff: [tradeoff].\n\n5/ Built by [@teammate handles]. Thanks @kane_cli and @testmuai for the week. Repo: [GitHub link]\n\n#KaneCLIHackathon #KaneCLI",
    },
    {
      label: "LinkedIn · launch post",
      note: "1,100 to 1,600 characters. The first two lines show before \u201csee more\u201d, so the hook must stand alone. The @TestMu AI and @teammate tags only work if you retype the @ and pick each one from the dropdown.",
      text: "[Hook: what you built and the one surprising fact. No \"excited to share\".]\n\n[Context: a one-week online hackathon, who you built with.]\n\n[The build: what your agent did, in plain words.]\n\n[The test loop: what Kane CLI ran, what failed, what you fixed, that it passed.]\n\n[What you learned: one honest take.]\n\nShowcase page: [link]\nRepo: [GitHub link]\n\nBuilt with @[teammate names], tested with Kane CLI from @TestMu AI.\n\n#KaneCLIHackathon #KaneCLI #AIAgents",
    },
    {
      label: "Hacker News · Show HN",
      note: "A title, a link to your repo or live demo, then a first comment you write yourself. HN flags pasted, generated text, so use these as facts, not sentences.",
      text: "Title (under 80 characters, no hype):\nShow HN: [Name] - [what it does, in plain words]\n\nFacts for your first comment (150 to 300 words, your own words):\n- Why you built it: [your reason]\n- How it works: [your agent] does [role]; Kane CLI checks [flows]\n- What Kane CLI caught: [what it ran, where it failed, the fix]\n- Rough edges: [two or three honest items]\n- Question for the thread: [something specific]\n\nNo hashtags, no handles, no \"please upvote\". Stay to answer for the first few hours.",
    },
    {
      label: "Reddit",
      note: "Plain and specific. No hashtags. Read the subreddit's rules on self-promotion first.",
      text: "I built [project name] in a week: [what it does]\n\nStack: [your agent] for the code, Kane CLI for testing it in a real browser. The interesting part was [the loop / the bug Kane caught].\n\nWhat's rough: [one honest limitation].\n\nDemo video: [YouTube link]\nCode: [GitHub link]\n\nHappy to answer questions about how the agent and Kane CLI work together.",
    },
  ],
};
