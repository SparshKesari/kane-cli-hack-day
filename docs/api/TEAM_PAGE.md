# Team submission page API

The team's submission page is the public showcase at **`/ship/{slug}`**. This API reads and
writes what that page shows: repo and commit, a one-pager, the demo video, the deck, public
evidence, Kane runs and share links. It never publishes and never changes who can see the page.
A person does that in the browser.

- REST: `GET` and `PUT` `/api/v1/teams/{id|slug}/page`
- MCP (`/mcp`): `team_page_get` and `team_page_update`, with the same rules and the same envelope
- One-pager: `GET /ship/{slug}/one-pager`, sandboxed HTML

Related: [ENDPOINTS.md](ENDPOINTS.md) (every endpoint), [TESTMU_ACCESS.md](TESTMU_ACCESS.md)
(the TestMu AI key), `PUBLIC_EVIDENCE.md` (uploading the `PE-n` objects this page references).
Source: `src/server/team-page.ts`, `src/app/api/v1/teams/[id]/page/route.ts`,
`src/app/ship/[slug]/one-pager/route.ts`, `db/038_team_page.sql`.

## Quick start

```bash
# Read: note page_version and canonical_url.
curl -s https://kaneclihack.sh/api/v1/teams/acme/page \
  -H "Authorization: Bearer $KANEHACK_TOKEN"

# Write: send only the fields you want to change.
curl -s -X PUT https://kaneclihack.sh/api/v1/teams/acme/page \
  -H "Authorization: Bearer $KANEHACK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: acme-page-2026-10-24-01" \
  -d '{
    "expected_version": 0,
    "repo_url": "https://github.com/acme/harness",
    "commit_sha": "4f2c0d1e9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
    "one_pager_html": "<!doctype html><html><head><style>body{font:16px system-ui}</style></head><body><h1>Acme</h1></body></html>",
    "video": { "public_evidence_id": "PE-41" },
    "deck": { "hosted": true },
    "evidence_ids": ["PE-42", "PE-43"],
    "kane_run_ids": ["KR-1207"],
    "share_links": ["https://kane.lambdatest.com/share/abc123"]
  }'
```

Then show the participant `data.canonical_url` and every entry in `actions` (each needs a person).

## Auth and who can do what

| Caller | Read | Write |
|---|---|---|
| A current member of the team (roster) | yes | yes, until `submission_locks_at` |
| Staff (mentor, photographer, judge, organizer, admin) | yes | no |
| Organizer or admin | yes | yes, also after the lock |
| Anyone else | `403 FORBIDDEN` | `403 FORBIDDEN` |
| Nobody signed in | `401 UNAUTHENTICATED` | `401 UNAUTHENTICATED` |

How the caller is identified:

- **Agents and the CLI:** `Authorization: Bearer <token>` from pairing (`kanehack pair`). The token
  says which member is calling. MCP tools always run as the token's member.
- **TestMu AI key headers** (`X-TestMu-Username` + `X-TestMu-Access-Key`) without a bearer also identify
  the member. When `TESTMU_KEY_REQUIRED=true`, a TestMu key is needed on every `/api` call in
  addition to the bearer. See [TESTMU_ACCESS.md](TESTMU_ACCESS.md).
- **Browser:** the member and staff cookies.

Every write is one database transaction with an `audit_events` row (`action = team_page.update`,
`resource_type = team_page`, `resource_id` = project id). The audit row records the actor, the
changed fields, `after_lock` and `by_organizer`. It stores the one-pager's sha256, never the HTML.

## Team id or slug

`{id|slug}` in the path is the team's numeric id when it is all digits, otherwise the team slug.
Both address the same page. For MCP, `team` is optional and defaults to the caller's own team.

The public page uses the **project slug** (`data.slug`). It starts equal to the team slug
(`data.team_slug`). If an organizer renames it, the old `/ship/{old}` URLs redirect. Never build
the URL yourself: use `data.canonical_url`.

## Canonical URL

`data.canonical_url` is the absolute Ship Page URL, `https://kaneclihack.sh/ship/{slug}` in
production. It is the one URL to share, put in the X post, and store as the page receipt. There is
no public `/t/{team-id}` page. `/t/{slug}` is the team's private hub.

## GET /api/v1/teams/{id|slug}/page

Returns the envelope with `data` shaped like this:

