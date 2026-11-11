-- Files a team attaches to its submission (wireframes, decks, diagrams).
-- The bytes live in the private Blob store under online/t<team id>/; this is
-- the list. Idempotent.
create table if not exists online_attachments (
  id           bigint generated always as identity primary key,
  team_id      bigint not null references online_teams(id) on delete cascade,
  pathname     text not null unique,
  filename     text not null,
  content_type text not null,
  size_bytes   bigint not null,
  uploaded_by  bigint references online_participants(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists online_attachments_team on online_attachments (team_id);
