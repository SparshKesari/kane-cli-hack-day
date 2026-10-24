# KANE HACK OS — foundation contracts

Read this before writing code in your area. Binding decisions are at the top of [`PLAN.md`](PLAN.md). The task ids are in [`TASKS.md`](TASKS.md).
If a contract here is wrong or missing, **don't fork it in your branch**. Tell the manager, who changes it once on `hack-os`.

---

## 0. Ground rules

- **Migrations.** `db/005–012` are the foundation. Engineers use **only their reserved numbers** (§6). Every file must be idempotent (`if not exists`, `on conflict do nothing`, `do $$ … exception when duplicate_object`), because `scripts/migrate.mjs` re-applies **every** file on each run. One-shot backfills are guarded with a `settings` key `backfill:<file>_<what>` (see 010). Nobody runs migrations against `DATABASE_URL` (the live DB). Write the SQL only. To test locally, use a throwaway Postgres (`initdb` + `psql -h 127.0.0.1`).
- **Migrations must be applied before this branch is deployed.** `registerTeam` now writes `team_memberships`, `projects`, `ideas`, `member_consents` and `members.email_hash`.
- **Service layer.** Put one file per domain in `src/server/<domain>.ts`, with one exported function per use case (`createHelpTicket`, `finalizeSubmission`…). Server actions (`actions.ts` next to the page), `/api/v1/*` route handlers and `/mcp` tools are thin wrappers that call it. RBAC, deadlines, consent, idempotency and audit live **in the service function**, never only in the UI.
- **Every mutation:** validate input with zod (`parse`) → check role and team scope (`requireMember` / `requireTeamMember` / `requireRole` / `requireBearer`) → `idempotent()` when it can be retried → `withAudit()` (or `writeAudit` inside your own transaction) → return a receipt `{ id, server_time }`.
- **Clock.** Use `serverNow()` / `getEvent().now` / SQL `now()`. Never use `Date.now()` for a deadline decision.
- **Style.** Match the surrounding code: comment density, `query()` helper, `PageProps<"/route">` / `LayoutProps<"/route">` globals (run `npx next typegen` after adding routes), `Suspense` around anything that reads cookies or params (`cacheComponents: true`), and `"server-only"` in server modules.
- **Next 16.** Check `node_modules/next/dist/docs/` before using an API you are unsure of. Middleware is now `proxy.ts`. Use `redirect`/`notFound`/`unstable_rethrow` from `next/navigation`. `refresh()` from `next/cache` re-renders after an action.
- **No new npm deps.** Already installed: `zod@4`, `qrcode`, `ai@7`, `@modelcontextprotocol/sdk`.
- **Never** deploy, push, touch Vercel/DNS, or edit `.env*`. List new env vars in your result.

---

## 1. Helpers (signatures)

### `src/server/core.ts`

