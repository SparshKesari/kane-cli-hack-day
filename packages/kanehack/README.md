# kanehack

The Kane CLI Hack Day helper. No dependencies; Node 18.17+.

```sh
curl -fsSL https://kaneclihack.sh/install.sh | sh     # macOS / Linux
irm https://www.kaneclihack.sh/install.ps1 | iex      # Windows PowerShell (5.1 needs the www host)
kanehack pair
kanehack doctor
kanehack report -- kane-cli run "Sign up and reach the dashboard" --agent
```

The installer links `kanehack` into a folder that is already on your PATH and writable without sudo (npm's global bin, else `~/.local/bin` or `~/bin`; on Windows a `kanehack.cmd` shim in `npm prefix -g`), so it works in the same terminal right away. It asks first, never replaces a different `kanehack`, and falls back to offering a shell-profile line (Windows: the user PATH) with full-path next steps.

| Command | What it does |
|---|---|
| `pair [--token khk_…] [--api URL]` | Device-code pairing with your account (or a token). Saves `~/.kanehack/config.json`, mode 600. In a terminal it waits until the code expires; without one it waits 90 s, then exits 4. |
| `pair --start` | Starts pairing, prints the approve URL and code, exits. The secret device code stays in `~/.kanehack/pending-pair.json` (mode 600). |
| `pair --wait [--timeout SECONDS]` | Waits for that code (default 90 s). 0 paired, 4 still pending (run it again), 1 expired or denied. |
| `token` | Prints the saved token on stdout, for `export KANEHACK_TOKEN="$(kanehack token)"` (only needed for an agent that can't run a headers helper; prefer `kanehack connect`). Pairing never prints it. |
| `doctor [--report]` | Checks OS, Node, Git, Chrome, Kane CLI, `kane-cli whoami`, the official Kane skill, the hack skills and the API; with Codex installed (or `~/.codex` present) also `codex`, `codex_skills` and `codex_mcp`, and with Claude Code `claude_mcp`, each with its fix. `--report` sends statuses and versions only. Exit 1 if any check fails (agent checks only warn). |
| `connect codex\|claude [--check] [--url URL]` | Adds the event MCP server `kane-hack-event` (`https://www.kaneclihack.sh/mcp`) to Codex (`~/.codex/config.toml`, or `$CODEX_HOME`; backed up first, checked with `codex mcp get`) or Claude Code (`claude mcp add-json -s user`). The config holds the URL and `kanehack mcp-headers` as the headers helper, never the token. Idempotent; a different server with that name is left alone (exit 2). `--check`: 0 connected, 1 not (yet), 2 name taken. |
| `mcp-headers` | Prints `{"Authorization":"Bearer …"}` for the agent's headers helper (Codex `http_headers_helper`, Claude Code `headersHelper`). Exit 2 with a message on stderr if not paired. You don't run this yourself. |
| `report [--evidence FILE] [--objective TEXT] [--commit SHA] [--no-upload] -- <kane-cli …>` | Runs the Kane command as given, streams its stdout through untouched, keeps the **exit code**, then sends a redacted copy of the NDJSON to `POST /api/v1/kane/runs`. Exits with Kane's exit code (127 if the command doesn't exist). |
| `status` | Your team's latest runs, with VERIFIED / unverified. |
| `help "<what's wrong>"` / `help --status H-0042` | Mentor ticket through the event MCP server. |
| `submit --preflight` | What's missing before you can submit (exit 0 ready, 1 not yet). Finalizing needs your confirmation, so it happens on the Submit tab or through your agent. |
| `consent yes\|no\|status` | Allow, stop or show sending run summaries. Asked once on first `report` in a terminal; without a terminal nothing is sent until you run `kanehack consent yes`. |
| `hook status\|enable\|disable` | The optional lifecycle hook. Off; `enable` refuses (exit 2) until its endpoint exists. |
| `version` | Prints the version. |

## Scripts and AI agents (no terminal)

Every command works without a TTY (Claude Code `/remote-control`, Codex, CI): nothing waits for keyboard input, colors are off when stderr isn't a terminal (or `NO_COLOR` is set), and human messages go to **stderr**.

`--json` on any command prints one JSON document on **stdout**: `{ "ok": true|false, "exit_code": n, … }`, and on errors `"error": { "code", "message" }` (codes such as `NOT_PAIRED`, `UNAUTHENTICATED`, `UNREACHABLE`, `REDIRECT`, `PAIR_EXPIRED`, `NO_PENDING_PAIRING`, `USAGE`). For `report`, stdout stays Kane's NDJSON stream and `--json` appends one line `{"type":"kanehack_report","exit_code":…,"reported":…,"run_id":…,"status":…,"source_verified":…,"reason":…}` (`reason` when nothing was sent: `not_paired`, `consent_needed`, `consent_no`, `no_upload`, `unreachable`, `upload_failed`).

| Exit code | Meaning |
|---|---|
| 0 | done |
| 1 | failed / not ready: a doctor check failed, preflight isn't ready, the server returned an error, the pairing code expired or was denied |
| 2 | needs a person: not paired, token rejected or revoked, usage error, a feature that needs a human (`submit` without `--preflight`, `hook enable`) |
| 3 | server unreachable, or it redirected to a different site |
| 4 | pairing still pending: approve the code, then run `kanehack pair --wait` again |
| Kane's | `report` exits with the Kane command's own code (0 passed, 1 failed, 2 nothing ran, 3 timed out) or 127 if it couldn't start |

Pairing from an agent, in two short tool calls that each fit a 2-minute timeout:

```sh
kanehack pair --start --json      # → {"user_code":"ABCD-EFGH","verification_url":"https://www.kaneclihack.sh/pair?code=ABCD-EFGH",…}
# the person opens the URL in their browser, signs in, presses Approve
kanehack pair --wait --json       # exit 0 paired · 4 not yet: run again · 1 expired/denied: start over
```

`KANEHACK_API` overrides the server (the installer's `--site` saves it in the config), `KANEHACK_TOKEN` overrides the saved token.

## What `report` sends, and what it never sends

Sent: the execution / session id, the process exit code, the Kane NDJSON stream after redaction, the objective or test file name, `git rev-parse HEAD`, and the sha256 of `--evidence` (the file itself is uploaded separately, ≤ 4 MB; larger packs go through the Proof tab).

Redacted before sending: GitHub/OpenAI/AWS/Slack-style tokens, JWTs, private keys, `LT_ACCESS_KEY=…`, `Bearer …`, any `"…token…": "…"`-style field, and home-directory paths. The server refuses reports that still look like they contain credentials.

Never sent: prompts, chat transcripts, source files, diffs, environment variables.

## How the server reads it

- Exit code decides: `0` passed, `1` failed, `2` nothing ran (auth/setup), `3` timed out/cancelled.
- No completion event (`run_end`, `test_md_done`, `testrun_done`) → not a pass, whatever the exit code.
- A run is **source-verified** only when it comes from a paired token, for your own team's project, with a completion event and an exit code that agree.
- A failing run opens a **suspected** defect. A teammate confirms it; a later passing run on a different commit re-verifies the fix.

## Release

1. Bump `version` in `package.json` and `VERSION` in `bin/kanehack.mjs` (never replace a published tarball in place).
2. `node scripts/release-kanehack.mjs` (from the repo root). It runs `npm pack` into `public/kanehack-<version>.tgz`, builds a reproducible `public/hack-skills-<version>.tgz` from `plugin/skills` (refusing if the `.agents/skills` mirror differs), and pins `KANEHACK_VERSION`, `KANEHACK_SHA256` and `SKILLS_SHA256` in **both** `public/install.sh` and `public/install.ps1`. `--rebuild` overwrites tarballs of a version that was never deployed.
3. `KANEHACK_API=… APPROVE=mock node tests/installer/kanehack-suite.mjs` against `node tests/installer/mock-server.mjs`, and `sh tests/installer/installer.sh` (see `.github/workflows/installer.yml` for the full matrix).
