# Sign-up and team

## Sign-up

There is no sign-up in this chat. Send them to `https://kaneclihack.sh/register`: name, the email they used on Luma, LinkedIn, X and GitHub, a password, then a photo or skip. When the profile is saved the page shows their TestMu AI username and access key once. Then they run `kanehack login` in their own terminal (`references/setup.md`, step 2). Wait for them to say they're done.

## Team

Team registration closes at 11:00 Pacific (check `event_get_brief`). Solo counts as a one-person team.

Ask which they want, then follow one path:

- **Join a team**: the captain gives them a join code; they type it here. Show the code back and ask "Join this team?" before calling `team_join` with `invite_code` and `explicit_confirmation: true`. Never put a code in a link.
- **Start a team** (they become captain): agree the name, ask "Create team <name>?", then `team_create` with `name` and `explicit_confirmation: true`. The captain gets join codes for teammates on `https://kaneclihack.sh/team`.
- **Go solo**: ask "Create a solo team <name>?", then `team_create` with `name`, `solo: true`, `explicit_confirmation: true`.
- **Looking for teammates**: `team_find` (optionally `skill`, e.g. "frontend") lists recruiting teams and people open to teaming up; the pool is also on `https://kaneclihack.sh/match`.

After a write, call `participant_get_status` and confirm `team.name` and `team.slug` from the answer. Errors: team full, code expired or revoked, already on a team, roster locked → say which, and offer the other paths.

## Lock the team

The captain confirms the final roster on `https://kaneclihack.sh/team`, which locks it. Teammates wait on that page until it's locked. The skill can't lock it. Locked shows as `team.state` = `roster_locked` in `participant_get_status`. Once locked, the TestMu side moves everyone into the captain's organization; that happens on its own.

Then → `references/activate.md`.