```ts
serverNow(): Promise<Date>                                   // SELECT now()

ERROR_CODES / type ErrorCode                                 // stable codes, each { status, userMessage, nextAction, manualRoute }
  PAIR_EXPIRED NOT_APPROVED CONSENT_REQUIRED TEAM_FULL PRIVACY_RESTRICTED KANE_RUN_UNVERIFIED
  SUBMISSION_LOCKED DOWNSTREAM_DEGRADED RENDER_PENDING RENDER_FAILED IDEMPOTENT_REPLAY
  OUTAGE_MANUAL_RECEIPT_REQUIRED
  + VALIDATION_FAILED UNAUTHENTICATED FORBIDDEN NOT_FOUND CONFLICT DEADLINE_PASSED FEATURE_DISABLED RATE_LIMITED INTERNAL
class AppError(code, { message?, userMessage?, details? })   // .code .status .userMessage .nextAction .manualRoute .toJSON()
toAppError(err): AppError                                    // ZodError→VALIDATION_FAILED, pg 23505→CONFLICT, 42501→FORBIDDEN, else INTERNAL (logged)

type Actor = {type:"member",id,label?,teamId?} | {type:"staff",id|null,role,label?} | {type:"token",id,memberId,…} | {type:"system"|"pipeline"|"anonymous"}
writeAudit(actor, { action, resourceType, resourceId, reason?, before?, after?, payload?, requestId? }, db = pool)
withAudit<T>(actor, action, resourceType, async (tx) => ({ result, resourceId, before?, after?, reason?, payload? }), { requestId? }): Promise<T>
transaction<T>(async (tx) => T): Promise<T>
idempotent<T>(key | null, scope, fn): Promise<{ result: T; replayed: boolean }>   // scope e.g. `submission.finalize:team:42`
sha256(s), stableStringify(v), emailHash(email), maskEmail(email)

parse(schema, input)        // throws AppError VALIDATION_FAILED with details.issues[{path,message}]
formObject(formData)        // FormData → object (repeated keys → arrays)
z                           // re-export of zod
zx.id | zx.text(max) | zx.optText(max) | zx.httpsUrl | zx.commitSha | zx.slug | zx.idempotencyKey | zx.checkbox | zx.email

DESIGN_VERSION = "kane-hack-os@1"
toEnvelope({ status?, message, data?, evidence?, actions?, links?, uiType?, uiResource?, fallbackText?, freshness?, warnings?, error?, requestId?, serverTime? }): Envelope
  → { schema_version:1, status:"ok"|"needs_action"|"partial"|"error", message, data, evidence[], actions[{id,label,requires_human_confirmation,href?,tool?}],
      links[{label,url}] (https allowlist only), ui_resource, ui_type, design_version, fallback:{text}, freshness:{as_of,state,source?}|null,
      warnings[], error, request_id, server_time }
envelopeResponse(async () => envelopeInput): Promise<Response>   // for /api/v1 route handlers; maps AppError → HTTP status
runAction(async () => data | { data, receipt }): Promise<ActionResult>   // for server actions; rethrows redirect/notFound
siteUrl(path)                                                // SITE_URL (default https://kaneclihack.sh)
type Receipt = { id: string; server_time: string }
```

### `src/server/auth.ts` (identity and roles)

```ts
type Role = "participant" | "mentor" | "photographer" | "judge" | "organizer" | "admin"
getMember(): MemberRow | null          // hd_member cookie, or the team cookie's picked member (must still be on that team)
getStaff(): Staff | null               // hd_staff cookie (re-checked active in DB) or legacy ADMIN_PASSWORD cookie → { id:null, role:"admin" }
getViewer(): { member, team, staff }
requireMember(): MemberRow             // throws UNAUTHENTICATED
requireTeamMember(slug, { allowStaff? }): { team, member|null, staff|null }   // allowStaff = organizer/admin read-only (member null)
requireRole(...roles): Staff           // admin passes everything
hasRole(staff, ...roles): boolean
memberActor(m) / staffActor(s) / tokenActor(bearer)          // → Actor for audit
upsertStaff({ email, name, role, active? }, actor) / issueStaffLoginCode(staffId, actor) → "XXXX-XXXX" (shown once)
staffLoginWithCode(email, code) / adminPasswordLogin(password) / staffLogout() / memberLogout()
newToken("bearer"|"pairing"|"badge"|"phone_handoff") → "khk_…" ; tokenHash(token) → store this only
authenticateBearer(req): { tokenId, scopes, member } | null  // member_tokens kind='bearer', not revoked/expired
requireBearer(req)                                           // throws UNAUTHENTICATED
randomCode(n)                                                // unambiguous A-Z2-9
```

`src/lib/session.ts` adds `get/set/clearMemberSession({ memberId })` (cookie `hd_member`) and `get/set/clearStaffSession` (cookie `hd_staff`, 14h).
`isAdmin()` is now true for the legacy admin cookie **or** a staff session with role organizer or admin. The existing team cookie (`hd_team` = `{teamId, memberId}`) is unchanged.
Staff log in at **`/ops/login`** (email + one-time code, or `ADMIN_PASSWORD`). Seed staff with `node --env-file=.env.local scripts/seed-staff.mjs <email> "<name>" <role>`, or with `upsertStaff`/`issueStaffLoginCode` from `/ops/settings`.

### `src/lib/event.ts` (official clock)

```ts
getEvent(): HackEvent    // { id, slug, name, timezone, startsAt, teamLockAt, ideaLockAt, verifyAt, submitAt, submissionLocksAt,
                         //   demosStartAt, endsAt, phaseOverride, phase, phaseSource, publicStatus, isDemo, now (DB), fallback }
PHASES = arrival | build | verify | submit | showtime | recap
derivePhase(now, e)      // <teamLock arrival · <locks-2h build · <locks-1h verify · <locks submit · <endsAt showtime · recap
isLocked("team"|"idea"|"submission", e?) / lockTime(e, kind) / msUntil(e, kind) / formatEventTime(d, e?)
```

