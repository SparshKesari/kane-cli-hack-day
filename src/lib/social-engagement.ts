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
//
// The public sources are partial: X's embed carries likes and replies only, the
// YouTube page no comment count, and Reddit refuses most reads without a login.
// Each has an official API that fills the gap, used when its key is set:
//   X_BEARER_TOKEN                          reposts, quotes and views on X (paid per post read)
//   YOUTUBE_API_KEY                         comment counts on YouTube
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET  Reddit scores and comments
// Without a key the public source is used, as before.

/** The organisers' own accounts, and where each one lives. */
export const OFFICIAL = {
  testmu: { label: "TestMu AI", x: "testmuai", linkedin: ["testmu-ai"] },
  kane: { label: "Kane CLI", x: "kane_cli", linkedin: [] as string[] },
} as const;
export type OfficialAccount = keyof typeof OFFICIAL;
const ACCOUNTS = Object.keys(OFFICIAL) as OfficialAccount[];
/** Something an official account did to a post. */
export type OfficialTouch = { account: OfficialAccount; action: "commented" | "replied" | "reposted" | "quoted" };

export type Engagement = {
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Reposts plus quotes on X. Null or absent where the source doesn't say. */
  reposts?: number | null;
  /** What the official accounts did to this post. Empty: looked, found nothing. Null or absent: couldn't tell. */
  official?: OfficialTouch[] | null;
};

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

const tweetId = (url: string) => new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];

async function x(url: string): Promise<Engagement | null> {
  const id = tweetId(url);
  if (!id) return null;
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const res = await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`);
  if (!res.ok) return null;
  const t = (await res.json()) as { favorite_count?: unknown; conversation_count?: unknown };
  const likes = num(t.favorite_count);
  return likes === null ? null : { likes, comments: num(t.conversation_count), views: null };
}

const youtubeId = (url: string) => url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{6,})/)?.[1];

async function youtube(url: string): Promise<Engagement | null> {
  const id = youtubeId(url);
  if (!id) return null;
  const res = await get(`https://www.youtube.com/watch?v=${id}`);
  if (!res.ok) return null;
  const html = await res.text();
  const views = num(html.match(/"viewCount":"(\d+)"/)?.[1]);
  return views === null ? null : { likes: num(html.match(/"likeCount":"(\d+)"/)?.[1]), comments: null, views };
}

async function linkedin(url: string): Promise<Engagement | null> {
  // Articles (/pulse/) print no counter of their own, only those of the posts listed beside them.
  if (new URL(url).pathname.startsWith("/pulse/")) return null;
  const res = await getWithin(url, ["linkedin.com", "lnkd.in"]);
  if (!res) return null;
  const html = await res.text();
  if (/<title>\s*Sign Up \| LinkedIn/.test(html)) return null;
  // The page lists the post first, then other people's posts with counters of their own.
  // Only the first card is this post; one with no counter printed has no reactions (or comments) yet.
  const start = html.indexOf("<article");
  if (start < 0) return null; // an article, a profile, a login wall: no post card to read
  const end = html.indexOf("</article>", start);
  const card = html.slice(start, end < 0 ? undefined : end);
  const count = (name: string) => num(card.match(new RegExp(`${name}="(\\d+)"`))?.[1]) ?? 0;
  // The public page prints the first few comments with their authors; a company page's link is /company/<slug>.
  const authors = card
    .split(/<section class="comment\b/)
    .slice(1)
    // The author's own link carries the "comment_actor" tracking name; a company tagged in the comment's text does not.
    .map((c) => c.match(/href="https:\/\/[a-z.]*linkedin\.com\/company\/([\w-]+)[^"]*public_post_comment_actor/)?.[1]?.toLowerCase());
  const comments = Math.max(count("num-comments"), authors.length);
  const official = ACCOUNTS.filter((a) => OFFICIAL[a].linkedin.some((slug) => authors.includes(slug))).map((account) => ({ account, action: "commented" as const }));
  // No official comment among those shown only means "no" when every comment was shown.
  return { likes: count("num-reactions"), comments, views: null, official: official.length > 0 || authors.length >= comments ? official : null };
}

const REDDIT_UA = "web:kaneclihack-social-tracker:1.0";
let redditToken: { value: string; until: number } | null = null;

