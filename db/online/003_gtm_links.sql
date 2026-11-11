-- GTM links for the online submission (bonus points): Hacker News (hn_url,
-- already there), X/Twitter and Reddit. Idempotent.
alter table online_submissions add column if not exists x_url      text;
alter table online_submissions add column if not exists reddit_url text;
