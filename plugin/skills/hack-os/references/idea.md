# Idea

The idea locks at 12:00 Pacific (check `event_get_brief`). The challenge: build anything with an AI coding agent, and use Kane CLI to verify it in a real feedback loop. The creation can itself be the validation harness.

1. Help them write it in 2–5 sentences: what they're building, who it's for, and how Kane CLI checks it (which flows, what result counts as pass).
2. Show the exact text and ask before sending it. Then `idea_validate` with `project_idea` (20–2000 characters) and `publication_intent: "private"` unless they choose `share_summary`. It's advisory: say so, and never call it a score.
3. Go through the suggested changes with them. Rerun only if the idea changed.
4. `idea_check_overlap` shows similar opted-in ideas from other teams, if they want to see them.
5. They save it on their team's Idea tab, `https://kaneclihack.sh/t/<team-slug>/idea` (product name, app type, description, Kane CLI plan). The skill can't save it for them.

Then → `references/build.md`.
