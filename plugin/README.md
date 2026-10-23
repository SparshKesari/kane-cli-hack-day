# Kane Hack OS plugin

Twelve participant skills plus the event MCP server for Kane CLI Hack Day.

> **Status: not announced as installable.** The skills and the `/mcp` server are implemented in this repo, but the plugin must pass a clean, fresh-session install test (Codex on macOS, and Windows if we claim it) before anyone tells participants to install it (TASKS T-PLG-05, acceptance A09). Until then the supported path is the web app plus `kanehack`.

## What's here

| Path | What |
|---|---|
| `plugin.json` | Manifest (name `kane-hack-os`, version 0.1.0). Bump the version on every release. |
| `mcp.json` | The remote MCP server `kane-hack-event` → `https://www.kaneclihack.sh/mcp`, Streamable HTTP, bearer token from `KANEHACK_TOKEN`. |
| `skills/hack-*/SKILL.md` | The 12 skills. The same files are mirrored at `.agents/skills/hack-*`, where Codex finds them when it runs in this repo. |
| `hooks/README.md` | The optional, opt-in lifecycle hook (off by default). |
| `GENERATIVE_UI_CONTRACT.md` | How tool envelopes map to UI cards and to plain text. |

| Skill | MCP tools it uses |
|---|---|
| hack-onboard | participant_get_status, participant_update_profile, activation_begin, activation_get_checkpoint |
| hack-doctor | readiness_report, event_get_brief, help_diagnose |
| hack-team | participant_get_status, team_find, team_create, team_join |
| hack-idea | idea_validate, idea_check_overlap, harness_get_capabilities |
| hack-harness | harness_get_capabilities, event_get_brief |
| hack-verify | kane_record_run, milestone_propose |
| hack-progress | kane_record_run, milestone_propose, submission_preflight |
| hack-help | help_diagnose, help_create, help_get_status |
| hack-demo | deck_get, deck_update, demo_generate, showcase_preview |
| hack-showcase | showcase_preview, showcase_publish, submission_preflight |
| hack-gtm | showcase_preview, milestone_propose |
| hack-submit | submission_preflight, submission_finalize, event_get_brief |

`social_publish` is an organizer action on the web and is deliberately **not** an MCP tool.

## Kane CLI syntax comes from the official skill

These skills never copy or change the official Kane CLI skill. Install it separately:

```sh
npx @testmuai/kane-cli-skill
```

## Connecting

1. Install the helper: `curl -fsSL https://kaneclihack.sh/install.sh | sh` (Windows: `irm https://www.kaneclihack.sh/install.ps1 | iex`). Read it first if you like: it's plain text, checks prerequisites and installs `kanehack` into `~/.kanehack` from a checksummed tarball, without sudo. Don't run `npx kanehack`: that npm name isn't ours. Then `kanehack pair`. Pairing stores a token in `~/.kanehack/config.json` (mode 600) and never prints it.
2. Connect Codex: the installer offers this when it finds Codex, or run `kanehack connect codex`. `~/.codex/config.toml` gets the URL `https://www.kaneclihack.sh/mcp` and the headers helper `kanehack mcp-headers`, which prints `{"Authorization":"Bearer …"}` from `~/.kanehack/config.json` each time Codex connects. No token in Codex's config, the environment or the shell history, and re-pairing needs no reconnect. (Use the `www` host: Codex refuses the apex's cross-origin redirect.)
3. In a **new** Codex session, ask "show my Kane Hack OS status". Codex should call `participant_get_status`.

`mcp.json` is the plugin-manifest form of the same server; it reads the token from `KANEHACK_TOKEN` because a manifest can't run a helper. Prefer `kanehack connect codex`.

## Using with Codex

Verified with `codex-cli 0.164.0` (2026-10-23).

