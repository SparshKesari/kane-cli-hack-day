-- Team submission page (docs/api/TEAM_PAGE.md): the page fields that have no other home.
-- Repo, commit, video and Kane runs live in the submission draft, and the deck in deck_versions.
-- One row per project. version counts writes through the page API.
-- Additive and idempotent.
create table if not exists team_pages (
  project_id          bigint primary key references projects(id) on delete cascade,
  version             integer not null default 0 check (version >= 0),
  one_pager_html      text check (octet_length(one_pager_html) <= 262144),
  one_pager_sha256    text check (one_pager_sha256 ~ '^[0-9a-f]{64}$'),
  one_pager_saved_at  timestamptz,
  -- Numeric public_evidence ids (PE-n), in the order the team gave them.
  evidence_ids        bigint[] not null default '{}',
  -- {"deck_id": project id, "version": n} or {"hosted": true}.
  deck                jsonb,
  -- [{"url", "added_at", "expires_at"}]: TestMu / Kane share links last 7 days.
  share_links         jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
