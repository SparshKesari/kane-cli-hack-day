-- TestMu AI activation from the profile (branch testmu-api): our server sends the
-- profile to TestMu, TestMu answers with username + access key, and that key is the
-- participant's credential from then on. Rows it creates have source 'provision'.
-- Additive and idempotent.
alter table testmu_links drop constraint if exists testmu_links_source_check;
alter table testmu_links add constraint testmu_links_source_check check (source in ('redirect', 'header', 'provision'));
-- Last activation failure shown to staff (never the key).
alter table testmu_links add column if not exists provisioned_at timestamptz;
create table if not exists testmu_provision_failures (
  member_id  bigint primary key references members(id) on delete cascade,
  reason     text not null,
  detail     text,
  tries      integer not null default 1,
  last_at    timestamptz not null default now()
);
