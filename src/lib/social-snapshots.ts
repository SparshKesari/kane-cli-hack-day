import "server-only";
import { onlineQuery } from "./online/db";
import { engagementFor, hasEngagement, type Engagement } from "./social-engagement";
import { listOnlinePosts, listSfPosts, PLATFORMS, type Platform } from "./social-tracker";

// Saved engagement for /social-media (db/online/008_social_post_metrics.sql).
// A scheduled job asks every platform about every post and saves what answered;
// the page shows the saved numbers and when each was read. A post whose platform
// refused this time keeps its last good reading instead of turning into "—".

export type Snapshot = Engagement & { readAt: Date };

/** Every saved reading, by post link. Throws when the table isn't there yet. */
export async function loadSnapshots(): Promise<Map<string, Snapshot>> {
  const rows = await onlineQuery<{ url: string; likes: number | null; comments: number | null; reposts: number | null; views: number | null; official: Engagement["official"]; read_at: Date }>(
    `select url, likes, comments, reposts, views, official, read_at from social_post_metrics`,
  );
  return new Map(rows.map((r) => [r.url, { likes: r.likes, comments: r.comments, reposts: r.reposts, views: r.views, official: r.official ?? null, readAt: new Date(r.read_at) }]));
}

/** Reads every post's numbers now, past the hour's cache, and saves the ones that answered. Reports how many did, per platform. */
export async function refreshSnapshots() {
  const lists = await Promise.allSettled([listOnlinePosts(), listSfPosts()]);
  const missing = lists.flatMap((l, i) => (l.status === "rejected" ? [i === 0 ? "online" : "sf"] : []));
  const posts = [...new Map(lists.flatMap((l) => (l.status === "fulfilled" ? l.value : [])).map((p) => [p.url, p])).values()].filter((p) => hasEngagement(p.platform, p.url));
  const engagement = await engagementFor(posts, { fresh: true });

  const coverage = Object.fromEntries(PLATFORMS.map((p) => [p, { read: 0, of: 0 }])) as Record<Platform, { read: number; of: number }>;
  const saved = posts.flatMap((p) => {
    const e = engagement.get(p.url);
    coverage[p.platform].of++;
    if (!e || (e.likes === null && e.views === null)) return []; // didn't answer: keep the last reading
    coverage[p.platform].read++;
    return [{ url: p.url, platform: p.platform, likes: e.likes, comments: e.comments, reposts: e.reposts ?? null, views: e.views, official: e.official ?? null }];
  });

  if (saved.length > 0) {
    const cols = `r(url text, platform text, likes integer, comments integer, reposts integer, views bigint, official jsonb)`;
    // A count the source stopped giving keeps its last value. An official repost stays recorded
    // after it has scrolled out of the 20 latest posts the timeline shows.
    await onlineQuery(
      `insert into social_post_metrics as t (url, platform, likes, comments, reposts, views, official, read_at)
       select url, platform, likes, comments, reposts, views, nullif(official, 'null'::jsonb), now() from jsonb_to_recordset($1::jsonb) as ${cols}
       on conflict (url) do update set
         platform = excluded.platform,
         likes = coalesce(excluded.likes, t.likes),
         comments = coalesce(excluded.comments, t.comments),
         reposts = coalesce(excluded.reposts, t.reposts),
         views = coalesce(excluded.views, t.views),
         official = case when excluded.official is null or (jsonb_array_length(excluded.official) = 0 and t.official is not null) then t.official else excluded.official end,
         read_at = excluded.read_at`,
      [JSON.stringify(saved)],
    );
    await onlineQuery(
      `insert into social_post_metrics_daily as d (url, day, likes, comments, reposts, views)
       select url, current_date, likes, comments, reposts, views from jsonb_to_recordset($1::jsonb) as ${cols}
       on conflict (url, day) do update set
         likes = coalesce(excluded.likes, d.likes), comments = coalesce(excluded.comments, d.comments),
         reposts = coalesce(excluded.reposts, d.reposts), views = coalesce(excluded.views, d.views)`,
      [JSON.stringify(saved)],
    );
  }
  return { posts: posts.length, saved: saved.length, coverage: Object.fromEntries(Object.entries(coverage).filter(([, c]) => c.of > 0)), eventsNotLoaded: missing };
}
