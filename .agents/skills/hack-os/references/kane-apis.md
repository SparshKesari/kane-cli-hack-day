# Kane's read-only APIs

Two read-only HTTP APIs serve Kane's data about a team's work. Their app doesn't need them, and nothing in the event
requires them. Offer them when a team wants to:

- **track its progress:** the project's coverage, designed tests and runs, or an exploration's screens and findings as
  it grows;
- **show Kane's results inside the app** it's building, for example a quality panel;
- **build a companion app** beside it, for example a bot that posts new findings or a check on coverage before a merge.

What each API serves:

- **Shared projects API:** a shared project's counts, coverage, use cases, scenarios with their Test Manager cases, runs,
  requirement sources and the traceability graph.
- **Exploration API:** an exploration's map (screens, flows, findings), its runs, live updates while it runs,
  screenshots and evidence files, and the explorer's write-up of how the site works.

Both are for the hackathon and may change after it. The full specs are next to this file:
`references/kane-projects-openapi.yaml` and `references/kane-exploration-openapi.yaml`. Read the spec for exact field
names and example answers before writing code; don't guess a field.

## Rules for both

- **Read-only.** Every route is a `GET`. Nothing here changes a project or an exploration. (One read has a small side
  effect: the first `GET /exploration/labels` for a project creates its default labels.)
- **Sign-in:** the person's TestMu AI username and access key as HTTP Basic auth, the same pair Kane CLI uses
  (`LT_USERNAME` / `LT_ACCESS_KEY`). The key acts as the person. It stays in their environment or an ignored `.env`:
  never in this chat, in code, in a web page or in a commit. Call the APIs from the team's own server or script; a page
  in the browser reads from that server, never from the APIs with the key.
- **Be gentle.** Every team shares these services. Cache answers, keep to the call times below, never loop over every
  item on a timer, and read only the team's own project.
- **Show what came back.** A field can be `null` when there's no value yet: show "not yet", not 0. Ids are opaque
  strings; pass them back exactly. If a call failed, say so; don't fill the gap with a number.
- For Kane CLI commands and flags (designing tests, running them, starting an exploration), use the official Kane CLI
  skill.

## Shared projects API

Base URL `https://kaneai-api.lambdatest.com/v16-lattice`. The project id comes from `kane-cli projects list --agent`,
from `GET /v1/projects`, or from `.testmuai/assurance.json` in a folder linked to the project. A project answers only
after someone has started shared work in it (an extract, a design or a save); before that, `404 NO_CONTEXT`.

Check access once, from their own terminal:

```bash
curl -s -u "$LT_USERNAME:$LT_ACCESS_KEY" \
  "https://kaneai-api.lambdatest.com/v16-lattice/v1/projects/$PROJECT/assurance"
```

| Route | Answers | Call it |
|---|---|---|
| `GET /v1/projects` | the projects they can open; `marked: true` = shared | once at start, cache 1 hour |
| `GET /v1/projects/{projectId}/assurance` | headline counts: use cases, criteria, scenarios, tests, open questions, sources, sessions | every 60 s at most |
| `GET /v1/projects/{projectId}/coverage` | coverage: the project's percent, per use case, per criterion | every 5 min at most |
| `GET /v1/projects/{projectId}/use-cases` | one row per use case, with its coverage (paged, filters) | every 5 min at most, `limit` 50 or less |
| `GET /v1/projects/{projectId}/use-cases/{useCaseId}` | one use case: criteria with citations, scenarios, Test Manager cases | when a person opens it, cache 5 min |
| `GET /v1/projects/{projectId}/scenarios/{scenarioId}` | one scenario: its test's steps, Test Manager case, last run | when a person opens it, cache 5 min |
| `GET /v1/projects/{projectId}/scenarios/{scenarioId}/runs` | a scenario's runs, newest first (paged) | when a person opens it, cache 5 min |
| `GET /v1/projects/{projectId}/sources` | requirement documents and saved conversations | every 10 min at most |
| `GET /v1/projects/{projectId}/sources/{sourceId}` | one source: versions, the use cases citing it | when a person opens it |
| `GET /v1/projects/{projectId}/graph` | the traceability graph, nodes and edges; one scope a call | on demand only, cache 15 min, never poll |

