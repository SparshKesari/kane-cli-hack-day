// Checks for the /register profile form, shared by the browser (instant, per
// field) and the server (the final word), so both show the same messages.

const LINKEDIN = /^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:in|company)\/[\w\-%.]+\/?(?:[?#].*)?$|^in\/[\w\-%.]+\/?$|^@?[\w\-%.]{3,100}$/i;
const X = /^@?\w{1,15}$|^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/@?\w{1,15}\/?(?:[?#].*)?$/i;
const GITHUB = /^@?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "https://github.com/riya-dev/" → "riya-dev". Anything else is returned trimmed. */
export const githubFromInput = (s: string) => s.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/\/+$/, "");

export type ProfileFieldValues = { name?: string; email?: string; linkedin?: string; x?: string; github?: string; password?: string };

/** Field name → what to fix, in plain words. Empty when everything is fine. */
export function checkProfileFields(v: ProfileFieldValues, opts: { passwordRequired: boolean }): Record<string, string> {
  const e: Record<string, string> = {};
  const name = (v.name ?? "").trim();
  if (!name) e.name = "Add your name.";
  else if (name.length < 2) e.name = "Your name needs at least 2 letters.";
  else if (name.length > 60) e.name = "Keep your name under 60 characters.";

  const email = (v.email ?? "").trim();
  if (!email) e.email = "Add the email you used on Luma.";
  else if (!EMAIL.test(email)) e.email = "That email doesn’t look right. Check for a missing @ or a typo like .con.";

  const li = (v.linkedin ?? "").trim();
  if (!li) e.linkedin = "Add your LinkedIn profile link.";
  else if (!LINKEDIN.test(li)) e.linkedin = "Paste your profile link (linkedin.com/in/your-name) or just the name after /in/, with no spaces.";

  const x = (v.x ?? "").trim();
  if (x && !X.test(x)) e.x = "Use your handle (@riya_dev) or profile link (x.com/riya_dev): letters, numbers and _ only, up to 15 characters.";

  const gh = githubFromInput(v.github ?? "");
  if (gh && !GITHUB.test(gh)) e.github = "Use your GitHub username (riya-dev) or profile link (github.com/riya-dev): letters, numbers and dashes, no spaces or commas.";

  const pw = v.password ?? "";
  if (!pw && opts.passwordRequired) e.password = "Choose a password with at least 8 characters.";
  else if (pw && pw.length < 8) e.password = `Your password needs at least 8 characters (it has ${pw.length}).`;
  return e;
}
