import "server-only";
import { resolveMx } from "node:dns/promises";

// Catches the email mistakes that would make a participant unreachable:
// common domain typos, and domains that can't receive mail at all.

const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmaill.com": "gmail.com", "gamil.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmal.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.con": "outlook.com",
  "iclod.com": "icloud.com", "icloud.con": "icloud.com", "protonmail.con": "protonmail.com",
};

/** A message to show the person, or null when the address looks deliverable. */
export async function emailProblem(email: string): Promise<string | null> {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "Enter a valid email.";
  if (TYPOS[domain]) return `Did you mean ${local}@${TYPOS[domain]}? Check the spelling of your email.`;
  if (/\.(con|cmo|vom|xom|comm)$/.test(domain)) return "Check the ending of your email address.";
  // Reserved test domains have no mail servers; let them through on a dev machine only.
  if (process.env.NODE_ENV !== "production" && /\.(test|example|localhost)$/.test(domain)) return null;
  try {
    const mx = await Promise.race([resolveMx(domain), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    // A timeout proves nothing, so allow it; an answer with no mail servers is a real problem.
    if (mx !== null && mx.length === 0) return `${domain} can't receive email. Check your address.`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return `${domain} doesn't exist or can't receive email. Check your address.`;
  }
  return null;
}
