# Optional lifecycle hook (T-PLG-06): off by default

The primary telemetry is direct: `kanehack report` (Kane `--agent` NDJSON + exit code) and GitHub push webhooks. A hook is **supplemental** and **opt-in per person**. Nobody installs it for a participant, and the installer never enables it.

## What it may send

Only metadata, after the person runs `kanehack hook enable`:

```json
{ "event": "session_start", "session_id": "<opaque>", "host": "codex", "codex_version": "0.48.0", "model": "gpt-5-codex", "at": "<ISO time>" }
```

This is not a run report and never creates evidence, so it does not go to `/api/v1/kane/runs`. Its metadata-only endpoint is `POST /{team-slug}/status` (the same as `/api/v1/teams/{team-slug}/status`). The schema there is strict: a ping with any field outside the list below is refused (400), not trimmed. Teammates and staff read the result with `GET` on the same path. `kanehack hook enable` still refuses until the CLI side is wired to this endpoint.

```bash
curl -X POST https://www.kaneclihack.sh/orbit/status \
  -H "Authorization: Bearer $KANEHACK_TOKEN" \
  -H "content-type: application/json" \
  -d '{"event":"tool_use","session_id":"<opaque, hashed server-side>","host":"codex","codex_version":"0.48.0","model":"gpt-5-codex"}'
```

Fields: `event` (`session_start` `heartbeat` `tool_use` `kane_run_started` `kane_run_finished` `waiting_for_human` `error` `stop` `session_end`), `session_id`, and optionally `status` (`working` `idle` `waiting_for_human` `error` `ended`), `host`, `codex_version`, `model`, `kane_run_id`, `at`. Identity is the `kanehack pair` bearer token or the TestMu AI key headers (`X-TestMu-Username`, `X-TestMu-Access-Key`). 120 pings a minute per person.

## What it must never send

- chat transcripts, prompts or model output
- source files, diffs, file paths or repository names
- environment variables, tokens, `.env` contents
- anything about other people

## What it must never do

- create release decisions, milestones, defects or public posts
- run in the background without a visible "on" state (`kanehack hook status`)
- stay on after `kanehack hook disable`

## Example config (for when the endpoint exists)

Codex `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "kanehack hook emit session_start" }],
    "SessionEnd": [{ "type": "command", "command": "kanehack hook emit session_end" }]
  }
}
```