The seed values are 2026-10-24 America/Los_Angeles: starts 09:30, team lock 11:00, idea lock 12:00, submission lock 18:00, demos 18:00, ends 20:30. To set an override, write `hack_events.phase_override` (ops/settings) and audit it.

### `src/lib/flags.ts`

`getFlags()`, `isEnabled(flag)`, `requireFlag(flag)` (throws FEATURE_DISABLED), `setFlag(flag, on)` (the caller audits). Flags are stored in `settings` as `flag:<name>` and cached for 15s.
Flags: `activation match idea kane_ingest live_sse ship_pages deck photo_studio mcp` default **on**. `social_publish video` default **off**. Check-in, help and submission are **never** flagged.

### `src/server/ai.ts`

`draftObject({ schema, system, prompt, fallback })` and `draftText({ system, prompt, fallback })` return `{ value, generator: "llm"|"rules", model, warning? }`.
They use the AI Gateway with `HACKOS_MODEL` (default `openai/gpt-5-mini`) and a 20s timeout. They fall back to your deterministic `fallback()` and update `integration_state('ai_gateway')`. Show `generator` in the UI ("Advisory draft", "Rule-based draft").

---

## 2. Design primitives (keep the site theme)

Tokens (`globals.css`, Tailwind classes `bg-*/text-*/border-*`): `ink bright lightgray hairline surface lime lime-deep` plus new `surface-2 card verified verified-deep warning warning-deep danger danger-deep`.
**Lime = action / you-are-here only. Teal = evidence-backed success, always ✓ + the word VERIFIED. Amber = waiting on a human or deadline. Red = confirmed failure. Grey outline = suspected / unverified.**

| Component | Path | Notes |
|---|---|---|
| `StatusPill tone="verified|pending|danger|suspected|unverified|accent"` | `components/ui/StatusPill.tsx` | Always glyph + text. Default words VERIFIED / PENDING / FAILED / SUSPECTED / UNVERIFIED / NEXT. |
| `DegradedServiceAlert state="delayed|stale|degraded|offline|down" system manualRoute` | `components/ui/DegradedServiceAlert.tsx` | Says what still works and links the manual route. |
| `FreshnessStamp asOf now? staleAfterSec? state? source?` + `freshnessOf()` | `components/ui/FreshnessStamp.tsx` | Pass **server** now. |
| `DemoDataChip fixed?` | `components/ui/DemoDataChip.tsx` | Required wherever `is_demo` is true. |
| `QR value label caption? size?` (async server component) | `components/ui/QR.tsx` | Inline SVG, dark on light. Encode no PII. |
| `Ring value denominator? label tone?` | `components/ui/Ring.tsx` | `null` shows "—", never 0. |
| `Flip front back label?` (client) | `components/ui/Flip.tsx` | Passport flip. Keyboard-accessible, respects reduced motion. |
| `SegmentedControl options value onChange label` (client) | `components/ui/SegmentedControl.tsx` | radiogroup with arrow keys. |
| `Toggle name label description defaultChecked|checked onChange` | `components/forms/fields.tsx` | One per consent category. Posts `name=on`. |
| `ConfirmByTyping phrase name? label? children={(matched)=>…}` | `components/forms/fields.tsx` | Finalize / publish / freeze. The server re-checks the typed value. |
| `.print-paper`, `@media print`, `.no-print`, `.print-break`, `.print-avoid-break` | `globals.css` | Ink-on-white paper output. |
| `.flip-card*`, global `:focus-visible` lime outline | `globals.css` | |

Existing primitives you can reuse: `Button`, `PageHeader`, `Section/Eyebrow/SectionHeading/Fold`, `StepBlock`, `CopyField`, `Decode`, `Reveal`, `SmartLink`, `inputCls/Label/SubmitButton/FormError`, the `brackets` utility, and fonts `font-display` (Inter Tight), `font-plex`, `font-dots`, `font-pixel`.
Tap targets must be ≥44px (`min-h-11`). Don't use the blueprint's paper / ultraviolet / Georgia / rounded shells. Don't fabricate logos. The TestMu mark comes only from `public/logos`.

