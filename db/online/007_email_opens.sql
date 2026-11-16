-- Whether an email was opened. Each sent email carries a tiny image whose address
-- holds this token; the first and latest time it was loaded are kept, and how often.
-- "Opened" is a signal, not proof: some mail apps load images without the person
-- reading, and some block them entirely.
alter table online_emails add column if not exists token          text unique;
alter table online_emails add column if not exists opened_at      timestamptz;
alter table online_emails add column if not exists last_opened_at timestamptz;
alter table online_emails add column if not exists open_count     integer not null default 0;
