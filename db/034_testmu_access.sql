-- TestMu AI access-key gate (branch testmu-api). Additive and idempotent.
-- One row per TestMu AI username that has connected. The access key itself is
-- never stored: key_fingerprint is sha256 over username + key, enough to notice
-- a rotated key and nothing more. member_id is filled when the TestMu email
-- matches a registration (at connect time, or later on first use).
create table if not exists testmu_links (
  id              bigint generated always as identity primary key,
  testmu_username text not null,
  member_id       bigint references members(id) on delete set null,
  email_hash      text,
  key_fingerprint text not null,
  source          text not null default 'redirect' check (source in ('redirect', 'header')),
  verified_at     timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  revoked_at      timestamptz
);
create unique index if not exists testmu_links_username_idx on testmu_links(lower(testmu_username));
create index if not exists testmu_links_member_idx on testmu_links(member_id) where member_id is not null;
create index if not exists testmu_links_email_idx on testmu_links(email_hash) where email_hash is not null;