```jsonc
{
  "team_id": 12, "team_slug": "acme", "team_name": "Acme",
  "project_id": 34, "slug": "acme",
  "page_version": 3,                       // bumps on every write through this API that changes something
  "canonical_url": "https://kaneclihack.sh/ship/acme",
  "visibility": "draft",                   // draft | unlisted | public | hidden_by_moderation
  "repo_url": "https://github.com/acme/harness",
  "commit_sha": "4f2c0d1e9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
  "video": { "source": "public_evidence", "public_evidence_id": "PE-41", "url": "https://…/demo.mp4",
             "kind": "video", "content_type": "video/mp4", "sha256": "…" },
           // or { "source": "url", "url": "https://youtu.be/…" }, or null
  "deck": { "hosted": true, "hosted_url": "https://kaneclihack.sh/ship/acme/deck", "published_version": null },
          // or { "deck_id": 34, "version": 2, "status": "draft|approved|published|archived|missing", "hosted_url": …, "published_version": … }, or null
  "one_pager": { "sha256": "…", "bytes": 5120, "saved_at": "2026-10-24T20:01:02.000Z", "public": false },
  "one_pager_url": "https://kaneclihack.sh/ship/acme/one-pager",
  "evidence_ids": ["PE-42", "PE-43"],
  "evidence": [{ "id": "PE-42", "kind": "screenshot", "url": "https://…", "sha256": "…", "size_bytes": 81234,
                 "content_type": "image/png", "run_id": 1207, "commit_sha": "4f2c…" }],
  "unavailable_evidence_ids": [],          // stored ids that are no longer public (removed or rejected)
  "kane_run_ids": [1207],
  "kane_runs": [{ "id": 1207, "ref": "KR-1207", "status": "passed", "source_verified": true, "commit_sha": "4f2c…" }],
  "share_links": [{ "url": "https://kane.lambdatest.com/share/abc123", "added_at": "…", "expires_at": "…", "state": "expires" }],
  "submission": { "status": "draft", "receipt_code": null, "finalized_at": null },   // or null before any save
  "statuses": { "repo": "linked", "one_pager": "linked", "video": "linked", "deck": "linked", "evidence": 2, "published": false },
  "published": null,                       // or { "published_at": "…" } once visitors can see the Ship Page
  "locked": false, "locks_at": "2026-10-25T01:00:00.000Z",
  "updated_at": "…",
  "receipt": null,                         // set on PUT
  "warnings": []
}
```

### Statuses

`data.statuses` is the server's view. Keep the skill's own local statuses (generated, uploaded)
separate from these.

