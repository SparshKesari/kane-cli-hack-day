// All Hack Day copy lives here so it can be edited without touching layout.
// Anything in [square brackets] is a placeholder still to be filled in.

export type Link = { label: string; href: string };

export const event = {
  name: "Kane CLI Hack Day",
  city: "SF",
  supporter: "OpenAI",
  tagline: "Build with OpenAI. Test with Kane CLI. Ship by 6.",
  // ISO date of the event day; schedule times below are local to it.
  date: "2026-10-24",
  timezone: "America/Los_Angeles",
  hashtag: "#KaneCLIHackDay",
};

export const ctas = {
  register: { label: "Start here →", href: "/register" },
  login: { label: "Sign in", href: "/passport/login" },
} satisfies Record<string, Link>;

// ── Do this first ────────────────────────────────────────────────────────────

export const setupDeadline = "11:00";

export const setup: { id: string; title: string; body: string; value?: string; link?: Link }[] = [
  { id: "wifi", title: "Get online", body: "Join the venue WiFi.", value: "[network] / [password]" },
  {
    id: "sign-in",
    title: "Sign in to TestMu AI",
    body: "Use your registration email at testmuai.com. Your OpenAI credits and KaneAI Pro are matched by email.",
    link: { label: "testmuai.com", href: "https://www.testmuai.com" },
  },
  { id: "coupon", title: "Redeem your OpenAI coupon", body: "It comes by email to the address you registered with. Open it and follow its steps to add the credits to your OpenAI account." },
  {
    id: "install",
    title: "Set up your agent",
    body: "Install the kanehack helper and the hack-day skills, pair it with your passport, then connect Codex.",
    value: "curl -fsSL https://kaneclihack.sh/install.sh | sh\nkanehack pair",
    link: { label: "All steps, incl. Windows", href: "/setup" },
  },
  {
    id: "team",
    title: "Register your team",
    body: "Closes at 11:00. Solo builders register too.",
    link: { label: "Team form", href: "/submit#team" },
  },
];

// ── Schedule ─────────────────────────────────────────────────────────────────

export type Slot = {
  start: string; // "HH:MM", 24h
  end?: string;
  title: string;
  note?: string;
  /** A hard cut-off attendees must hit. */
  deadline?: boolean;
  href?: string;
  /** Shown on the public home page; the full day lives in the team hub. */
  key?: boolean;
};

export const schedule: Slot[] = [
  { start: "09:30", end: "10:15", title: "Arrival, breakfast", key: true },
  { start: "10:15", end: "11:00", title: "Kickoff", note: "Kane CLI x OpenAI loop demo", key: true },
  { start: "11:00", title: "Team registration closes. Hackathon begins", deadline: true, href: "/submit#team", key: true },
  { start: "12:00", title: "Idea submission locks", deadline: true, href: "/submit#idea" },
  { start: "13:00", end: "14:00", title: "Working lunch" },
  { start: "14:00", title: "Mid evaluation", note: "Feedback only", href: "/judging#mid" },
  { start: "16:00", end: "17:00", title: "Final evaluation at your table", note: "Scored", href: "/judging#final" },
  { start: "17:00", end: "18:00", title: "Content hour", note: "Submissions lock at 6:00", href: "/content-hour" },
  { start: "18:00", title: "Submissions lock", deadline: true, href: "/submit#final", key: true },
  { start: "18:00", end: "19:00", title: "Demo round", note: "Top 7 teams", href: "/judging#stage", key: true },
  { start: "19:30", title: "Prizes and closing", key: true },
];

export const onGroundHelp = "[name], [number]";

// ── Challenge ────────────────────────────────────────────────────────────────

export const challenge = {
  statement:
    "Build anything with an AI coding agent and OpenAI in the loop: a product, an agent, a plugin, a CI pipeline, or a validation harness itself. Run Kane CLI against it while you build. Demo it live.",
  barsIntro: "By 6:00 your project clears three bars.",
  bars: [
    {
      title: "It works end to end",
      body: "A user can load it, complete the main flow, and get a result.",
    },
    {
      title: "Kane caught or proved something",
      body: "A failed run that found a bug, or a green run across real flows.",
    },
    {
      title: "The agent and Kane talked",
      body: "At least once, an agent’s output triggered a Kane run, or a Kane result changed what the agent did.",
    },
  ],
  tracks: ["Web App", "Mobile App", "AI Agent and Voice", "Data and Dashboards", "Wildcard"],
  tracksNote: "Same rubric for every track.",
};

