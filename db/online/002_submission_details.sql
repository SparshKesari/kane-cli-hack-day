-- The online hackathon's submission asks for: repo, demo video, one
-- paragraph, a live URL or run command, plus the agent used, the team and the
-- TestMu AI account email (eligibility). Idempotent.
alter table online_submissions add column if not exists run_target   text;
alter table online_submissions add column if not exists agent_used   text;
alter table online_submissions add column if not exists team_name    text;
alter table online_submissions add column if not exists team_members text;
alter table online_submissions add column if not exists testmu_email text;
