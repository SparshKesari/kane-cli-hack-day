-- Public evidence: participant-approved files in the public S3 bucket (docs/api/PUBLIC_EVIDENCE.md).
-- An upload lands under incoming/ and is copied to its public key only after the server checks it.
-- Additive and idempotent.
create table if not exists public_evidence (
  id              bigint generated always as identity primary key,
  project_id      bigint not null references projects(id) on delete cascade,
  kind            text not null check (kind in ('screenshot', 'video', 'ndjson', 'report', 'testmd', 'log')),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint not null check (size_bytes > 0),
  content_type    text not null,
  original_name   text not null,
  object_key      text not null unique,
  status          text not null default 'pending' check (status in ('pending', 'public', 'rejected', 'removed')),
  reject_reason   text,
  run_id          bigint references kane_runs(id) on delete set null,
  commit_sha      text check (commit_sha ~ '^[0-9a-f]{40}$'),
  uploaded_by     bigint references members(id) on delete set null,
  url_expires_at  timestamptz,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  removed_at      timestamptz,
  unique (project_id, sha256)
);
create index if not exists idx_public_evidence_project_status on public_evidence (project_id, status);