// The blueprint's challenge brief (BRIEF.md), for pages that want the longer
// framing. A standalone validation harness is a valid entry on its own.
export const brief = {
  headline: "Build anything. Engineer the confidence to ship it.",
  name: "The Kane CLI Agentic Shipping Challenge",
  intro:
    "AI agents have made creating software much faster. Shipping it faster takes more than writing code faster. Build anything with an AI coding agent, then use Kane CLI to design verification and shipping workflows that make delivery faster, more reliable and backed by evidence.",
  harnessNote: "You don't need to build a separate app. Your creation can be the assurance or validation system itself.",
  expectations: [
    { title: "Create a working deliverable", body: "A product, plugin, workflow or harness made with an AI coding agent." },
    { title: "Use Kane meaningfully", body: "Verify the behavior that matters, not one isolated test." },
    { title: "Close the feedback loop", body: "Let results drive diagnosis, fixes, regression runs, coverage or the release decision." },
    { title: "Show honest proof", body: "A real run against real or representative software, with reproducible evidence and its limits." },
  ],
  closer: "Build fast. Validate intelligently. Ship with proof.",
  mediaNote: "Ship Page, deck and video are optional support. A media render failure never disqualifies a valid entry.",
};

// ── Assurance loop ───────────────────────────────────────────────────────────

export type LoopActor = "codex" | "kane";
export type AcState = "untested" | "proven" | "failing" | "blocked";

export const loop = {
  summary:
    "Kane sits between your agent and your app. The agent writes code, Kane runs the flows in a real browser or device, the result goes back to the agent, the agent fixes and reruns. Nothing ships on the agent’s word alone.",
  // The requirement the demo works from, and its acceptance criteria.
  requirement: "PRD · checkout.md",
  criteria: ["Add an item to the cart", "Cart total updates", "Pay with a test card", "Order confirmation shows"],
  // One beat per step. `hop` is who talks to whom; `ac` is each criterion's state after the step.
  story: [
    {
      title: "Codex builds",
      round: 1,
      caption: "You ask Codex for a feature. It writes the code and your app changes.",
      hop: { from: "codex", to: "app", label: "edits code" },
      codex: ['› codex "add a checkout flow"', "✎ app/checkout.tsx  +84"],
      kane: [],
      app: "built",
      ac: ["untested", "untested", "untested", "untested"],
    },
    {
      title: "Codex calls Kane",
      round: 1,
      caption: "Codex doesn’t mark its own homework. It calls Kane CLI to check the change.",
      hop: { from: "codex", to: "kane", label: "calls kane-cli" },
      codex: ['› codex "add a checkout flow"', "✎ app/checkout.tsx  +84", "⏵ kane-cli testmd run checkout_test.md"],
      kane: ["kane-cli · 4 criteria from checkout.md"],
      app: "built",
      ac: ["untested", "untested", "untested", "untested"],
    },
    {
      title: "Kane drives the app",
      round: 1,
      caption: "Kane runs the real flows in a browser, step by step, against the requirement.",
      hop: { from: "kane", to: "app", label: "drives real browser" },
      codex: ['› codex "add a checkout flow"', "✎ app/checkout.tsx  +84", "⏵ kane-cli testmd run checkout_test.md"],
      kane: ["kane-cli · 4 criteria from checkout.md", "✓ add item to cart", "✗ cart total stayed $0"],
      app: "bug",
      ac: ["proven", "failing", "blocked", "blocked"],
    },
    {
      title: "Verdict goes back",
      round: 1,
      caption: "Kane seals the run as evidence and hands Codex a verdict with a root-cause fix prompt.",
      hop: { from: "kane", to: "codex", label: "verdict + fix prompt" },
      codex: ["← verdict  1/4 proven", "← fix prompt: total reads stale cart state"],
      kane: ["✗ cart total stayed $0", "sealed  run-4821.evidence", "root cause → fix prompt"],
      app: "bug",
      ac: ["proven", "failing", "blocked", "blocked"],
    },
    {
      title: "Codex fixes",
      round: 2,
      caption: "Codex reads the evidence, fixes the cause, and calls Kane again.",
      hop: { from: "codex", to: "app", label: "fixes code" },
      codex: ["← fix prompt: total reads stale cart state", "✎ app/cart.ts  fix total selector", "⏵ kane-cli testmd run checkout_test.md"],
      kane: ["sealed  run-4821.evidence"],
      app: "fixed",
      ac: ["proven", "failing", "blocked", "blocked"],
    },
    {
      title: "Kane proves it",
      round: 2,
      caption: "Kane reruns every flow. All four criteria pass, with evidence for each.",
      hop: { from: "kane", to: "app", label: "reruns flows" },
      codex: ["✎ app/cart.ts  fix total selector", "⏵ kane-cli testmd run checkout_test.md"],
      kane: ["✓ add item to cart", "✓ cart total updates", "✓ pay with a test card", "✓ order confirmation shows"],
      app: "done",
      ac: ["proven", "proven", "proven", "proven"],
    },
    {
      title: "Ship it",
      round: 2,
      caption: "4/4 proven, sealed as evidence. Now it ships, not on the agent’s word alone.",
      hop: { from: "kane", to: "codex", label: "4/4 proven" },
      codex: ["← verdict  4/4 proven", "✓ verified by kane-cli, ready to ship"],
      kane: ["✓ order confirmation shows", "sealed  run-4822.evidence", "coverage  4/4 proven"],
      app: "done",
      ac: ["proven", "proven", "proven", "proven"],
    },
  ] as {
    title: string;
    /** Which pass through the loop this beat belongs to. */
    round: number;
    caption: string;
    hop: { from: LoopActor | "app"; to: LoopActor | "app"; label: string };
    codex: string[];
    kane: string[];
    app: "built" | "bug" | "fixed" | "done";
    ac: AcState[];
  }[],
  links: [
    { label: "How it works", href: "[doc link]" },
    { label: "Wiring it with OpenAI", href: "[sample repo or guide]" },
    { label: "Three-minute walkthrough", href: "[link]" },
  ] satisfies Link[],
};

