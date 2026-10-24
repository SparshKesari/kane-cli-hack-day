# Build

## Start building

1. `node <skill>/scripts/state.mjs set-build building`
2. Say exactly: "You're ready to build. Use Kane as you work. Say `$hack-os ready to submit` when you're done."
3. End the turn. Don't wait, sleep, poll or set timers. Building takes hours.

## While building

- **Test with Kane**: use the official Kane CLI skill (`kane-cli`) to pick and write the command. Run it with the person's go-ahead.
- **Record a run for the team**: first `kanehack consent status`. If consent isn't given, ask whether they agree to send a redacted run summary; only if yes, `kanehack consent yes`. Then `kanehack report -- kane-cli run "<objective>" --agent` (the Kane command after `--` exactly as the Kane skill wrote it). Its output is Kane's NDJSON plus a final `kanehack_report` line: `reported: true` means the team's Proof tab has it. A failed test is still a real result; don't hide it.
- **Team's runs so far**: `kanehack status`.
- **Stuck**: `references/help.md`.

Keep your notes at `building` the whole time; help and test requests don't change it.

## "Ready to submit"

1. `node <skill>/scripts/state.mjs set-build ready`
2. `node <skill>/scripts/state.mjs check-version`. If there's a newer skill, ask them to re-run the install command and start a new Codex session: it adds the submission steps.
3. Otherwise call `submission_preflight`. "Already finalized" → tell them it's in and give the receipt. Otherwise show what it lists as missing and send them to the Submit tab on `https://kaneclihack.sh/t/<team-slug>`. Submissions lock at 18:00 Pacific; final evaluation is 16:00–17:00 at their table.