- Lists answer `{ "total", "items", "next" }`: pass `next` back exactly, with the same filters. The project list pages by
  number (`?page=2`).
- Coverage can answer `"state": "computing"`: that's normal. Ask again after 3 s, then 10 s, then 30 s, then stop.
- A graph answer with `"truncated": true` is not the whole project: say more exist.
- Errors are `{"error": {"code", "message"}}`. `400 BAD_REQUEST`: fix the query. `401 UNAUTHENTICATED`: once more after
  30 s, then check the key. `403 PROJECT_NOT_MARKED` and `404 NOT_FOUND` / `NO_CONTEXT`: stop (access given in the last
  5 minutes may not show yet). `409 CONTEXT_IMPORTING`: try again in a minute. `503` (`FORGE_UNAVAILABLE`, `NOT_READY`,
  `HISTORY_BUILDING`): Test Manager or the project isn't ready; back off 3 s, 10 s, 30 s, then stop.

## Exploration API

Base URL `https://kaneai-api.lambdatest.com/v16-controller/v1`; every route is under `/exploration`. Explorations belong
to the person's org; another org's is `404`.

| Route | Answers |
|---|---|
| `GET /exploration?state=all` | the org's explorations, newest first (default `state=running`: only those with a queued or running run); start here for an `exploration_id` |
| `GET /exploration/{id}/sessions`, `/sessions/{run}` | its runs: state (`queued` → `running` → `stopped`), why one ended, credits, findings |
| `GET /exploration/{id}/view/summary` | the map at a glance: counts, runs, labels, and a `change_cursor` for updates. Read this first |
| `GET /exploration/{id}/view/junctions`, `/flows`, `/findings`, `/aliases` | the map as rows: screens, verified flows between them, findings (console errors, broken links, slow pages, accessibility issues…) |
| `GET /exploration/{id}/view/junctions/{item}` (and `/candidates`), `/flows/{item}` (and `/observations`), `/findings/{item}`, `/candidates/{item}` | one item in full |
| `GET /exploration/{id}/view/changes?cursor=<c>` | **updates:** the rows changed since a cursor, and the next cursor |
| `GET /exploration/{id}/view/stream` | **updates:** server-sent events; `event: change` means call `/view/changes` |
| `GET /exploration/{id}/view/screenshot`, `/view/evidence` | a signed URL for one screenshot or one evidence file (clip, timeline, network, console, element) |
| `GET /exploration/{id}/skill` | the explorer's own short write-up of how the site works (markdown) |
| `GET /exploration/{id}/view/feedback`, `/feedback` | notes, labels and verdicts people attached to items |
| `GET /exploration/labels?project_id=<p>` | a project's labels |

- **Following a running exploration:** read `/view/summary`, keep its `change_cursor`, open `/view/stream`, and on each
  `change` event call `/view/changes` with your cursor; keep the `next` it returns. `reset: true` means more than 5000
  rows changed: re-read the pages. A stream ends after 30 minutes: open another. Don't re-read the pages on a timer.
- **Pages:** `/exploration` and `/sessions` take `limit` (1–100) and answer `next_cursor`. The `/view/*` lists come 500
  rows a page: pass `next` back as `cursor` until it's `null`.
- **A past run:** every `/view/*` route and `/skill` take `as_of_run=<run_id>`, the map as it was when that run ended.
- **Screenshots and evidence:** the answer's `url` lives 10 minutes; fetch it **without** the `Authorization` header.
  The map's text has secrets replaced (`REDACTED`, `{email}`); evidence files are served as recorded, so treat them as
  sensitive and don't publish them.
- **Errors** are `{"code", "error"}`. `400 INVALID_REQUEST`: fix the query (unknown parameters are refused).
  `404 NOT_FOUND`: no such exploration or item in their org. `409 EXPLORATION_OUTDATED`: recorded by an older explorer;
  start a new exploration. `503 NOT_READY`: try again later. A `401` from the sign-in check has no `code`.

Then → back to `references/build.md`.