// ── Prizes ───────────────────────────────────────────────────────────────────

export const prizes = {
  // `art` is the halftone image in /public/halftone/<art>/; photo credits live in src/data/art.ts.
  podium: [
    { place: "1st", prize: "Apple Vision Pro", credits: "$3,000 OpenAI credits", art: "visionpro" },
    { place: "2nd", prize: "Mac mini", credits: "$2,000 OpenAI credits", art: "macmini" },
    { place: "3rd", prize: "iPad Air", credits: "$1,000 OpenAI credits", art: "ipad" },
  ] as const,
  podiumNote: "Top 3 from the stage round.",
  shipped: { title: "Shipped prize", rule: "First 25 complete bundles by 6:00", prize: "[prize]" },
  everyone: { title: "Every builder", prize: "3 months KaneAI Pro + $250 OpenAI credits" },
};

// ── Rules ────────────────────────────────────────────────────────────────────

export const rules: { title: string; body: string; link?: Link }[] = [
  { title: "Team size", body: "Solo, or teams of up to 4." },
  {
    title: "Fresh code",
    body: "Code written today. Templates, boilerplates and libraries are fine. Pre-built projects are not.",
  },
  { title: "Both tools", body: "OpenAI and Kane CLI are both required. Use only one and you cannot place." },
  { title: "One entry", body: "One submission per team, finalized in your team hub. The Kane CLI run report is mandatory." },
  { title: "Any stack", body: "Any stack, any framework, any deployment." },
  { title: "Code of conduct", body: "Be kind, be safe.", link: { label: "Read it", href: "[link]" } },
];

// ── Submissions ──────────────────────────────────────────────────────────────

export const submissions = {
  team: {
    deadline: "11:00",
    form: { label: "Register your team", href: "/register" },
    needs: ["Team name", "Members and emails", "Track", "One-line idea"],
    solo: "Solo? Come to speed matching at the front of the room, 10:45.",
  },
  idea: {
    deadline: "12:00",
    // D2: the team hub is the official record (key name kept for callers).
    devpost: { label: "Save your idea in the team hub", href: "/login?next=idea" },
    needs: ["Title", "Track", "Two sentences on what it does", "What Kane will verify"],
    note: "You can edit everything later. Mentors use this to find you, so be specific.",
  },
  final: {
    deadline: "18:00",
    devpost: { label: "Finalize on your Submit tab", href: "/login?next=submit" },
    minimum: ["Repo", "Live URL or run command", "Kane CLI run report"],
    pickTwo: ["Video", "Blog", "X post", "HN post"],
    minimumNote: "Minimum for the shipped prize: the three essentials, plus any two content pieces, all live by 6:00.",
    fullBundle: "Full bundle: all four content pieces.",
    closing: "Submissions lock at 6:00 by the server clock. No exceptions.",
  },
};

