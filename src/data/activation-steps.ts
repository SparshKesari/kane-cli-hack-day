// The /activate checklist: copy and links in one place.
//
// PLACEHOLDERS still to fill in before the event (search for "[" in this file):
//   CODEX_REDEEM_INSTRUCTIONS    generic until the organizer sends the real steps
//   [CODEX_REDEEM_URL]           where to redeem it
// The TestMu AI plan is claimed server-side (src/server/event-activation.ts) with the
// password the person types; the same call creates the account, so it ticks step 1 too.

export type ActivationStepId = "testmu_signup" | "testmu_plan" | "codex_credits";

export const TESTMU_SIGNUP_URL = "https://www.testmuai.com";

/** Shown under the Codex credit code once it is assigned. */
export const CODEX_REDEEM_INSTRUCTIONS = "Copy your code, open the redemption page, sign in to OpenAI, and paste the code.";
export const CODEX_REDEEM_URL = "[CODEX_REDEEM_URL]";

/** True while a value above is still a placeholder (the UI then hides a dead link). */
export const isPlaceholder = (s: string) => /^\[[A-Z_]+\]/.test(s);

export const ACTIVATION_STEPS: { id: ActivationStepId; n: string; title: string; body: string }[] = [
  {
    id: "testmu_signup",
    n: "01",
    title: "Register / log in with TestMu AI",
    body: "No TestMu AI account yet? Step 2 creates one for the email you registered here. Already have one? Step 2 uses its password. Either way, step 2 ticks this for you. If step 2 isn’t working, create your account on TestMu AI, tick this yourself and carry on to the Codex credits.",
  },
  {
    id: "testmu_plan",
    n: "02",
    title: "Activate your TestMu AI plan",
    body: "Enter your TestMu AI password and press Activate. New to TestMu AI? Choose a password (8+ characters) and we create your account. Either way the hack-day plan switches on. The password goes straight to TestMu AI; we never store it.",
  },
  {
    id: "codex_credits",
    n: "03",
    title: "Enable your OpenAI Codex credits ($250)",
    body: "Get your personal OpenAI Codex credit code, redeem it, then tick Done. One code per person; keep it to yourself.",
  },
];

export const PLAN_MESSAGES = {
  claimed: "Plan activated.",
  notRegistered: (email: string) => `You’re not signed up on TestMu AI yet. Sign up with ${email}: your hack-day plan is saved and switches on as soon as you do. Then press Check again.`,
  error: "Something went wrong activating your plan. Please reach out to the support staff at the help desk (or /help).",
  wrongPassword: "That email already has a TestMu AI account, and the password didn’t match. Use your TestMu AI password (forgot it? reset it on testmuai.com) and try again.",
  invalid: (fields: string[]) => (fields.length ? `TestMu AI didn’t accept that: ${fields.join(" ")}` : "TestMu AI didn’t accept that. Check your password and try again."),
  ineligible: "TestMu AI says this account can’t take the hack-day plan (it may be suspended, or the email matches another account). Please ask at the help desk.",
  region: "TestMu AI couldn’t activate the plan from this region. Please ask at the help desk.",
  ended: "The hack-day TestMu AI offer has ended.",
  retry: "TestMu AI couldn’t activate your plan just now. Wait a minute and try again; if it keeps failing, ask at the help desk.",
  rateLimited: "TestMu AI had too many tries in a short time. Wait a minute, then try again with your TestMu AI password (forgot it? reset it on testmuai.com).",
  alreadyActive: "Your TestMu AI account already has an active plan or trial, so no hack-day trial was added. If Kane CLI says you have no seats, ask at the help desk.",
  passwordLength: "Your TestMu AI password needs at least 8 characters (and at most 255).",
  outOfCodes: "We’re out of codes right now. Please reach out to the support staff at the help desk.",
} as const;
