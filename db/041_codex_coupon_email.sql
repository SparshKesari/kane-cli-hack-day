-- Codex coupon by email: the hack-os skill posts a participant's email to
-- /api/v1/codex/coupon; if that email is on the participant list (roster_guests)
-- the next code from the pool is mapped to that roster row and emailed to them.
-- Organizers add people to the list through /api/import/roster (source 'api').
-- Additive and idempotent.

-- Which roster row a code went to (the participant list is the source of truth;
-- assigned_member_id is also set when a member with that email exists).
alter table codex_credit_codes add column if not exists assigned_guest_id bigint references roster_guests(id) on delete set null;
-- When the code was last emailed, and how many times (re-sends reuse the same code).
alter table codex_credit_codes add column if not exists emailed_at timestamptz;
alter table codex_credit_codes add column if not exists email_count integer not null default 0;
create unique index if not exists codex_credit_codes_one_per_guest on codex_credit_codes(assigned_guest_id) where status = 'assigned';

alter table roster_guests drop constraint if exists roster_guests_source_check;
alter table roster_guests add constraint roster_guests_source_check check (source in ('luma_csv', 'walk_in', 'manual_offline', 'api'));
