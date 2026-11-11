-- Online hackathon. Lives in its own database (ONLINE_DATABASE_URL), never the
-- SF Hack Day one: none of these tables exist there and nothing here reads it.
-- Idempotent; apply with `npm run db:migrate:online`.

create table if not exists online_participants (
  id            bigint generated always as identity primary key,
  email         text not null,
  name          text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists online_participants_email on online_participants (lower(email));

-- One submission per account. A draft until "Submit"; editable until the deadline.
create table if not exists online_submissions (
  id                  bigint generated always as identity primary key,
  participant_id      bigint not null unique references online_participants(id) on delete cascade,
  project_name        text,
  one_line_pitch      text,
  project_description text,
  repo_url            text,
  showcase_url        text,
  linkedin_posts      text[] not null default '{}',
  x_posts             text[] not null default '{}',
  blog_links          text[] not null default '{}',
  deck_url            text,
  video_url           text,
  hn_url              text,
  status              text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