// ── Evaluations & judging ────────────────────────────────────────────────────

export const evaluations = {
  mid: {
    time: "2:00",
    title: "Mid evaluation",
    scored: false,
    body: "Mentors visit every table. Nothing is scored. Fix what they flag.",
    checks: ["A clear idea", "OpenAI in the loop", "Kane CLI run at least once"],
  },
  final: {
    time: "4:00 – 5:00",
    title: "Final evaluation",
    scored: true,
    body: "Judges visit every table and score on the rubric. Keep building, and have one person ready for a 2-minute walkthrough.",
    checks: ["Decides the top 7 for the stage", "No team is eliminated", "Everyone continues to content hour"],
  },
};

// The published judging rubric: three gates, four criteria at 25 each. The
// homepage fold shows it in full; `judging.rubric` below is built from it, so
// the judge scorecard scores exactly what participants read.
export const judgingCriteria = {
  intro:
    "Four criteria, 25 points each, 100 total. Every track is scored on the same rubric. Judges score at your table in the final evaluation round and again on stage for the top seven. GTM is scored from the links in your submission after submissions lock.",
  gates: {
    title: "Before scoring, three gates",
    items: ["Code written today, repo public", "OpenAI used in the build", "Kane CLI evidence pack attached to your submission"],
    note: "Miss a gate and you still demo and get feedback, but you cannot place.",
  },
  criteria: [
    {
      n: "01",
      key: "kane_usage",
      label: "Kane usage",
      title: "Kane CLI usage and uniqueness of usage",
      points: 25,
      lead: "Kane doing real work in your project, not a check added at the end.",
      parts: [
        { name: "Proof, not presence", points: 8, body: "A failed run that found a bug plus the green rerun, or a green run across the real user journey. One login check scores low." },
        { name: "Agent and Kane talked", points: 9, body: "Your coding agent ran Kane (skill or --agent), read the result, and changed what it did next. Visible in commits or run history." },
        {
          name: "Range",
          points: 8,
          body: "Credit for going past kane-cli run: tests as _test.md committed and replayed, generate or the assurance loop (ingest a spec, design tests, cover), exploration, mobile, API calls inside an objective, DevTools assertions, CI, or Kane used as part of the product itself (a gate, a grader, the eyes of another agent).",
        },
      ],
    },
    {
      n: "02",
      key: "idea",
      label: "Idea",
      title: "Uniqueness of idea",
      points: 25,
      parts: [
        { name: "Problem is real and nameable", points: 7, body: "Who has it, why it hurts, in one sentence." },
        { name: "Originality", points: 10, body: "Judged against the room and what already ships. A new angle on a known problem sits mid-band." },
        { name: "Needs verification", points: 8, body: "Ideas where an untested agent would plausibly ship something broken, and Kane makes that visible, score highest. Testing that is decorative scores low." },
      ],
    },
    {
      n: "03",
      key: "completion",
      label: "Completion",
      title: "Completion",
      points: 25,
      parts: [
        { name: "Works live, end to end", points: 12, body: "A user loads it, completes the main flow, gets a result. Video-only or slides-only caps at 4." },
        { name: "Scope honesty", points: 6, body: "What you claimed matches what runs." },
        { name: "Repo quality", points: 7, body: "README with a run command, someone could clone it tonight, tests and evidence pack in the repo." },
      ],
    },
  ],
  gtm: {
    n: "04",
    key: "gtm",
    label: "GTM",
    title: "GTM",
    points: 25,
    when: "Scored from your submission links after lock",
    lead: "Points are earned per asset. Each must be live and linked in your submission.",
    assets: [
      { asset: "Demo video with voiceover", points: 7, full: "2 to 4 minutes, leads with the Kane run report, shows one real flow, says what Kane caught. Voiceover required, editing not." },
      { asset: "Deck", points: 4, full: "Problem, build, Kane in the loop, demo, what is next. Hosted or shared link." },
      { asset: "Blog post", points: 4, full: "Explains the problem, the build, and what Kane caught, with the evidence pack or run screenshots. dev.to, Medium, Hashnode or your own site." },
      { asset: "LinkedIn post", points: 3, full: "Tags the official TestMu AI LinkedIn page and uses the event hashtag. Multiple posts welcome; share every link, the best one is scored." },
      { asset: "X post", points: 3, full: "Tags @kane_cli and uses the event hashtag. Threads count as one post; share every link." },
      { asset: "Hacker News post", points: 2, full: "Show HN in your own words from your own account, links to your repo or demo. A flagged post still earns the points if the link is shared." },
      { asset: "Reach bonus", points: 2, full: "Any reply, repost or comment from outside your team on any of the above by the time judges review." },
    ],
  },
};