Hub tabs (`src/lib/hub.ts`): Dashboard, Setup, Brief, **Idea**, **Proof**, Resources, Submit, **Studio** (→ `/studio/[slug]`), Photos, Content hour, Judging, Help. Navbar adds **Live** `/live`, **Showcase** `/ship` and **Passport** `/passport`.

`/admin` → `/ops` (308 redirect in `next.config.ts`). The `/ops` layout shows the staff bar and a role-filtered nav from `src/app/ops/nav.ts` (`OPS_NAV`): Overview, Check-in, Roster, Help, Submissions, Media, Judging, Integrations, Recovery, Announcements, Nudges, Settings, Audit. **Every page still calls `requireRole` itself.** Signed-out visitors get `<AdminLogin next="/ops/…">` from `src/app/ops/parts.tsx`, which links to `/ops/login`.

---

## 3. Data model (db/005–012)

All ids are `bigint identity`. `event_id` defaults to `current_event_id()` (the single `hack_events` row), so services never pass it. Times are `timestamptz` set by `now()`.

**005_event_core**
- `hack_events` (slug, name, timezone, starts_at, team_lock_at, idea_lock_at, submission_locks_at, demos_start_at, ends_at, phase_override, public_status, is_demo, settings jsonb). There is one seeded row.
- `staff_accounts` (email unique lower, name, role mentor|photographer|judge|organizer|admin, member_id?, active, created_by, last_login_at) and `staff_login_codes` (staff_id, code_hash, expires_at, used_at).
- `audit_events` (actor_type member|staff|token|system|pipeline|anonymous, actor_id, actor_label, action, resource_type, resource_id, before_hash, after_hash, reason, request_id, payload). **Append-only trigger.**
- `idempotency_keys` (scope, key PK, status pending|done, response jsonb, expires_at).
- `integration_state` (system unique per event, status ok|degraded|down|paused|unknown, paused, detail, last_success_at, last_error_at, last_error_code). Seeded systems: database, blob, slack, github, luma, kane_ingest, renderer, x, cron, ai_gateway, live_stream.
- `recovery_cases` (code INC-###, subsystem, severity sev1–3, description, recovery_basis, opened_by, closed_by, closed_at).
- `outbox_events` (kind, payload, dedupe_key unique, available_at, published_at, retries, last_error).
- `notifications` + `visibility hub|tv|both|staff`, `published_by`. **Announcements = `kind='announcement'`.**
- `forbid_mutation()` trigger function, reusable for any append-only table.

**006_people**
- `roster_guests` (source **luma_csv|walk_in|manual_offline**, luma_guest_id unique-if-present, name, **email_hash** = sha256(lower(trim(email))), email_hint (masked), email_ciphertext?, approval_status approved|pending_approval|waitlist|declined|invited|walk_in, admission_status admitted|not_admitted|needs_reconciliation|revoked, checked_in_at, checked_in_by staff, member_id, source_version, source_hash, staff_reference).
- `members` +: team_id **nullable**, event_id, role (participant…admin), display_name, **public_code P-#### (auto)**, checked_in_at, activated_at, guest_id → roster_guests (unique), deleted_at, github_handle, skills text[], interests text[], **email_hash**, password_hash (per-member login, optional), admission_state unknown|admitted|needs_reconciliation|not_admitted.
- `member_consents` (member_id, category selfie_storage|photo_publication|face_matching|social_mention|teammate_discovery|idea_discovery|activity_publication, granted, policy_version, source web|mcp|staff|paper|backfill, recorded_at). **Append-only. To revoke, insert granted=false.** View `member_consent_current(member_id, category, granted, policy_version, recorded_at)` gives the latest value. Backfilled from `members.consent_social`.
- `member_identities` (provider github|x|linkedin|luma, subject unique per provider, handle, verified_at).
- `member_tokens` (member_id, kind pairing|bearer|badge|phone_handoff, **token_hash unique**, label, scopes[], expires_at, used_at, revoked_at, last_used_at).

**007_help**
- `help_tickets` (code **H-#### auto** or a pre-printed paper code, member_id?, team_id?, table_label, category kane_cli|test_manager|auth|ci_cloud|mobile|idea|github|other, summary, details, tried, priority low|normal|high|urgent, status new|triaged|claimed|in_progress|resolved|closed|escalated|duplicate, assigned_mentor_id → staff_accounts, safe_run_id text, source web|mcp|paper, duplicate_of, paper_original_at, entered_by, idempotency_key (unique per member), created/claimed/resolved/updated_at).
- `help_messages` (ticket_id, author_type member|staff|system, author_member_id, author_staff_id, body, visibility ticket|staff_only).
- Atomic claim: `update help_tickets set status='claimed', assigned_mentor_id=$1, claimed_at=now() where id=$2 and status in ('new','triaged') returning *`. Zero rows → 409 CONFLICT "already claimed by X".

**008_submissions**
- `projects` (team_id unique, idea_id, project_type application|agent|extension|plugin|workflow|ci_pipeline|validation_harness|tool|other, name, summary, **slug unique = team slug, public at /ship/{slug}**, repo_url, live_url, run_command, state draft|building|verifying|demo_ready|submitted|archived, **showcase_state draft|unlisted|public|hidden_by_moderation**). Backfilled for every team. `registerTeam` creates one.
- `repository_links` (project_id, provider, installation_id, repo_id, repo_full_name, default_branch, permission_scope, linked_by, last_push_at, last_commit_sha).
- `submissions` (project_id, team_id, status draft|preflighted|awaiting_confirmation|finalized|locked|withdrawn|organizer_exception, draft jsonb, preflight jsonb, receipt_code unique S-XXXX, finalized_by member / finalized_by_staff, finalized_at (server), received_at (manual), witness, incident_ref, immutable_snapshot, snapshot_sha256, signature (HMAC with RECEIPT_SIGNING_KEY), source web|mcp|manual_offline, exception_ref, supersedes_id, idempotency_key). **Partial unique: one live submission per project.** **Trigger:** once finalized, the snapshot, receipt, signature, times, draft and source are frozen, status only moves forward, and no delete is allowed.
- `judge_scores` (submission_id, judge_id → staff_accounts, rubric_version, round mid|final|stage, category_scores jsonb, total, comments, uncertainty, frozen, committed_at; unique submission+judge+rubric+round). **Trigger: frozen rows can't change.** Rubric `kane-hack-os-eval@2` (`judgingCriteria` in src/data/hackday.ts): kane_usage 25, idea 25, completion 25, gtm 25; ties break on kane_usage, then completion. (@1 was EVALUATION.md D3: 30/25/20/15/10.) Points = anchor(0–5) × weight / 5. No AI scores.

**009_kane**
- `kane_runs` (project_id, team_id, member_id, token_id, source kanehack_cli|mcp|manual|github_action|webhook, upstream_execution_id (unique with source), batch_execution_id, status running|passed|failed|blocked|errored|cancelled, exit_code, has_terminal_event, commit_sha, objective, summary jsonb, started/finished_at, evidence_hash, evidence_artifact_id, **source_verified**, verification_state reported|verified|manual_unverified, report_url, raw_metadata).
- `kane_test_members` (run_id, upstream_member_id, name, test_definition_hash, status, duration_ms).
- `evidence_artifacts` (project_id, object_key (private Blob), sha256 unique per project, kind, content_type, size_bytes, visibility private|team|judges|public, source_run_id, uploaded_by, verified_at, redaction_state unreviewed|clean|redacted|quarantined).
- `defects` (project_id, signature unique per project, title, detail, source_run_id, status **suspected**|confirmed|not_a_bug|fixed|reverified, failure_class product|infra|auth|unknown, confirmed_by, confirmed_at).
- `defect_verifications` (defect_id, run_id, commit_sha, result reproduced|passed|inconclusive).
- `milestones` (project_id, title, claim, confidence verified|participant_reported|inferred (**verified needs evidence_id or source_run_id**, enforced by a CHECK), evidence_id, source_run_id, visibility team|judges|public, proposed_by, approved_by, approved_at).

**010_teams_activation**
- `teams` +: event_id, state recruiting|formed|active|roster_locked|submitted|withdrawn, captain_id, **max_size default 5** (the site has always allowed 5), table_label, summary_public, recruiting_open, invite_code_hash, roster_locked_at.
- `team_memberships` (team_id, member_id, role captain|member, joined_at, left_at, left_reason, approved_by). **Unique index `one_current_team_per_member` WHERE left_at IS NULL.** Keep `members.team_id` in step, since it is the fast pointer that the hub and auth read.
- `invitations` (team_id, invite_hash unique, invited_member_id, invited_email_hash, created_by, expires_at, accepted_at, accepted_by, revoked_at).
- `teammate_profiles` (member_id PK, discoverable, skills[], interests[], preferred_work, availability, learning_goals, bio).
- `teammate_introductions` (requester_id, target_member_id | target_team_id, message, status proposed|accepted|declined|withdrawn|expired, responded_at). One open request per pair.
- `activation_sessions` (member_id, guest_id, pair_token_hash unique, status invited→…→active / action_required / recoverable_error / expired, expires_at, browser_session_ref, kane_run_id, receipt_code).
- `activation_checkpoints` (activation_id, checkpoint, status, actor participant|kane|staff|system, run_id, payload; **unique activation+checkpoint+status**).
- `selfies` (member_id, object_key (private Blob), captured_at, captured_by participant|staff, approved_at, deletion_due_at, deleted_at, face_template_key, template_consent_id). One current selfie per member.

**011_ideas_story**
- `ideas` (team_id unique, title, **private_description**, public_summary, discovery_opt_in, project_type, qualification draft|qualifies|needs_work|ineligible, status draft|validated|shared|selected|frozen, frozen_at). Seeded from `teams.idea`.
- `idea_revisions` (idea_id, revision, user_submitted jsonb, assessment jsonb, actor_id). `idea_similarity_edges` (source, target, similarity, label similar_angle|possible_overlap|complementary, explanation). **Only opted-in public summaries may be compared.**
- `project_stories` (project_id, version, content jsonb per blueprint `templates/project-story.schema.json`, created_by, reviewed_by, reviewed_at).
- `deck_versions` (project_id, source_story_id, version, template, scenes, theme_tokens, status draft|approved|published|archived).
- `render_jobs` (project_id, source_version, kind html_deck|pdf_deck|mp4_video|og_card|social_card, status queued|running|succeeded|failed|cancelled, object_key, error_code, attempt_count, idempotency_key unique).
- `published_assets` (project_id, kind ship_page|deck|pdf|og_card|video|social_card, version, source_story_id, source_deck_id, object_key, state, consent_receipt jsonb, published_by, published_at).

**012_media_live**
- `event_photos` +: status captured|identity_review|consent_checked|caption_drafted|approved|published|rejected (**existing rows = published, new rows default captured**), photographer_id, source, alt_text, captured_at, consent_checked_at, approved_by, approved_at, rejected_reason. **Galleries must show `status='published'` only** (judge-photo updates the readers and `/api/import/photo`).
- `photo_people` (photo_id → event_photos, member_id, match_basis qr_badge|manual_confirmation|opted_in_candidate, reviewer_staff_id, confirmed_at).
- `social_drafts` (photo_id, project_id, team_id, style, proposed_text, alt_text, claim_ids, generated_by llm|template|human, checks jsonb, status draft|approved|rejected|published, created_by, approved_by, approved_at) and `social_posts` (draft_id unique, platform, remote_post_id unique, url, status, error_code, published_at).
- `activity` +: team_id nullable, event_id, source, source_event_id (unique with source), type, visibility private|team|judges|public, occurred_at, ingested_at, schema_version, payload, evidence_ref, signature_status unverified|verified|invalid|not_applicable.
- `live_metrics` (event_id+name PK, value, denominator, sample_n, source, definition_version, as_of, freshness fresh|delayed|stale, **is_demo**).
- `live_feed` (team_id, kind, status proof|detected|linked|info, title, detail, href, source_activity_id unique, is_demo, occurred_at).

---

## 4. Ownership map (nine areas)

| Area | Owns |
|---|---|
| **admissions-ops** | `src/app/ops/{checkin,roster,integrations,recovery,announcements,settings,audit,page}`, `src/server/{roster,ops}.ts`, `src/app/health`, `src/app/api/cron`, vercel config, `public/print` |
| **help** | `src/app/t/[slug]/help`, `src/app/help`, `src/app/ops/help`, `src/server/help.ts` |
| **submission-showcase** | `src/app/t/[slug]/submit`, `src/app/submit`, `src/app/ops/submissions`, `src/app/ship/**` except deck, `src/server/{submission,showcase}.ts` |
| **live** | `src/app/live`, `src/app/api/v1/live`, `src/server/metrics.ts`, `src/components/live`, home stats strip component |
| **identity** | `src/app/{activate,passport,pair}`, `src/app/api/v1/{auth,pair,participants,activate,readiness}`, `src/server/{activation,passport,pairing}.ts` |
| **teams-ideas** | `src/app/{team,match}`, `src/app/t/[slug]/idea`, `src/app/api/v1/{teams,match,ideas}`, `src/server/{teams,match,ideas}.ts` |
| **studio-deck** | `src/app/studio/**`, `src/app/ship/[slug]/deck`, `src/app/api/v1/{projects/*/story,decks,renders,showcase}`, `src/server/{story,deck,gtm}.ts` |
| **kane-mcp** | `src/app/t/[slug]/proof`, `src/app/api/v1/{kane,projects/*/milestones,projects/*/defects}`, `src/app/mcp`, `src/app/webhooks`, `src/server/{kane,mcp}.ts`, `plugin/**`, `.agents/skills/hack-*`, `public/install.sh`, `public/install.ps1`, `packages/kanehack`, `src/components/gen` |
| **judge-photo** | `src/app/judge`, `src/app/photo`, `src/app/ops/{media,judging}`, `src/app/api/v1/{media,social}`, `src/server/{judging,photos,social}.ts`, `src/components/judging`, `hackday.ts` judging rubric → D3 |

The foundation (manager-routed changes only) owns `src/server/{core,auth,ai}.ts`, `src/lib/{event,flags,session,hub,db}.ts`, `src/app/ops/{layout,nav,OpsNav,login,parts,actions}`, `src/components/ui/*`, `src/components/forms/fields.tsx`, `globals.css`, `next.config.ts` and `db/005–012`.
**Cross-area calls go through the other area's exported service function.** Never write another area's tables directly. If you need a function that doesn't exist yet, write a minimal one in *your* file and tell the manager.
Shared touch points you may need: the hub dashboard (`src/app/t/[slug]/page.tsx`) and the `Navbar`. Send those edits through the manager.

---

## 5. Conventions

- **REST:** `src/app/api/v1/<resource>/route.ts`. Wrap the handler in `envelopeResponse(async () => …)`. Auth with `requireBearer(req)` (CLI/MCP) or the cookie helpers (browser). Accept `Idempotency-Key` headers on retriable POSTs.
- **MCP:** `src/app/mcp/route.ts` (kane-mcp) registers tools that call the same service functions and return `toEnvelope(...)` as JSON text content. Writes that finalize, publish, change a team, change consent or post socially require `explicit_confirmation: true` in the input **and** a human-confirmable action in the envelope.
- **Codes people quote:** P-#### (member), H-#### (help), S-XXXX (receipt, random `randomCode(4)`), INC-### (incident).
- **Public pages** (`/ship`, `/live`, `/passport/badge`) render from server-side DTOs that leave out private fields. Don't hide data with CSS. No emails, tokens or private idea text.
- **Metrics:** never render 0 for unknown values (show "—" plus a FreshnessStamp). Label a failing run SUSPECTED and an unbacked claim UNVERIFIED.
- **Outbox:** for side effects (Slack, renders, social), insert `outbox_events` in the same transaction. The cron drain (admissions-ops) delivers them. Slack failures never block the web flow.
- **Env vars already used:** `DATABASE_URL(_UNPOOLED)`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `BLOB_READ_WRITE_TOKEN`, `EXPORT_TOKEN`. New in the foundation: `SITE_URL` (optional, default https://kaneclihack.sh), `HACKOS_MODEL` (optional), `AI_GATEWAY_API_KEY` (local only; OIDC on Vercel). Expected by areas: `RECEIPT_SIGNING_KEY`, `CRON_SECRET`, `SLACK_WEBHOOK_URL`, `GITHUB_WEBHOOK_SECRET`.

---

## 6. Reserved migration numbers

| # | Area |
|---|---|
| 020 | admissions-ops |
| 021 | help |
| 022 | submission-showcase |
| 023 | live |
| 024 | identity |
| 025 | teams-ideas |
| 026 | studio-deck |
| 027 | kane-mcp |
| 028 | judge-photo |

013–019 are kept for foundation fixes. Name each file `0NN_<area>.sql`, keep it idempotent, and don't alter another area's tables without the manager.
