// What a submission needs, shared by the form (checked in the browser before
// anything is sent) and the server action (checked again, always).
import { checkPosts, normalizeUrl } from "./links";

export const MIN_POSTS = 2;

export const REQUIRED_FIELDS = [
  ["project_name", "Project name"],
  ["one_line_pitch", "One-liner"],
  ["project_description", "Project details"],
  ["agent_used", "Agent used"],
  ["video_url", "YouTube demo video"],
  ["repo_url", "GitHub URL"],
] as const;

type Values = Record<string, string | null | undefined>;
export type Issue = { path: string; message: string };

const hostIs = (url: string, re: RegExp) => re.test(new URL(url).hostname.toLowerCase());

/** Wrong-looking links, whether saving a draft or submitting. */
export function formatIssues(v: Values): Issue[] {
  const issues: Issue[] = [];
  const url = (k: string, label: string, check?: (u: string) => string | null) => {
    const raw = (v[k] ?? "").trim();
    if (!raw) return;
    const u = normalizeUrl(raw);
    const problem = !u ? `${label} isn't a link.` : (check?.(u) ?? null);
    if (problem) issues.push({ path: k, message: problem });
  };
  url("repo_url", "GitHub URL", (u) => (hostIs(u, /^(www\.)?github\.com$/) && /^\/[^/]+\/[^/]+/.test(new URL(u).pathname) ? null : "Use your repo's link: github.com/owner/repo."));
  url("video_url", "YouTube demo video", (u) => (hostIs(u, /(^|\.)youtube\.com$|^youtu\.be$/) ? null : "The demo video must be a YouTube link."));
  url("live_url", "Live URL");
  return [...issues, ...checkPosts(v).issues];
}

/** Empty required fields and too few posts, in the order they appear on the form. */
export function missingForSubmit(v: Values): Issue[] {
  const issues: Issue[] = REQUIRED_FIELDS.filter(([k]) => !(v[k] ?? "").trim()).map(([k, label]) => ({ path: k, message: `${label} is required` }));
  const posts = checkPosts(v).count;
  if (posts < MIN_POSTS) {
    issues.push({ path: "launch", message: posts === 0 ? `Add at least ${MIN_POSTS} posts about your project.` : `Add ${MIN_POSTS - posts} more post: at least ${MIN_POSTS} different posts are required.` });
  }
  return issues;
}
