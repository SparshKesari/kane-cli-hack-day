# Sign-up and team

## Sign-up (here, with `kanehack register`)

1. Their password must be saved first: `kanehack password --check --json`. Exit 2 → `references/setup.md`, step 2.
2. Collect, in their words: full name, the email they used on Luma, LinkedIn (URL or handle), X handle, GitHub handle (optional), and whether they're looking for teammates. Show it back and ask "Save this profile?"
3. `kanehack register --name "<name>" --email <email> --linkedin <linkedin> --x <x handle> [--github <handle>] [--looking] --json`
   - 0 → the profile is saved and this machine is signed in. Codex not connected to the event tools yet → `references/setup.md`, step 3.
   - 2 and "already registered" → `kanehack signin --email <email> --json`.
   - 2 naming a field → fix it with them and run it again.
4. A photo is optional; they can add one at `https://kaneclihack.sh/passport`.

## Team

Team registration closes at 11:00 Pacific (check `event_get_brief`). Solo counts as a one-person team.

Ask which they want, then follow one path:

- **Join a team**: the captain gives them a join code; they type it here. Show the code back and ask "Join this team?" before calling `team_join` with `invite_code` and `explicit_confirmation: true`. Never put a code in a link.
- **Start a team** (they become captain): agree the name, ask "Create team <name>?", then `team_create` with `name` and `explicit_confirmation: true`. The captain gets join codes for teammates on `https://kaneclihack.sh/team`.
- **Go solo**: ask "Create a solo team <name>?", then `team_create` with `name`, `solo: true`, `explicit_confirmation: true`.
- **Looking for teammates**: `team_find` (optionally `skill`, e.g. "frontend") lists recruiting teams and people open to teaming up; the pool is also on `https://kaneclihack.sh/match`.

After a write, call `participant_get_status` and confirm `team.name` and `team.slug` from the answer. Errors: team full, code expired or revoked, already on a team, roster locked → say which, and offer the other paths.

## Lock the team

When everyone has joined, the captain locks it. Say what it does (nobody can join, leave or be invited after this; an organizer can reopen it), ask "Lock <team name> as your final team?", then `team_lock` with `explicit_confirmation: true`. Only the captain can. Teammates: "Ask your captain to lock the team. Type **done** here when it's finished." Then `participant_get_status` must show `team.state` = `roster_locked`; not yet → say so and wait for done again. A solo team locks the same way. Once locked, the TestMu side moves everyone into the captain's organization; that happens on its own.

Then → `references/activate.md`.
