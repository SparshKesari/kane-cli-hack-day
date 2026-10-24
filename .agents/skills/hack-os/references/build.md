# Build

## Start building

1. Only after the idea step: `participant_get_status` shows `idea.saved` true and they've seen the idea check (or turned it down). Otherwise go to `references/idea.md` first.
2. `node <skill>/scripts/state.mjs set-build building`
3. Say exactly: "You're ready to build. Use Kane as you work. Say `$hack-os ready to submit` when you're done."
4. End the turn. Don't wait, sleep, poll or set timers. Building takes hours.

## While building

- **Test with Kane**: use the official Kane CLI skill (`kane-cli`) to pick and write the command. A command or flag Kane doesn't recognize usually means an older Kane CLI: `kane-cli --version`, then `npm install -g @testmuai/kane-cli@rc`. Run it with the person's go-ahead. If `~/.kanehack/os/idea-check.json` exists, its example objectives and Kane upgrade path are a good first run and next step; warn before anything that costs credits. Read `references/kane-apis.md` alongside the Kane CLI skill: once Kane has runs or designed tests, its APIs can track the team's progress.
- **Record a run for the team**: first `kanehack consent status`. If consent isn't given, ask whether they agree to send a redacted run summary; only if yes, `kanehack consent yes`. Then `kanehack report -- kane-cli run "<objective>" --agent` (the Kane command after `--` exactly as the Kane skill wrote it). Its output is Kane's NDJSON plus a final `kanehack_report` line: `reported: true` means the team's Proof tab has it. A failed test is still a real result; don't hide it.
- **Team's runs so far**: `kanehack status`.
- **Kane's data, if they want it**: to track their progress (coverage, designed tests, runs, an exploration as it grows) and show it to the event team, show Kane's results inside their app, or build a companion app, read `references/kane-apis.md`: two read-only APIs, called with their own key from their own server or script. Their app doesn't need them.
- **Stuck**: `references/help.md`.

Keep your notes at `building` the whole time; help and test requests don't change it.

## "Ready to submit"

1. `node <skill>/scripts/state.mjs set-build ready`
2. `node <skill>/scripts/state.mjs check-version`. If there's a newer skill, ask them to re-run the install command and start a new Codex session, then carry on.
3. Call `submission_preflight`. "Already finalized" → tell them it's in and give the receipt, and stop.
4. Otherwise show what it lists as missing, and the list under "Submission and launch assets" in `SKILL.md`.
5. **Link their Kane runs.** A run sent with `kanehack report` counts only once the submission links it; until then "Kane run report / evidence" stays missing. `kanehack status` lists the runs (KR-12). Either they tick the runs under "Kane runs for this project" on the Submit tab, or, with their yes to the exact list, call `team_page_update` with their ids in its kane_run_ids field (plus repo_url and commit_sha; the full SHA is `git rev-parse HEAD`, after they push).
6. **Draft the text fields.** The Submit tab's One-line pitch, Live demo URL or run command, Harness description, Kane components (tick boxes) and Known limitations have no event tool. Draft each one from what you know of their project, show the drafts, and the captain pastes them on the Submit tab.
7. **Launch assets**: for the posts, blog, Show HN title and outline, deck and video, hand over to `$hack-gtm`: tell them to type `$hack-gtm` (or ask "write our launch posts") and give it the project details you already know.
8. **The demo video is a link.** "Demo video URL" takes YouTube, Loom or any https video, not a file. For `$hack-gtm`'s `launch/video/showcase.mp4` (or any .mp4/.webm up to 50 MB): show them the file and ask whether it can be public; only after their yes, `kanehack publish <file> --yes --json`, and its `public_url` goes into "Demo video URL" (or `team_page_update` with `video: {"public_evidence_id": "PE-n"}` for the Ship Page). The same command publishes a screenshot or a run report they approve. Never publish a `.evidence` pack: it holds cookies and auth headers, and `kanehack publish` refuses it. Screenshots for the submission itself go up with "Add screenshots" on the Submit tab.
9. **Shipped prize bundle, before the captain finalizes.** The shipped prize counts only from the Submit tab's "Shipped prize bundle" checklist, not from `submission_preflight`. A signed-in teammate pastes each live link (repo, live URL or run command, Kane CLI run report, and at least two of video, blog, X post and Show HN post), ticks the row and presses Save; a tick without a link is refused. Finalizing records whether the bundle was met, so it has to be filled first.
10. The captain finalizes on the Submit tab, `https://kaneclihack.sh/t/<team-slug>/submit`. Submissions are due at 18:00 Pacific (the server still accepts a late one); final evaluation is 16:00–17:00 at their table.