1. **Install** (Codex already installed: `npm i -g @openai/codex`): `curl -fsSL https://kaneclihack.sh/install.sh | sh` (Windows: `irm https://www.kaneclihack.sh/install.ps1 | iex`). It puts the 12 skills in `~/.agents/skills`, the folder Codex reads for personal skills, and offers "Connect Codex to the event server?". Under an agent add `--yes` (`-Yes`); `--no-agents` (`-NoAgents`) skips the Codex step.
2. **Pair**: `kanehack pair` (from inside Codex: `kanehack pair --start --json`, approve in your browser, then `kanehack pair --wait --json`).
3. **Connect** (if you skipped it in the installer): `kanehack connect codex`. It backs up `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), adds

   ```toml
   [mcp_servers.kane-hack-event]
   url = "https://www.kaneclihack.sh/mcp"
   http_headers_helper = "'/path/to/node' '/home/you/.kanehack/cli/node_modules/kanehack/bin/kanehack.mjs' mcp-headers"
   ```

   and checks it with `codex mcp get kane-hack-event --json`. It's idempotent, keeps your other keys in that table, and never overwrites a different server named `kane-hack-event` (it tells you to `codex mcp remove kane-hack-event` first). `codex mcp add` isn't used because it can't set a headers helper; its `--bearer-token-env-var KANEHACK_TOKEN` would mean exporting the token into every shell that starts Codex.
4. **Invoke**: start a new Codex session and type `$hack-onboard` (or pick it from `/skills`). Codex also picks a skill by its description when you just ask, e.g. "set me up for Kane Hack Day".
5. **Verify**: `codex mcp list` shows `kane-hack-event`; in a session `/mcp` lists its tools; `/skills` lists the 12 `hack-*` skills; `kanehack doctor` checks `codex`, `codex_skills` and `codex_mcp`.

Codex notes: it reads skills from `.agents/skills` in the repo (cwd up to the repo root), `~/.agents/skills`, `/etc/codex/skills` and also `$CODEX_HOME/skills`. Installer 0.1.2 copied the skills into `~/.codex/skills` too, so Codex listed each one twice; 0.1.3 removes those copies. To turn one skill off: `[[skills.config]]` with `path = "…/SKILL.md"` and `enabled = false` in `~/.codex/config.toml`. The headers helper runs with `sh -c` (Windows: `cmd /Q /D /C`), a 10 s timeout and only PATH/HOME-style variables, which is why it uses absolute paths and reads the token from the config file. If `kanehack doctor` says `codex_mcp` uses an older setup (for example after a Node upgrade moved `node`), run `kanehack connect codex` again.

## When Codex runs the commands

Codex runs commands with no terminal and no stdin, and a long command can hit its time limit. Everything below works there:

```sh
# Install (only after the person agrees). Without --yes nothing is installed when there's no terminal,
# and the summary prints this exact command.
curl -fsSL https://kaneclihack.sh/install.sh | sh -s -- --yes                 # add --no-path / --no-skills / --no-agents to skip those
& ([scriptblock]::Create((irm https://www.kaneclihack.sh/install.ps1))) -Yes  # Windows; or $env:KANEHACK_YES=1 before irm | iex

# Pair in two calls. The person approves in their own browser; never paste tokens into the chat.
kanehack pair --start --json     # prints verification_url + user_code, exits
kanehack pair --wait --json      # 0 paired · 4 not approved yet (run again) · 1 expired/denied · 3 unreachable

kanehack doctor --json           # exit 1 if a check fails
kanehack consent yes             # only after the person says yes in the chat
kanehack report --json -- kane-cli run "…" --agent   # Kane's NDJSON, then one kanehack_report line; exits with Kane's code
kanehack status --json
kanehack submit --preflight --json

# The event MCP server, with no token in Codex's config (the installer offers this too):
kanehack connect codex           # --check: 0 connected · 1 not yet · 2 name taken
```

A long Kane run can outlast a command time limit: run it in the background and read its output when it finishes. On Windows the installer also writes an extensionless `kanehack` shim next to `kanehack.cmd`, for Git Bash. All exit codes and JSON fields: `packages/kanehack/README.md`.

## Before announcing (T-PLG-05)

On a clean macOS user (and Windows, if claimed): install Node, run the installer, pair, `kanehack connect codex`, open a fresh Codex session, confirm the 12 skills are discovered, call `event_get_brief` and `participant_get_status`, and run one `kanehack report` end to end. Record the date, Codex version and result here. Not done yet.
