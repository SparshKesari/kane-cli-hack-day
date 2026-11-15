import "server-only";
import { query } from "@/lib/db";
import { onlineQuery } from "@/lib/online/db";
import { normalizeUrl, splitLinks } from "@/lib/online/links";
import { normalizeDraft } from "@/server/submission";

// The post tracker at /social-media: every social, blog and video link teams
// entered in their submission, for the SF Hack Day and the online hackathon.
// Read-only. Same visibility rules as /showcase: SF submissions that are
// finalized and not hidden by moderation; online submissions that are
// submitted and whose team isn't hidden. No emails, no member names.

export const PLATFORM_LABEL = {
  x: "X",
  linkedin: "LinkedIn",
  hn: "Hacker News",
  reddit: "Reddit",
  youtube: "YouTube",
  video: "Other video",
  blog: "Blog / other",
} as const;
export type Platform = keyof typeof PLATFORM_LABEL;
export const PLATFORMS = Object.keys(PLATFORM_LABEL) as Platform[];

export type EventKey = "sf" | "online";
export const EVENT_LABEL: Record<EventKey, string> = { sf: "Hack Day SF", online: "Online Hackathon" };

export type TrackedPost = {
  event: EventKey;
  team: string;
  project: string;
  /** The project's page on this site, when it has one that is open. */
  projectHref: string | null;
  platform: Platform;
  url: string;
  /** When the submission holding this link was last saved. */
  savedAt: Date | null;
};

const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, "");
const on = (h: string, ...domains: string[]) => domains.some((d) => h === d || h.endsWith(`.${d}`));

/** By where the link points, not which box it was typed in: "other posts" mixes blogs, videos and threads. */
function classify(url: string, fromVideoField: boolean): Platform {
  const h = host(url);
  if (on(h, "x.com", "twitter.com")) return "x";
  if (on(h, "linkedin.com", "lnkd.in")) return "linkedin";
  if (on(h, "news.ycombinator.com")) return "hn";
  if (on(h, "reddit.com", "redd.it")) return "reddit";
  if (on(h, "youtube.com", "youtu.be", "youtube-nocookie.com")) return "youtube";
  if (fromVideoField || on(h, "loom.com", "vimeo.com")) return "video";
  return "blog";
}

/** Same post whatever the scheme, www, trailing slash or tracking query. HN and YouTube keep the query: it names the post. */
function key(url: string) {
  const u = new URL(url);
  const h = host(url);
  const keep = on(h, "news.ycombinator.com") ? u.search : on(h, "youtube.com") ? `?v=${u.searchParams.get("v") ?? ""}` : "";
  return `${h}${u.pathname.replace(/\/+$/, "")}${keep}`.toLowerCase();
}

type Source = { links: (string | null | undefined)[]; video?: boolean };

function collect(base: Omit<TrackedPost, "platform" | "url">, sources: Source[], seen: Set<string>): TrackedPost[] {
  const out: TrackedPost[] = [];
  for (const s of sources) {
    for (const raw of s.links.flatMap((l) => splitLinks(typeof l === "string" ? l : ""))) {
      const url = normalizeUrl(raw);
      if (!url) continue; // only real http(s) links are ever rendered
      const k = `${base.event}:${key(url)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...base, platform: classify(url, Boolean(s.video)), url });
    }
  }
  return out;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

export async function listSfPosts(): Promise<TrackedPost[]> {
  const rows = await query<{ team_name: string; slug: string; showcase_state: string; updated_at: Date | null; finalized_at: Date | null; draft: unknown }>(
    `select t.name as team_name, p.slug, p.showcase_state, s.updated_at, s.finalized_at, s.draft
       from projects p
       join teams t on t.id = p.team_id
       join lateral (
         select * from submissions x where x.project_id = p.id and x.status <> 'withdrawn' order by x.id desc limit 1
       ) s on true
      where s.status = 'finalized' and p.showcase_state <> 'hidden_by_moderation'
      order by t.name`,
  );
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const d = normalizeDraft(r.draft);
    const open = r.showcase_state === "public" || r.showcase_state === "unlisted";
    return collect(
      { event: "sf", team: r.team_name, project: d.project_name || r.team_name, projectHref: open ? `/ship/${r.slug}` : null, savedAt: r.updated_at ?? r.finalized_at },
      [
        { links: arr(d.x_posts) },
        { links: arr(d.linkedin_posts) },
        { links: [d.hn_url] },
        { links: arr(d.blog_links) },
        { links: arr(d.social_links) },
        { links: [d.video_url], video: true },
      ],
      seen,
    );
  });
}

export async function listOnlinePosts(): Promise<TrackedPost[]> {
  const rows = await onlineQuery<{
    slug: string; team_name: string; project_name: string | null; updated_at: Date | null;
    x_url: string | null; linkedin_url: string | null; hn_url: string | null; reddit_url: string | null; other_posts: string | null; video_url: string | null;
    x_posts: string[] | null; linkedin_posts: string[] | null; blog_links: string[] | null;
  }>(
    `select t.slug, t.name as team_name, s.project_name, s.updated_at,
            s.x_url, s.linkedin_url, s.hn_url, s.reddit_url, s.other_posts, s.video_url,
            s.x_posts, s.linkedin_posts, s.blog_links
       from online_submissions s
       join online_teams t on t.id = s.team_id
      where s.status = 'submitted' and not t.hidden
      order by t.name`,
  );
  const seen = new Set<string>();
  return rows.flatMap((r) =>
    collect(
      { event: "online", team: r.team_name, project: r.project_name ?? r.team_name, projectHref: `/o/p/${r.slug}`, savedAt: r.updated_at },
      [
        { links: [r.x_url, ...arr(r.x_posts)] },
        { links: [r.linkedin_url, ...arr(r.linkedin_posts)] },
        { links: [r.hn_url] },
        { links: [r.reddit_url] },
        { links: [r.other_posts, ...arr(r.blog_links)] },
        { links: [r.video_url], video: true },
      ],
      seen,
    ),
  );
}