export const judging = {
  shortlist: "Top 7 from the 4:00 scores, confirmed against the finalized submissions at 6:00.",
  stage: { demo: "3-minute demo", qa: "2 minutes of questions" },
  // `key` is what judge_scores.category_scores stores; `label` is short enough
  // for the Themis scale; `inspect` lists the weighted parts judges look for.
  // @2 is the 4 × 25 rubric (judgingCriteria); @1 was EVALUATION.md's 30/25/20/15/10.
  rubricVersion: "kane-hack-os-eval@2",
  rubric: [
    ...judgingCriteria.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      name: c.title,
      points: c.points,
      inspect: c.parts.map((p) => `${p.name} (${p.points})`).join(" · "),
    })),
    {
      key: judgingCriteria.gtm.key,
      label: judgingCriteria.gtm.label,
      name: judgingCriteria.gtm.title,
      points: judgingCriteria.gtm.points,
      inspect: `${judgingCriteria.gtm.when}, per asset: ` + judgingCriteria.gtm.assets.map((a) => `${a.asset} (${a.points})`).join(" · "),
    },
  ],
  // Each category gets one anchor; points = anchor × weight / 5.
  anchors: [
    { score: 0, label: "Absent" },
    { score: 1, label: "Incomplete" },
    { score: 2, label: "Weak" },
    { score: 3, label: "Credible" },
    { score: 4, label: "Strong" },
    { score: 5, label: "Exceptional" },
  ],
  scoringNote:
    "Each category gets an anchor from 0 to 5, worth anchor × weight / 5 points. Judges cite evidence or say what they couldn't verify. Scores are human decisions; AI never fills in a mark.",
  eligibilityNote:
    "Harnesses, CI pipelines, extensions, plugins and workflows compete on the same rubric as apps. Commit counts, run counts and number of Kane components are not multipliers.",
  demoChecklist: [
    "What is built",
    "The actual harness architecture",
    "A witnessed Kane verification and its evidence",
    "How it responds to a failure or gap",
    "The claimed impact and the measurement behind it",
  ],
  shippedNote: "Shipped prize: complete bundle, no scoring.",
  judges: [
    {
      name: "Mayank Bhola",
      role: "Co-Founder and Head of Products, TestMu AI",
      photo: "/judges/mayank-bhola.jpg",
      linkedin: "https://www.linkedin.com/in/mayankbhola/",
      x: "https://x.com/Mayankbhola",
    },
    {
      name: "Anurag Sharma",
      role: "Senior Vice President of Engineering, TestMu AI",
      photo: "/judges/anurag-sharma.jpg",
      linkedin: "https://www.linkedin.com/in/anurag-sharma-xyz-abc/",
    },
  ] as { name: string; role: string; photo?: string; linkedin?: string; x?: string }[],
};

// ── Content hour ─────────────────────────────────────────────────────────────

export const contentHour = {
  intro:
    "The top 7 are being decided from the 4:00 round. This hour is for shipping and telling people. Templates and prompts for each step are in Resources.",
  steps: [
    { minutes: 10, title: "Record the video", href: "/resources#recording" },
    { minutes: 15, title: "Generate the blog from your run report", href: "/resources#content-skills" },
    { minutes: 5, title: "Thread from the blog", href: "/resources#content-skills" },
    { minutes: 5, title: "Post to Hacker News", href: "/resources#content-skills" },
    { minutes: 15, title: "Finalize your submission", href: "/submit#final" },
  ],
};

