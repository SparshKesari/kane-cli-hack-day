-- TestMu AI Hack Day team sync. Additive and idempotent.
-- The captain's step-2 claim moves teammates into one TestMu AI org: the last team/invite answer per teammate. Never a password.
create table if not exists testmu_team_sync (
  team_id         bigint not null references teams(id) on delete cascade,
  member_id       bigint not null references members(id) on delete cascade,
  code            text not null,
  message         text,
  organization_id bigint,
  attempted_at    timestamptz not null default now(),
  primary key (team_id, member_id)
);
create index if not exists idx_testmu_team_sync_member on testmu_team_sync(member_id);