| Field | Values |
|---|---|
| `repo` | `missing` (no repo URL), `no_commit` (repo but no SHA), `linked`, `submitted` (frozen in the finalized submission) |
| `one_pager` | `missing`, `linked` (saved, page not published), `pending_publish` (page published, but this save came after the publish, so visitors don't see it), `published` (visitors see it) |
| `video` | `missing`, `linked`, `submitted` |
| `deck` | `missing` (no reference), `linked`, `published` (the hosted deck at `/ship/{slug}/deck` is live for visitors) |
| `evidence` | number of referenced objects that are still public |
| `published` | `true` when visitors can open the Ship Page: published, `public` or `unlisted`, and not hidden |

The envelope's `actions` lists what only a person can do next, each with
`requires_human_confirmation: true`:

- `finalize_in_browser` (tool `submission_finalize`): until the submission is finalized. The captain does it at `/t/{team_slug}/submit#finalize`.
- `publish_in_browser` (tool `showcase_publish`): while the page isn't published, or while the one-pager is `pending_publish`. A teammate does it at `/studio/{team_slug}#publish`.

`status` is `needs_action` while either step is open, otherwise `ok`. A `needs_action` write still
succeeded: check `data.receipt`.

## PUT /api/v1/teams/{id|slug}/page

An idempotent upsert. There is one page per team, so repeating a call never creates a second page.

- **Omitted** field: unchanged.
- **`null`**: clears the field (lists become empty).
- Unknown fields are refused (`400`), so a typo can't be silently dropped.
- The `Idempotency-Key` header is the same as the `idempotency_key` field.

| Field | Type | Rules | Stored in |
|---|---|---|---|
| `repo_url` | string \| null | `https://github.com/{owner}/{repo}` (optional `.git` or trailing `/`), up to 500 characters | submission draft `repo_url`, mirrored to `projects.repo_url` |
| `commit_sha` | string \| null | the full 40-hex SHA. Upper case is lowered | submission draft `commit_sha` |
| `one_pager_html` | string \| null | up to 256 KB (262,144 bytes UTF-8). Empty or whitespace clears it | `team_pages.one_pager_html` |
| `video` | object \| null | exactly one of `{ "public_evidence_id": "PE-n" }`, a **public** object of **this team** with kind `video`, or `{ "url": "https://…" }` on `youtube.com`, `youtu.be`, `loom.com` or `vimeo.com` (and their subdomains) | submission draft `video_url` (the object's public URL for `PE-n`) |
| `deck` | object \| null | `{ "version": n }`, a saved deck version of this team (`deck_versions`, written by `deck_update` or the Studio). `deck_id` may be sent and must be the team's project id. Or `{ "hosted": true }`: the hosted deck at `/ship/{slug}/deck` (the published deck, or the default deck generated from the published story) | `team_pages.deck` |
| `evidence_ids` | string[] \| null | up to 50 `PE-n` ids, each a **public** object of **this team**. Duplicates are dropped and order is kept | `team_pages.evidence_ids` |
| `kane_run_ids` | (number \| string)[] \| null | up to 50 of this team's Kane runs, as `1207` or `"KR-1207"` | submission draft `kane_run_ids` |
| `share_links` | string[] \| null | up to 20 https links on `lambdatest.com` or `testmuai.com` (and subdomains) | `team_pages.share_links` |
| `expected_version` | integer ≥ 0 | optional optimistic lock, see below | |
| `idempotency_key` | string, 8 to 200 characters | optional, see below | |

Share links: TestMu AI / Kane share links last 7 days. Each link gets `added_at` (server time when
first sent) and `expires_at = added_at + 7 days`. Sending the same URL again keeps its dates. The
readback shows `state: "expires"` until then and `"expired"` after. An expired link is kept and
labeled, never deleted for you.

The response is the same as GET, with `data.receipt` and `data.replayed`:

```json
"receipt": { "id": "PAGE-12-v4", "server_time": "2026-10-24T20:01:02.000Z", "page_version": 4,
             "changed": ["repo_url", "one_pager_html", "video"] }
```

`changed` uses the request's field names. It is empty when nothing changed, and then the version
does not move.

### Idempotency and concurrency

- **`idempotency_key`:** the first call with a key does the write. Any later call with the same key for
  the same team returns the **same receipt** (`data.replayed: true`) without writing or bumping the
  version, even if the body differs. The rest of `data` is the current page. Use one key per
  intended change and reuse it on every retry or resume of that change. While the first call is
  still running, a retry gets `409 CONFLICT` ("still being processed"). Retry after a moment.
- **Natural idempotency:** a write whose values equal what's stored changes nothing and doesn't bump
  `page_version`, so a resume that resends the same payload is safe even without a key.
- **`expected_version`:** when sent and different from the current `page_version`, the write is
  refused with `409 CONFLICT` and `error.details = { current_version, expected_version }`. Re-read,
  merge, and retry with `expected_version = current_version`. Omit it only for last-write-wins.
- `page_version` counts changes made through this API. An edit on the web Submit tab changes the same
  draft fields (repo, commit, video, Kane runs) without bumping `page_version`. The readback always
  shows the current values.

### Processing

Writes are synchronous. There are no jobs to poll. When the response arrives, the readback in it is
the state of the page.

## Errors

Every error is the standard envelope with `status: "error"` and `error = { code, message, next_action, manual_route, details }`.

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad field, unknown field, or a reference that isn't this team's. `details.issues[] = { path, message }`. For refused references, `details.refused` lists them (`PE-n`, run ids, deck versions). The same message is used whether an object belongs to another team or doesn't exist |
| 401 | `UNAUTHENTICATED` | No or bad bearer token, or nobody signed in |
| 401 | `TESTMU_KEY_REQUIRED` | The TestMu AI key gate is on and no valid key was sent |
| 403 | `FORBIDDEN` | Not on this team, or staff other than organizers trying to write |
| 404 | `NOT_FOUND` | No team with that id or slug, or the team has no project record |
| 409 | `CONFLICT` | Stale `expected_version` (`details.current_version`), a change to a repo, commit, video or Kane runs after the submission is finalized (`details.receipt_code`, `details.fields`), or the same `idempotency_key` still being processed |
| 423 | `SUBMISSION_LOCKED` | A participant write after `submission_locks_at` (`details.locks_at`, `details.server_time`, both server clock) |
| 500 | `INTERNAL` | Our fault. Retry with the same `idempotency_key` |

## Visibility and approval

This API **never publishes** and never changes `visibility`. Those stay the existing human steps
in the browser:

- **Finalize** (`/t/{team_slug}/submit#finalize`, the captain, typed team name). It freezes the
  submission and publishes the Ship Page story unless the team opts out.
- **Studio publish** (`/studio/{team_slug}#publish`, any teammate, typed slug, consent check).
- **Visibility** (`public`, `unlisted`, off) is set on the Submit tab. `hidden_by_moderation` is organizer-only.

What visitors see:

- `/ship/{slug}` shows the **published story** only when the page is `public` or `unlisted`. Draft
  changes written by this API show to the team and organizers as a draft preview, never to visitors.
- **The one-pager** is visible to visitors only when the Ship Page is published (`public` or
  `unlisted`, not hidden) **and** the one-pager was saved **at or before the latest publish**. A save
  after the publish stays private (`one_pager: "pending_publish"`) until a teammate publishes again.
  Until then visitors get `404`. Clearing it (`null`) takes it down at once. Team members and staff
  always see the latest save.
- Evidence ids, share links and the readback itself are never public. Only team members and staff can GET.

### The one-pager: `GET /ship/{slug}/one-pager`

- The response is the stored HTML, unchanged, served as `text/html; charset=utf-8` with:
  - `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: private, no-store`
- `sandbox allow-scripts` without `allow-same-origin` gives the page an **opaque origin**. It can't
  read cookies or storage, or reach the site. It has no forms, popups or top navigation, and no
  network (`fetch` and XHR are blocked). It is the Studio's custom deck HTML sandbox, plus `https:` media.
- So write the one-pager **self-contained**: inline `<style>` and `<script>`, fonts as `data:` URIs,
  images and video from `https:` (for example your `PE-n` public URLs) or `data:`. External
  stylesheets, script files, web fonts and iframes won't load. Links can't open new tabs (no
  popups), so also send the repo, video and deck as their own fields.
- `/ship/{slug}` embeds it in `<iframe sandbox="allow-scripts">` below the hero stats (after the layout on other Ship templates), with an
  "Open the one-pager" link. The embed shows only for viewers who can load it.
- Anyone who may not see it gets `404`, so private drafts can't be probed. An old slug gets a `308`
  redirect to the new one.

## Relation to the final submission, the Ship Page and the deck

- **One source of truth.** Repo, commit, video and Kane runs are the **same fields** the Submit tab
  edits (the team's submission draft). Writing them here is the same as saving them there. They show
  in the `/ship` draft preview and in the submission preflight. Only the one-pager, evidence ids,
  share links and the deck reference live in `team_pages`.
- **Finalize freezes the submission.** The finalized submission's `immutable_snapshot`, its sha256
  and signature never change (enforced by the database trigger in `db/008`). After finalize, a
  write that would **change** repo, commit, video or Kane runs is `409 CONFLICT` with the receipt
  code. Sending the same values again is fine. The one-pager, evidence ids, deck reference and share links can still change
  until the lock. They aren't part of the signed snapshot.
- **Lock.** After `submission_locks_at` (server clock), participant writes are `423 SUBMISSION_LOCKED`.
  Organizers can still write, and each such write is audited with `after_lock: true`.
- **Ship Page story.** Finalize builds and publishes the public story from the same draft fields:
  repo link, commit link, the video and the linked Kane runs as proof. Studio publish publishes an
  edited story. `PE-n` evidence and share links aren't in the story. The readback returns them,
  and the one-pager can link them.
- **Deck.** The hosted deck is `https://kaneclihack.sh/ship/{slug}/deck` (`data.deck.hosted_url`).
  Visitors can open it once the Ship Page is published. Finalize pins the latest approved or
  published deck version into the snapshot regardless of `deck` here. `deck` records which deck the
  team points at, and `statuses.deck` says whether the hosted one is live.
- **X post.** The v2.5 X policy needs the Ship Page URL and the hosted deck URL in the team's post. Use
  `data.canonical_url` and `data.deck.hosted_url`. They're the existing `/ship/{slug}` and
  `/ship/{slug}/deck` URLs, so nothing changes for eligibility (`GET /api/v1/teams/{id|slug}/eligibility`).

## MCP tools

Both return the same envelope as REST. `fallback.text` is a plain-text summary that works in a terminal.

- `team_page_get { team? }`. Read-only.
- `team_page_update { team?, repo_url?, commit_sha?, one_pager_html?, video?, deck?, evidence_ids?, kane_run_ids?, share_links?, expected_version?, idempotency_key? }`.
  Same rules as PUT, except that the MCP transport silently drops unknown arguments (for example
  `video_url`) instead of refusing them. Check `data.receipt.changed`.

## What the skill should do

1. `team_page_get`, then keep `page_version`, `canonical_url` and `slug`.
2. Upload public evidence first (`PUBLIC_EVIDENCE.md`) and use its `PE-n` ids. Never invent ids or URLs.
3. `team_page_update` with `expected_version` and one `idempotency_key` per intended change. On a
   lost response, retry with the **same** key. On `409` with `current_version`, re-read and merge.
4. Show `canonical_url` and the `actions`. A person finalizes and publishes in the browser.
5. If the API is unreachable, keep the manifest locally and report `page_creation=pending`. Never
   claim the page exists without a receipt (`data.receipt.id`).
