// The /activate checklist: copy and links in one place.
//
// Step 3: the OpenAI Codex coupon is emailed to the address the person registered with;
// the page says so and the person ticks it themselves.
// The TestMu AI plan is claimed server-side (src/server/event-activation.ts) with the
// password the person types; the same call creates the account, so it ticks step 1 too.
// Step 2 asks for the kaneclihack.sh password, so a new TestMu AI account gets the same one:
// captains add teammates on TestMu AI with it, and organizers tell them it's that password.

export type ActivationStepId = "testmu_signup" | "testmu_plan" | "codex_credits";

export const TESTMU_SIGNUP_URL = "https://www.testmuai.com";

/** Step 3 on /activate: where the coupon goes and what to do with it. */
export const CODEX_BY_EMAIL = (email: string) =>
  `Your OpenAI Codex coupon comes by email to ${email}. Open that email, redeem the coupon on OpenAI, then tick Credits enabled. Nothing after a while? Check spam, then ask at the help desk.`;

/** True while a value above is still a placeholder (the UI then hides a dead link). */
export const isPlaceholder = (s: string) => /^\[[A-Z_]+\]/.test(s);

export const ACTIVATION_STEPS: { id: ActivationStepId; n: string; title: string; body: string }[] = [
  {
    id: "testmu_signup",
    n: "01",
    title: "Register / log in with TestMu AI",
    body: "No TestMu AI account yet? Step 2 creates one for the email you registered here, with your kaneclihack.sh password. Already have one? Step 2 uses its password. Either way, step 2 ticks this for you. If step 2 isn’t working, create your account on TestMu AI with the same password you use here, tick this yourself and carry on to the Codex credits.",
  },
  {
    id: "testmu_plan",
    n: "02",
    title: "Activate your TestMu AI plan",
    body: "Enter your kaneclihack.sh password and press Activate. New to TestMu AI? We create your account with that same password, so one password works for both. Already had a TestMu AI account before today? Enter that account’s password instead. Either way the hack-day plan switches on. The password goes straight to TestMu AI; we never store it.",
  },
  {
    id: "codex_credits",
    n: "03",
    title: "Enable your OpenAI Codex credits ($250)",
    body: "Your personal OpenAI Codex coupon arrives by email at the address you registered with. Redeem it, then tick Credits enabled. One coupon per person; keep it to yourself.",
  },
];

/** TestMu AI's own password reset (accounts.lambdatest.com is TestMu AI's sign-in). Also how a Google or GitHub sign-up gets a password. */
export const TESTMU_PASSWORD_RESET_URL = "https://accounts.lambdatest.com/password/reset";

export const PLAN_MESSAGES = {
  claimed: "Plan activated.",
  notRegistered: (email: string) => `You’re not signed up on TestMu AI yet. Sign up with ${email}: your hack-day plan is saved and switches on as soon as you do. Then press Check again.`,
  error: "Something went wrong activating your plan. Please reach out to the support staff at the help desk (or /help).",
  wrongPassword: `That email already has a TestMu AI account with a different password. Use that account’s password. Signed up there with Google or GitHub (no password yet), or don’t remember it? Set a new one at ${TESTMU_PASSWORD_RESET_URL} with the same email, then try again with it.`,
  invalid: (fields: string[]) => (fields.length ? `TestMu AI didn’t accept that: ${fields.join(" ")}` : "TestMu AI didn’t accept that. Check your password and try again."),
  ineligible: "TestMu AI says this account can’t take the hack-day plan (it may be suspended, or the email matches another account). Please ask at the help desk.",
  region: "TestMu AI couldn’t activate the plan from this region. Please ask at the help desk.",
  ended: "The hack-day TestMu AI offer has ended.",
  retry: "TestMu AI couldn’t activate your plan just now. Wait a minute and try again; if it keeps failing, ask at the help desk.",
  rateLimited: "TestMu AI had too many tries in a short time. Wait a minute, then try again with your TestMu AI password (forgot it? reset it on testmuai.com).",
  alreadyActive: "Your TestMu AI account already has an active plan or trial, so no hack-day trial was added. If Kane CLI says you have no seats, ask at the help desk.",
  passwordLength: "The password needs at least 8 characters (and at most 255).",
  outOfCodes: "We’re out of codes right now. Please reach out to the support staff at the help desk.",
} as const;
