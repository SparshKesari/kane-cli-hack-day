-- Codex status pings (branch testmu-api): the opt-in Codex hook on a
-- participant's machine POSTs to /{team}/status (= /api/v1/teams/{team}/status).
-- Metadata only, per plugin/hooks/README.md: no prompts, transcripts, code,
-- paths, repo names or tokens. One row per member per Codex session; a ping
-- updates it. Additive and idempotent.
create table if not exists codex_status (
  id             bigint generated always as identity primary key,
  member_id      bigint not null references members(id) on delete cascade,
  team_id        bigint not null references teams(id) on delete cascade,
  -- sha256 of the hook's opaque session id: groups pings without keeping the id.
  session_hash   text not null,
  status         text not null check (status in ('working', 'idle', 'waiting_for_human', 'error', 'ended')),
  last_event     text not null,
  host           text not null default 'codex',
  codex_version  text,
  model          text,
  kane_run_id    text,
  ping_count     integer not null default 1,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (member_id, session_hash)
);
create index if not exists codex_status_team_idx on codex_status(team_id, last_seen_at desc);
