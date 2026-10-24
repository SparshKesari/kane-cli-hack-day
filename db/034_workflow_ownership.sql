-- Shared organizer ownership and readiness; independent of participant completion.
create table if not exists workflow_ownership (
  event_id bigint not null default current_event_id() references hack_events(id),
  task_id text not null check (length(task_id) between 1 and 100),
  owner_name text not null default '' check (length(owner_name) <= 80),
  status text not null default 'pending' check (status in ('pending','in_progress','blocked','done')),
  note text not null default '' check (length(note) <= 1200),
  revision integer not null default 0 check (revision >= 0),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (event_id, task_id)
);
