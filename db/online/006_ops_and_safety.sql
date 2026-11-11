-- Captains, roster locking, password reset, login throttling, receipts,
-- edit-conflict detection, organiser hide, and the email outbox. Idempotent.

alter table online_teams add column if not exists captain_id bigint references online_participants(id) on delete set null;
-- Hidden by an organiser: the public showcase page 404s.
alter table online_teams add column if not exists hidden boolean not null default false;
-- Existing teams: the earliest member is the captain.
update online_teams t set captain_id = (select min(p.id) from online_participants p where p.team_id = t.id) where captain_id is null;

alter table online_participants add column if not exists accepted_terms_at timestamptz;
alter table online_participants add column if not exists reset_token_hash  text;
alter table online_participants add column if not exists reset_expires_at  timestamptz;
alter table online_participants add column if not exists failed_logins     int not null default 0;
alter table online_participants add column if not exists locked_until      timestamptz;

-- version: bumped on every save, so a stale form can't overwrite a teammate's edit.
alter table online_submissions add column if not exists version      int not null default 0;
alter table online_submissions add column if not exists receipt_code text unique;

-- Every email the site tries to send, sent or not (so organisers can see what went out).
create table if not exists online_emails (
  id         bigint generated always as identity primary key,
  to_email   text not null,
  kind       text not null,
  subject    text not null,
  body       text not null,
  status     text not null default 'queued' check (status in ('queued','sent','failed','not_configured')),
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists online_emails_created on online_emails (created_at desc);
