-- Saved engagement for the posts on /social-media, written by the scheduled read
-- (/api/cron/social-metrics). The page shows these instead of asking every
-- platform on every visit, so a platform that refuses once doesn't blank a number.
-- Keyed by the post's link; covers both events' posts, and holds nothing private.
create table if not exists social_post_metrics (
  url        text primary key,
  platform   text not null,
  likes      integer,
  comments   integer,
  reposts    integer,
  views      bigint,
  official   jsonb,                               -- what the official accounts did; null = couldn't tell
  read_at    timestamptz not null default now()   -- the last time the platform answered
);

-- One reading per post per day (the day's latest), so growth can be seen later.
create table if not exists social_post_metrics_daily (
  url      text not null,
  day      date not null,
  likes    integer,
  comments integer,
  reposts  integer,
  views    bigint,
  primary key (url, day)
);