/** An app-only token for Reddit's API, when the app's id and secret are set. Kept in memory until shortly before it expires. */
async function redditAuth(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.until > Date.now()) return redditToken.value;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": REDDIT_UA },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const t = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!t.access_token) return null;
  redditToken = { value: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 300) * 1000 };
  return t.access_token;
}

const redditId = (path: string) => path.match(/\/comments\/(\w+)/)?.[1];

/** The post's id. A share link (/r/<sub>/s/<code>) says it only in the redirect it answers with. */
async function redditPostId(url: string): Promise<string | null> {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!onHost(at, "reddit.com", "redd.it")) return null;
    const id = redditId(new URL(at).pathname);
    if (id) return id;
    const res = await get(at);
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return null;
    at = new URL(next, at).toString();
  }
  return null;
}

async function reddit(url: string): Promise<Engagement | null> {
  const id = await redditPostId(url);
  if (!id) return null;
  const token = await redditAuth();
  const res = token
    ? await fetch(`https://oauth.reddit.com/comments/${id}?limit=1&raw_json=1`, { headers: { authorization: `Bearer ${token}`, "user-agent": REDDIT_UA }, signal: AbortSignal.timeout(8000) })
    : // The permalink as submitted when it already names the post (the bare /comments/<id> form redirects), else the bare form.
      await get(`https://www.reddit.com${redditId(new URL(url).pathname) ? new URL(url).pathname.replace(/\/+$/, "") : `/comments/${id}`}.json?limit=1`, { accept: "application/json" });
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
  return readNow(platform, url);
}

/** The same, asked now. */
async function readNow(platform: Platform, url: string): Promise<Engagement> {
  const e = await reader(platform, url)?.(url);
  if (!e) throw new Error(`no engagement for ${url}`);
  return e;
}

const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** X's own API, up to 100 posts a call: likes, replies, reposts plus quotes, and views. Needs X_BEARER_TOKEN. A removed post is simply absent. */
async function xApi(ids: string[]): Promise<Record<string, Engagement>> {
  "use cache: remote";
  cacheLife("hours");
  return xApiNow(ids);
}

async function xApiNow(ids: string[]): Promise<Record<string, Engagement>> {
  const res = await fetch(`https://api.x.com/2/tweets?ids=${ids.join(",")}&tweet.fields=public_metrics`, {
    headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`x api: ${res.status}`);
  const { data } = (await res.json()) as { data?: { id: string; public_metrics?: Record<string, unknown> }[] };
  const out: Record<string, Engagement> = {};
  for (const t of data ?? []) {
    const m = t.public_metrics;
    if (!m) continue;
    const reposts = num(m.retweet_count) ?? num(m.repost_count); // the docs use both names
    const quotes = num(m.quote_count);
    out[t.id] = { likes: num(m.like_count), comments: num(m.reply_count), views: num(m.impression_count), reposts: reposts === null && quotes === null ? null : (reposts ?? 0) + (quotes ?? 0) };
  }
  return out;
}

/** YouTube's Data API, up to 50 videos a call: views, likes and comments. Needs YOUTUBE_API_KEY. */
async function youtubeApi(ids: string[]): Promise<Record<string, Engagement>> {
  "use cache: remote";
  cacheLife("hours");
  return youtubeApiNow(ids);
}

async function youtubeApiNow(ids: string[]): Promise<Record<string, Engagement>> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}&key=${process.env.YOUTUBE_API_KEY}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`youtube api: ${res.status}`);
  const { items } = (await res.json()) as { items?: { id: string; statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown } }[] };
  const out: Record<string, Engagement> = {};
  for (const v of items ?? []) if (v.statistics) out[v.id] = { likes: num(v.statistics.likeCount), comments: num(v.statistics.commentCount), views: num(v.statistics.viewCount) };
  return out;
}

/** Posts answered by an official API, by url. A call that fails answers nothing, and those posts fall back to the public source. */
async function fromApis(posts: { platform: Platform; url: string }[], fresh: boolean): Promise<Map<string, Engagement>> {
  const out = new Map<string, Engagement>();
  const ask = async (platform: Platform, idOf: (url: string) => string | undefined, size: number, api: (ids: string[]) => Promise<Record<string, Engagement>>) => {
    const mine = posts.filter((p) => p.platform === platform).map((p) => ({ url: p.url, id: idOf(p.url) }));
    const ids = [...new Set(mine.flatMap((p) => (p.id ? [p.id] : [])))].sort(); // sorted, so the same posts hit the same cache entry
    const got = Object.assign({}, ...(await Promise.all(chunks(ids, size).map((c) => api(c).catch((e) => (console.error("social-media:", e), {})))))) as Record<string, Engagement>;
    for (const p of mine) if (p.id && got[p.id]) out.set(p.url, got[p.id]);
  };
  await Promise.all([
    process.env.X_BEARER_TOKEN ? ask("x", tweetId, 100, fresh ? xApiNow : xApi) : null,
    process.env.YOUTUBE_API_KEY ? ask("youtube", youtubeId, 50, fresh ? youtubeApiNow : youtubeApi) : null,
  ]);
  return out;
}