// ── Resources ────────────────────────────────────────────────────────────────

export type ResourceGroup = { id: string; title: string; blurb: string; items: { label: string; body?: string; href?: string }[] };

export const resources: ResourceGroup[] = [
  {
    id: "kane-cli",
    title: "Kane CLI",
    blurb: "Install it, write tests in plain English, read the run report.",
    items: [
      { label: "Quickstart", href: "[link]" },
      { label: "Writing tests in plain English", href: "[link]" },
      { label: "Run reports", href: "[link]" },
      { label: "Agent and CI integration", href: "[link]" },
      { label: "Starter repo", href: "[link]" },
    ],
  },
  {
    id: "assurance-loop",
    title: "The Assurance loop",
    blurb: "How Kane closes the loop between your agent and your app.",
    items: [
      { label: "How it works", href: "[doc link]" },
      { label: "Wiring it with OpenAI", href: "[sample repo or guide]" },
      { label: "Three-minute walkthrough video", href: "[link]" },
    ],
  },
  {
    id: "openai",
    title: "OpenAI",
    blurb: "APIs, models on your credits, and the Agents SDK.",
    items: [
      { label: "API quickstart", href: "[link]" },
      { label: "Models covered by your credits", body: "[list]" },
      { label: "Agents SDK", href: "[link]" },
    ],
  },
  {
    id: "build-ideas",
    title: "Build ideas",
    blurb: "Stuck? Each prompt is “build X, Kane verifies Y”.",
    items: [
      { label: "Web App", body: "Build [X], Kane verifies [Y]" },
      { label: "Mobile App", body: "Build [X], Kane verifies [Y]" },
      { label: "AI Agent and Voice", body: "Build [X], Kane verifies [Y]" },
      { label: "Data and Dashboards", body: "Build [X], Kane verifies [Y]" },
      { label: "Wildcard", body: "Build [X], Kane verifies [Y]" },
      { label: "Wildcard", body: "Build [X], Kane verifies [Y]" },
    ],
  },
  {
    id: "content-skills",
    title: "Content skills",
    blurb: "A prompt pack to drop into your agent.",
    items: [
      { label: "Video", body: "Script and shot list from your submission description." },
      { label: "Blog", body: "First draft from your run report and commit log." },
      { label: "X thread", body: "Launch tweet plus a 3-tweet thread from the blog." },
      {
        label: "Hacker News",
        body: "Show HN title formula and guidance. Post from your own account, in your own words; HN flags generated text.",
      },
      { label: "Marketing assets", body: "Logo and hero image prompt, screenshot-to-social-card prompt, one-line pitch prompt." },
      { label: "Demo deck", body: "10-slide template plus the prompt that fills it from your submission." },
      { label: "Download the pack", href: "[link]" },
    ],
  },
  {
    id: "recording",
    title: "Recording and demo",
    blurb: "Get the video and the stage demo right.",
    items: [
      { label: "Screen recording", body: "Loom or QuickTime, 2 to 4 minutes, no editing needed." },
      { label: "Video structure", body: "Problem, build, Kane in the loop with the run report on screen, demo." },
      { label: "Title format", body: "[Project] | Kane CLI Hack Day SF" },
      { label: "Stage demo tips", body: "Lead with the run report, show one real flow, end on what Kane caught." },
    ],
  },
];

// ── Help ───────────────────────────────────────────────────────────────────

export const mentors: { name: string; role: string; photo: string; linkedin?: string; x?: string }[] = [
  {
    name: "Sparsh Kesari",
    role: "Developer Relations Manager, TestMu AI",
    photo: "/mentors/sparsh-kesari.jpg",
    linkedin: "https://www.linkedin.com/in/sparshk98/",
    x: "https://x.com/sparsh_kesari_",
  },
  {
    name: "Siddhant Sinha",
    role: "Lead Member, Technical Staff, TestMu AI",
    photo: "/mentors/siddhant-sinha.jpg",
    linkedin: "https://www.linkedin.com/in/sid573/",
    x: "https://x.com/siddhantcx",
  },
  {
    name: "Shravan Mahajan",
    role: "Software Engineer, TestMu AI",
    photo: "/mentors/shravan-mahajan.jpg",
    linkedin: "https://www.linkedin.com/in/shvn/",
    x: "https://x.com/shvnmahajan",
  },
];

