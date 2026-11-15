import "server-only";
import { cacheLife } from "next/cache";
import type { Platform } from "./social-tracker";

// Engagement for one post on /social-media: likes, comments and (YouTube) views,
// read from each platform's public page or API. No keys, no logins.
//
// Each post's numbers are kept for an hour in the shared cache, so the page asks
// a platform about a post at most once an hour; a link a team has just added
// has no entry yet and is looked up on the next page load.
//
// Sources: Hacker News (official API), dev.to (official API), X (the public
// embed endpoint), YouTube and LinkedIn (the public page), Reddit (public JSON).
// Any of these can refuse or change; a post then shows "—", never a made-up 0.
// Other blogs and video hosts publish no counts.

export type Engagement = { likes: number | null; comments: number | null; views: number | null };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, "");
const onHost = (url: string, ...domains: string[]) => domains.some((d) => hostOf(url) === d || hostOf(url).endsWith(`.${d}`));

function get(url: string, headers: Record<string, string> = {}) {
  return fetch(url, { headers: { "user-agent": UA, "accept-language": "en", ...headers }, redirect: "manual", signal: AbortSignal.timeout(8000) });
}

/** Follows redirects by hand, and only while they stay on the given domains: these are links people typed in. */
async function getWithin(url: string, domains: string[]) {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!onHost(at, ...domains)) return null;
    const res = await get(at);
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res.ok ? res : null;
    const to = new URL(next, at);
    to.search = ""; // LinkedIn's share links add tracking that turns a public post into a sign-up wall
    at = to.toString();
  }
  return null;
}

async function hackerNews(url: string): Promise<Engagement | null> {
  const id = new URL(url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return null;
  const res = await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
  if (!res.ok) return null;
  const item = (await res.json()) as { score?: unknown; descendants?: unknown } | null;
  return item ? { likes: num(item.score), comments: num(item.descendants), views: null } : null;
}

async function x(url: string): Promise<Engagement | null> {
  const id = new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) return null;
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const res = await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`);
  if (!res.ok) return null;
  const t = (await res.json()) as { favorite_count?: unknown; conversation_count?: unknown };
  const likes = num(t.favorite_count);
  return likes === null ? null : { likes, comments: num(t.conversation_count), views: null };
}

async function youtube(url: string): Promise<Engagement | null> {
  const id = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{6,})/)?.[1];
  if (!id) return null;
  const res = await get(`https://www.youtube.com/watch?v=${id}`);
  if (!res.ok) return null;
  const html = await res.text();
  const views = num(html.match(/"viewCount":"(\d+)"/)?.[1]);
  return views === null ? null : { likes: num(html.match(/"likeCount":"(\d+)"/)?.[1]), comments: null, views };
}

async function linkedin(url: string): Promise<Engagement | null> {
  const res = await getWithin(url, ["linkedin.com", "lnkd.in"]);
  if (!res) return null;
  const html = await res.text();
  if (/<title>\s*Sign Up \| LinkedIn/.test(html)) return null;
  const attr = (name: string) => num(html.match(new RegExp(`${name}="(\\d+)"`))?.[1]);
  // Only the counters printed on the post itself. The page's embedded data also lists other people's posts, whose numbers are not this one's.
  const likes = attr("num-reactions");
  const comments = attr("num-comments");
  // A public post page that shows neither counter has none yet; anything else (a login wall, a profile) stays unknown.
  if (likes === null && comments === null) return /"@type":"(SocialMediaPosting|DiscussionForumPosting|Article|VideoObject)"/.test(html) ? { likes: 0, comments: 0, views: null } : null;
  return { likes: likes ?? 0, comments: comments ?? 0, views: null };
}

async function reddit(url: string): Promise<Engagement | null> {
  const u = new URL(url);
  if (!onHost(url, "reddit.com") || !/\/comments\//.test(u.pathname)) return null;
  const res = await get(`https://www.reddit.com${u.pathname.replace(/\/+$/, "")}.json?limit=1`, { accept: "application/json" });
  if (!res.ok) return null;
  const post = ((await res.json()) as { data?: { children?: { data?: { score?: unknown; num_comments?: unknown } }[] } }[])?.[0]?.data?.children?.[0]?.data;
  return post ? { likes: num(post.score), comments: num(post.num_comments), views: null } : null;
}

async function devto(url: string): Promise<Engagement | null> {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  if (!/^\/[\w.-]+\/[\w-]+$/.test(path)) return null;
  const res = await get(`https://dev.to/api/articles${path}`, { accept: "application/json" });
  if (!res.ok) return null;
  const a = (await res.json()) as { public_reactions_count?: unknown; positive_reactions_count?: unknown; comments_count?: unknown };
  return { likes: num(a.public_reactions_count) ?? num(a.positive_reactions_count), comments: num(a.comments_count), views: null };
}

function reader(platform: Platform, url: string) {
  if (platform === "hn") return hackerNews;
  if (platform === "x") return x;
  if (platform === "youtube") return youtube;
  if (platform === "linkedin") return linkedin;
  if (platform === "reddit") return reddit;
  if (platform === "blog" && onHost(url, "dev.to")) return devto;
  return null;
}

/** Whether this kind of link has numbers we can read at all. */
export const hasEngagement = (platform: Platform, url: string) => reader(platform, url) !== null;

/** One post's numbers, remembered for an hour. Throws when the platform didn't answer, so a failure isn't remembered. */
async function read(platform: Platform, url: string): Promise<Engagement> {
  "use cache: remote";
  cacheLife("hours");
  const e = await reader(platform, url)?.(url);
  if (!e) throw new Error(`no engagement for ${url}`);
  return e;
}

/** Engagement for many posts, a few at a time. A post whose platform has no public numbers, or didn't answer, maps to null. */
export async function engagementFor(posts: { platform: Platform; url: string }[]): Promise<Map<string, Engagement | null>> {
  const out = new Map<string, Engagement | null>();
  const queue = posts.filter((p) => hasEngagement(p.platform, p.url));
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        out.set(p.url, await read(p.platform, p.url).catch(() => null));
      }
    }),
  );
  return out;
}
