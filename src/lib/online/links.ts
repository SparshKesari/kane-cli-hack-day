// Launch-post links. Client-safe: the form and the server both use it.
// A field takes several links separated by commas (or spaces / new lines),
// with or without http(s)://. Each must be on that platform's own domain.

export const PLATFORMS = {
  hn_url: { label: "Hacker News", hosts: ["news.ycombinator.com"], example: "news.ycombinator.com/item?id=…" },
  x_url: { label: "X", hosts: ["x.com", "twitter.com"], example: "x.com/you/status/…" },
  reddit_url: { label: "Reddit", hosts: ["reddit.com", "redd.it"], example: "reddit.com/r/…/comments/…" },
  linkedin_url: { label: "LinkedIn", hosts: ["linkedin.com", "lnkd.in"], example: "linkedin.com/posts/…" },
} as const;
export type PlatformField = keyof typeof PLATFORMS;
export const PLATFORM_FIELDS = Object.keys(PLATFORMS) as PlatformField[];

/** Splits on commas, spaces and new lines. */
export const splitLinks = (raw: string | null | undefined) => (raw ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

/** Adds https:// when missing; null if it still isn't a link with a real host. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, "");
const onHost = (url: string, hosts: readonly string[]) => hosts.some((h) => hostOf(url) === h || hostOf(url).endsWith(`.${h}`));
/** Same post, whatever the scheme, www, trailing slash or tracking query. */
export const postKey = (url: string) => {
  const u = new URL(url);
  const keep = hostOf(url) === "news.ycombinator.com" ? u.search : "";
  return `${hostOf(url)}${u.pathname.replace(/\/+$/, "")}${keep}`.toLowerCase();
};

export type LinkIssue = { path: string; message: string };

/**
 * Cleans every post field. Returns the normalized values (links joined with
 * ", "), the number of distinct posts, and what's wrong.
 */
export function checkPosts(values: Record<string, string | null | undefined>) {
  const issues: LinkIssue[] = [];
  const clean: Record<string, string | null> = {};
  const seen = new Set<string>();
  let count = 0;

  const take = (field: string, label: string, hosts: readonly string[] | null) => {
    const out: string[] = [];
    for (const raw of splitLinks(values[field])) {
      const url = normalizeUrl(raw);
      if (!url) {
        issues.push({ path: field, message: `"${raw}" isn't a link.` });
        continue;
      }
      if (hosts && !onHost(url, hosts)) {
        issues.push({ path: field, message: `"${raw}" is not on ${label}. Paste a ${hosts[0]} link here.` });
        continue;
      }
      if (hosts && new URL(url).pathname.replace(/\/+$/, "") === "" && !new URL(url).search) {
        issues.push({ path: field, message: `"${raw}" is the ${label} home page, not a post. Paste the link to your post.` });
        continue;
      }
      const key = postKey(url);
      if (seen.has(key)) {
        issues.push({ path: field, message: `"${raw}" is listed twice. Each post counts once.` });
        continue;
      }
      seen.add(key);
      out.push(url);
      count++;
    }
    clean[field] = out.length ? out.join(", ") : null;
  };

  for (const f of PLATFORM_FIELDS) take(f, PLATFORMS[f].label, PLATFORMS[f].hosts);
  take("other_posts", "post", null);
  return { clean, count, issues };
}