type XTouch = { id: string; action: OfficialTouch["action"] };

/**
 * What one official X account did lately: the posts it reposted, quoted or replied to, from its public
 * embed timeline (its 20 latest posts and reposts; replies to other people are not in it). Null when X
 * hands back nothing for the account, which it does for some. Kept for an hour either way, so the page
 * asks X once an hour per account, not once per post.
 */
async function xTimeline(handle: string): Promise<XTouch[] | null> {
  "use cache: remote";
  cacheLife("hours");
  return xTimelineNow(handle);
}

async function xTimelineNow(handle: string): Promise<XTouch[] | null> {
  const res = await get(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`);
  if (!res.ok) throw new Error(`x timeline ${handle}: ${res.status}`); // refused or rate limited: don't remember it
  const data = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!data) return null;
  type Tweet = { retweeted_status?: { id_str?: string }; quoted_status?: { id_str?: string }; quoted_status_id_str?: string; in_reply_to_status_id_str?: string };
  const entries = (JSON.parse(data) as { props?: { pageProps?: { timeline?: { entries?: { content?: { tweet?: Tweet } }[] } } } }).props?.pageProps?.timeline?.entries ?? [];
  if (entries.length === 0) return null;
  const out: XTouch[] = [];
  for (const { content } of entries) {
    const t = content?.tweet;
    if (!t) continue;
    if (t.retweeted_status?.id_str) out.push({ id: t.retweeted_status.id_str, action: "reposted" });
    const quoted = t.quoted_status?.id_str ?? t.quoted_status_id_str;
    if (quoted) out.push({ id: quoted, action: "quoted" });
    if (t.in_reply_to_status_id_str) out.push({ id: t.in_reply_to_status_id_str, action: "replied" });
  }
  return out;
}

/** For X posts: tweet id → what the official accounts did to it. Null when no account's timeline could be read. */
async function officialOnX(fresh: boolean): Promise<Map<string, OfficialTouch[]> | null> {
  const timelines = await Promise.all(ACCOUNTS.map((a) => (fresh ? xTimelineNow : xTimeline)(OFFICIAL[a].x).catch(() => null)));
  if (timelines.every((t) => t === null)) return null;
  const out = new Map<string, OfficialTouch[]>();
  timelines.forEach((touches, i) => {
    for (const t of touches ?? []) {
      const list = out.get(t.id) ?? [];
      if (!list.some((o) => o.account === ACCOUNTS[i] && o.action === t.action)) list.push({ account: ACCOUNTS[i], action: t.action });
      out.set(t.id, list);
    }
  });
  return out;
}

/**
 * Engagement for many posts, a few at a time. A post whose platform has no public numbers, or didn't answer, maps to null.
 * `fresh` asks every platform now instead of using the hour's cache: for the scheduled read that saves the numbers.
 */
export async function engagementFor(posts: { platform: Platform; url: string }[], { fresh = false } = {}): Promise<Map<string, Engagement | null>> {
  const out = new Map<string, Engagement | null>(await fromApis(posts, fresh));
  const queue = posts.filter((p) => hasEngagement(p.platform, p.url) && !out.has(p.url));
  const onX = posts.some((p) => p.platform === "x") ? await officialOnX(fresh) : null;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        out.set(p.url, await (fresh ? readNow : read)(p.platform, p.url).catch(() => null));
      }
    }),
  );
  // X says who reposted or quoted a post in the official accounts' timelines, not on the post itself.
  for (const p of posts) {
    const id = p.platform === "x" ? tweetId(p.url) : null;
    if (id) out.set(p.url, { ...(out.get(p.url) ?? { likes: null, comments: null, views: null }), official: onX ? (onX.get(id) ?? []) : null });
  }
  return out;
}
