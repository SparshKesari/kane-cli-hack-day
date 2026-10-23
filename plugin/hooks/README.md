# Optional lifecycle hook (T-PLG-06): off by default

The primary telemetry is direct: `kanehack report` (Kane `--agent` NDJSON + exit code) and GitHub push webhooks. A hook is **supplemental** and **opt-in per person**. Nobody installs it for a participant, and the installer never enables it.

## What it may send

Only this, after the person runs `kanehack hook enable`:

```json
{ "event": "session_start | session_end | kane_run_started", "at": "<ISO time>", "host": "codex" }
```

This is not a run report and never creates evidence, so it does not go to `/api/v1/kane/runs`. It needs a metadata-only endpoint that does not exist yet. Until it does, `kanehack hook enable` refuses and says why. That is deliberate: no hook ships before its endpoint has the same redaction and consent checks as the rest of the API.

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
