-- Teams, richer profiles and a per-team submission. Idempotent.

-- A team of 1-4. A solo builder is a team of one (solo = true) named after
-- their project. `slug` is the public page: /online/p/{slug}.
create table if not exists online_teams (
  id          bigint generated always as identity primary key,
  name        text not null,
  slug        text not null unique,
  invite_code text not null unique,
  solo        boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table online_participants add column if not exists x_url        text;
alter table online_participants add column if not exists linkedin_url text;
alter table online_participants add column if not exists other_links  text;
alter table online_participants add column if not exists team_id      bigint references online_teams(id) on delete set null;
create index if not exists online_participants_team on online_participants (team_id);

-- The submission belongs to the team now; participant_id is just who saved it last.
alter table online_submissions add column if not exists team_id      bigint references online_teams(id) on delete cascade;
create unique index if not exists online_submissions_team on online_submissions (team_id);
alter table online_submissions drop constraint if exists online_submissions_participant_id_key;
alter table online_submissions alter column participant_id drop not null;

alter table online_submissions add column if not exists more_details text;
alter table online_submissions add column if not exists live_url     text;
alter table online_submissions add column if not exists linkedin_url text;
alter table online_submissions add column if not exists other_posts  text;
