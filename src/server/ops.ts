import "server-only";
import { createHmac } from "node:crypto";
import { list as listBlobs } from "@vercel/blob";
import { onGroundHelp, setup } from "@/data/hackday";
import { pool, query } from "@/lib/db";
import { formatEventTime, getEvent, PHASES, type HackEvent, type Phase } from "@/lib/event";
import { FLAGS, getFlags, setFlag, type Flag } from "@/lib/flags";
import { isRegistrationOpen, setRegistrationOpen } from "@/lib/teams";
import { issueStaffLoginCode, staffActor, upsertStaff, type Staff } from "./auth";
import { AppError, sha256, stableStringify, withAudit, writeAudit, type Actor, type Receipt, type StaffRole } from "./core";
import { log } from "./log";

// The organizer console's service layer (T-OPS-01..08): overview numbers,
// event settings (deadlines, phase override, flags, staff, event values),
// announcements, integration health, the audit viewer and signed overrides.
// Every change takes a reason and writes an audit event in the same
// transaction; pages and actions are thin wrappers over these functions.

const now = async () => (await query<{ now: Date }>("select now()"))[0].now;
const receipt = (id: string | number, at: Date): Receipt => ({ id: String(id), server_time: new Date(at).toISOString() });

// ── Event values (printed on the kit, posters and runbook) ───────────────────

export const EVENT_VALUE_FIELDS = {
  venue: "Venue / address",
  wifi_network: "Wi-Fi network",
  wifi_password: "Wi-Fi password",
  help_contact: "On-ground help (name, phone)",
  support_channel: "Staff support channel / phone",
  incident_commander: "Incident commander",
  incident_backup: "Incident commander backup",
  admission_lead: "Admission lead",
  photographer_lead: "Photographer lead",
  mentor_dispatcher: "Mentor dispatcher",
  kane_infra: "Kane / product infra contact",
  submission_officer: "Submission officer",
  witness: "Submission witness",
  privacy_rules: "Privacy rules (shown to staff)",
  brand_notes: "Brand asset notes",
} as const;

export type EventValueKey = keyof typeof EVENT_VALUE_FIELDS;
export type EventValues = Record<EventValueKey, string> & { deploy_freeze: boolean; deploy_freeze_reason: string };

/** A hackday.ts value that is still a "[placeholder]" counts as unset. */
const real = (s?: string | null) => (s && !/^\[.*\]$/.test(s.trim()) && !s.includes("[") ? s.trim() : "");

/** hack_events.settings, with hackday.ts copy as the fallback for anything unset. */
export async function getEventValues(): Promise<EventValues> {
  let stored: Record<string, unknown> = {};
  try {
    const [row] = await query<{ settings: Record<string, unknown> }>("select settings from hack_events where id = current_event_id()");
    stored = row?.settings ?? {};
  } catch (err) {
    log.warn("ops.event_values_unavailable", { err });
  }
  const wifi = setup.find((s) => s.id === "wifi")?.value ?? "";
  const [net, pass] = wifi.split("/").map((x) => x.trim());
  const defaults: Record<EventValueKey, string> = {
    venue: "",
    wifi_network: real(net),
    wifi_password: real(pass),
    help_contact: real(onGroundHelp),
    support_channel: "",
    incident_commander: "",
    incident_backup: "",
    admission_lead: "",
    photographer_lead: "",
    mentor_dispatcher: "",
    kane_infra: "",
    submission_officer: "",
    witness: "",
    privacy_rules:
      "Selfie optional. Face matching optional and separate. Photo publication separate. QR badge identification preferred. No passwords, tokens or private repo secrets on paper.",
    brand_notes: "Only the approved marks in public/logos. TestMu mark small, bottom-right on ship pages and decks. Never redraw or recolour a logo.",
  };
  const out = { ...defaults } as EventValues;
  for (const k of Object.keys(EVENT_VALUE_FIELDS) as EventValueKey[]) {
    const v = stored[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  out.deploy_freeze = stored.deploy_freeze === true;
  out.deploy_freeze_reason = typeof stored.deploy_freeze_reason === "string" ? stored.deploy_freeze_reason : "";
  return out;
}

export async function updateEventValues(values: Partial<Record<EventValueKey, string>>, reason: string, staff: Staff) {
  return withAudit(staffActor(staff), "event.values", "hack_event", async (tx) => {
    const { rows } = await tx.query<{ id: number; settings: Record<string, unknown>; now: Date }>(
      "select id, settings, now() as now from hack_events where id = current_event_id() for update",
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "No event row. Run the migrations first." });
    const before = rows[0].settings ?? {};
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (k in EVENT_VALUE_FIELDS && typeof v === "string") patch[k] = v.trim().slice(0, 1000);
    await tx.query("update hack_events set settings = settings || $2::jsonb, updated_at = now() where id = $1", [rows[0].id, JSON.stringify(patch)]);
    // Contacts and Wi-Fi are not secrets, but keep only which keys changed in the payload.
    return { result: receipt(rows[0].id, rows[0].now), resourceId: rows[0].id, reason, before, after: { ...before, ...patch }, payload: { keys: Object.keys(patch) } };
  });
}

/** T-DEP-05: a visible "deploy freeze" switch for the submission window (Vercel instant rollback stays available). */
export async function setDeployFreeze(on: boolean, reason: string, staff: Staff) {
  return withAudit(staffActor(staff), on ? "deploy.freeze" : "deploy.unfreeze", "hack_event", async (tx) => {
    const { rows } = await tx.query<{ id: number; now: Date }>(
      `update hack_events set settings = settings || jsonb_build_object('deploy_freeze', $1::boolean, 'deploy_freeze_reason', $2::text), updated_at = now()
        where id = current_event_id() returning id, now() as now`,
      [on, reason],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receipt(rows[0].id, rows[0].now), resourceId: rows[0].id, reason, after: { deploy_freeze: on } };
  });
}

// ── Deadlines, phase, status (T-OPS-02) ──────────────────────────────────────

export const DEADLINE_FIELDS = {
  starts_at: "Doors open",
  team_lock_at: "Team registration locks",
  idea_lock_at: "Idea locks",
  submission_locks_at: "Submission locks (official)",
  demos_start_at: "Demos start",
  ends_at: "Event ends",
} as const;
export type DeadlineKey = keyof typeof DEADLINE_FIELDS;

/** Each deadline as "YYYY-MM-DDTHH:MM" wall time in the event zone, for datetime-local inputs. */
export async function getDeadlineInputs(): Promise<Record<DeadlineKey, string> & { timezone: string }> {
  const [row] = await query<Record<DeadlineKey, string> & { timezone: string }>(
    `select timezone,
            ${(Object.keys(DEADLINE_FIELDS) as DeadlineKey[]).map((k) => `to_char(${k} at time zone timezone, 'YYYY-MM-DD"T"HH24:MI') as ${k}`).join(", ")}
       from hack_events where id = current_event_id()`,
  );
  if (!row) throw new AppError("NOT_FOUND", { userMessage: "No event row. Run the migrations first." });
  return row;
}

/**
 * Change deadlines. Inputs are wall times in the event's zone; Postgres turns
 * them into instants (DST-correct). Order must stay sensible: start ≤ team lock
 * ≤ idea lock ≤ submission lock ≤ end, demos after start.
 */
export async function updateDeadlines(input: Record<DeadlineKey, string>, reason: string, staff: Staff) {
  return withAudit(staffActor(staff), "event.deadlines", "hack_event", async (tx) => {
    const { rows: cur } = await tx.query<{ id: number; timezone: string } & Record<DeadlineKey, Date>>(
      `select id, timezone, ${Object.keys(DEADLINE_FIELDS).join(", ")} from hack_events where id = current_event_id() for update`,
    );
    const e = cur[0];
    if (!e) throw new AppError("NOT_FOUND");
    const keys = Object.keys(DEADLINE_FIELDS) as DeadlineKey[];
    const { rows: conv } = await tx.query<Record<DeadlineKey, Date>>(
      `select ${keys.map((k, i) => `($${i + 1}::timestamp at time zone $${keys.length + 1}) as ${k}`).join(", ")}`,
      [...keys.map((k) => input[k]), e.timezone],
    );
    const n = conv[0];
    const t = (k: DeadlineKey) => new Date(n[k]).getTime();
    if (!(t("starts_at") <= t("team_lock_at") && t("team_lock_at") <= t("idea_lock_at") && t("idea_lock_at") <= t("submission_locks_at") && t("submission_locks_at") <= t("ends_at"))) {
      throw new AppError("VALIDATION_FAILED", { userMessage: "Deadlines must run in order: doors ≤ team lock ≤ idea lock ≤ submission lock ≤ end." });
    }
    if (t("demos_start_at") < t("starts_at") || t("demos_start_at") > t("ends_at")) {
      throw new AppError("VALIDATION_FAILED", { userMessage: "Demos must start between doors open and the end of the event." });
    }
    const { rows: up } = await tx.query<{ now: Date }>(
      `update hack_events set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1 returning now() as now`,
      [e.id, ...keys.map((k) => n[k])],
    );
    const before = Object.fromEntries(keys.map((k) => [k, e[k]]));
    const after = Object.fromEntries(keys.map((k) => [k, n[k]]));
    const changed = keys.filter((k) => new Date(e[k]).getTime() !== t(k));
    return { result: receipt(e.id, up[0].now), resourceId: e.id, reason, before, after, payload: { changed } };
  });
}

export async function setPhaseOverride(phase: Phase | null, reason: string, staff: Staff) {
  if (phase && !PHASES.includes(phase)) throw new AppError("VALIDATION_FAILED");
  return withAudit(staffActor(staff), "event.phase_override", "hack_event", async (tx) => {
    const { rows } = await tx.query<{ id: number; before: Phase | null; now: Date }>(
      `update hack_events h set phase_override = $1, updated_at = now()
         from (select id, phase_override as before from hack_events where id = current_event_id() for update) b
        where h.id = b.id returning h.id, b.before, now() as now`,
      [phase],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receipt(rows[0].id, rows[0].now), resourceId: rows[0].id, reason, before: { phase_override: rows[0].before }, after: { phase_override: phase } };
  });
}

export const PUBLIC_STATUSES = ["draft", "open", "in_progress", "closed"] as const;

export async function setPublicStatus(status: (typeof PUBLIC_STATUSES)[number], reason: string, staff: Staff) {
  return withAudit(staffActor(staff), "event.public_status", "hack_event", async (tx) => {
    const { rows } = await tx.query<{ id: number; before: string; now: Date }>(
      `update hack_events h set public_status = $1, updated_at = now()
         from (select id, public_status as before from hack_events where id = current_event_id() for update) b
        where h.id = b.id returning h.id, b.before, now() as now`,
      [status],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receipt(rows[0].id, rows[0].now), resourceId: rows[0].id, reason, before: { public_status: rows[0].before }, after: { public_status: status } };
  });
}

/** Registration open/closed, now audited (the old /admin toggle wasn't). */
export async function setRegistration(open: boolean, reason: string, staff: Staff) {
  const before = await isRegistrationOpen();
  await setRegistrationOpen(open);
  await writeAudit(staffActor(staff), { action: open ? "registration.open" : "registration.close", resourceType: "setting", resourceId: "registration_open", reason, before: { open: before }, after: { open } });
  return receipt("registration_open", await now());
}

export async function setFlagAudited(flag: Flag, on: boolean, reason: string, staff: Staff) {
  if (!(flag in FLAGS)) throw new AppError("VALIDATION_FAILED");
  const before = (await getFlags())[flag];
  await setFlag(flag, on);
  await writeAudit(staffActor(staff), { action: "flag.set", resourceType: "flag", resourceId: flag, reason, before: { on: before }, after: { on } });
  return receipt(`flag:${flag}`, await now());
}

// ── Staff (roles) ────────────────────────────────────────────────────────────

export type StaffListRow = { id: number; email: string; name: string; role: StaffRole; active: boolean; last_login_at: Date | null; created_at: Date };

export async function listStaff() {
  return query<StaffListRow>("select id, email, name, role, active, last_login_at, created_at from staff_accounts order by active desc, role, lower(name)");
}

export async function saveStaff(input: { email: string; name: string; role: StaffRole }, staff: Staff) {
  // Only an admin can create or promote another admin.
  if (input.role === "admin" && staff.role !== "admin") throw new AppError("FORBIDDEN", { userMessage: "Only an admin can grant the admin role." });
  const id = await upsertStaff(input, staffActor(staff));
  return receipt(id, await now());
}

export async function setStaffActive(id: number, active: boolean, reason: string, staff: Staff) {
  if (staff.id === id && !active) throw new AppError("VALIDATION_FAILED", { userMessage: "You can't deactivate your own account." });
  return withAudit(staffActor(staff), active ? "staff.reactivate" : "staff.deactivate", "staff_account", async (tx) => {
    const { rows } = await tx.query<{ id: number; role: StaffRole; now: Date }>("update staff_accounts set active = $2 where id = $1 returning id, role, now() as now", [id, active]);
    if (!rows[0]) throw new AppError("NOT_FOUND");
    if (rows[0].role === "admin" && staff.role !== "admin") throw new AppError("FORBIDDEN", { userMessage: "Only an admin can change an admin account." });
    // Deactivation also burns outstanding login codes; getStaff() re-checks `active`, so open sessions end on their next request.
    if (!active) await tx.query("update staff_login_codes set used_at = now() where staff_id = $1 and used_at is null", [id]);
    return { result: receipt(id, rows[0].now), resourceId: id, reason, after: { active } };
  });
}

/** A fresh one-time login code, shown once to the organizer. */
export async function issueCode(id: number, staff: Staff) {
  const [target] = await query<{ role: StaffRole; active: boolean }>("select role, active from staff_accounts where id = $1", [id]);
  if (!target) throw new AppError("NOT_FOUND");
  if (!target.active) throw new AppError("VALIDATION_FAILED", { userMessage: "Reactivate the account before issuing a code." });
  if (target.role === "admin" && staff.role !== "admin") throw new AppError("FORBIDDEN", { userMessage: "Only an admin can issue an admin code." });
  return issueStaffLoginCode(id, staffActor(staff));
}

/** Revoke every CLI/MCP token a member holds (T-OPS-06 "revoke sessions"). */
export async function revokeMemberTokens(publicCode: string, reason: string, staff: Staff) {
  return withAudit(staffActor(staff), "member.tokens_revoke", "member", async (tx) => {
    const { rows: m } = await tx.query<{ id: number }>("select id from members where upper(public_code) = upper($1)", [publicCode.trim()]);
    if (!m[0]) throw new AppError("NOT_FOUND", { userMessage: "No member with that P-code." });
    const { rows } = await tx.query<{ n: number; now: Date }>(
      "with r as (update member_tokens set revoked_at = now() where member_id = $1 and revoked_at is null returning 1) select count(*)::int as n, now() as now from r",
      [m[0].id],
    );
    return { result: { ...receipt(m[0].id, rows[0].now), revoked: rows[0].n }, resourceId: m[0].id, reason, after: { revoked: rows[0].n } };
  });
}

// ── Announcements (T-OPS-03) ─────────────────────────────────────────────────

export const ANNOUNCEMENT_VISIBILITY = { both: "TV + hub", tv: "TV only", hub: "Hub feed only", staff: "Staff only" } as const;
export type AnnouncementVisibility = keyof typeof ANNOUNCEMENT_VISIBILITY;

export type AnnouncementTemplate = { id: string; label: string; title: string; body: string; href?: string };

/** fallback/09_ANNOUNCEMENTS.md, with the real deadline and help desk filled in. Placeholders left in [brackets] must be edited before sending. */
export async function announcementTemplates(e?: HackEvent): Promise<AnnouncementTemplate[]> {
  const ev = e ?? (await getEvent());
  const lock = formatEventTime(ev.submissionLocksAt, ev);
  return [
    {
      id: "opening",
      label: "Opening",
      title: "Welcome to Kane Hack Day",
      body: "Build anything, including a validation harness itself. The real challenge is making agent-built software more trustworthy and faster to ship. Your personal passport is separate from team registration. Scan the activation QR; ask staff if anything fails.",
      href: "/activate",
    },
    {
      id: "team_matching",
      label: "Team matching",
      title: "Still looking for teammates?",
      body: "Scan the Team Finder QR. Share your skills and interests if you want to be discoverable. Teams choose whom to invite.",
      href: "/match",
    },
    {
      id: "first_verification",
      label: "First verification nudge",
      title: "Green build ≠ done",
      body: "Your product is not done when the build is green. Run a meaningful Kane validation and capture the real evidence before adding more scope.",
    },
    {
      id: "midday",
      label: "Midday",
      title: "Focus on the harness",
      body: "Have a working core? Focus the next block on the harness: what do you verify, what happens when it fails, and what evidence informs your next action?",
    },
    {
      id: "one_hour",
      label: "One hour before lock",
      title: `One hour to the ${lock} lock`,
      body: "Stop expanding scope. Verify the critical workflow, capture evidence, rehearse the demo and check submission completeness. The submission clock on Mission Control is authoritative.",
      href: "/live",
    },
    {
      id: "degraded",
      label: "Degraded service",
      title: "[Service] is degraded",
      body: "[Service] is degraded. Check-in, help and submission remain available at the staff desk. Public TV metrics may be delayed. No submission will rely solely on the failed media or skill integration.",
    },
    {
      id: "final_submission",
      label: "Final submission",
      title: `Submissions due at ${lock}`,
      body: `Submissions are due at ${lock}. Submit now or, if the official service is down, bring your frozen project and evidence to the supervised backup receipt desk.`,
    },
    {
      id: "showtime",
      label: "Showtime",
      title: "Showtime",
      body: "The strongest work is not necessarily the largest app or the most tests. Show what you built, how Kane validated it and the evidence that supports your shipping decision.",
    },
  ];
}

export type AnnouncementRow = { id: number; title: string; body: string; href: string | null; visibility: AnnouncementVisibility; send_at: Date; created_at: Date; published_by_name: string | null; sent: boolean };

export async function listAnnouncements(limit = 100) {
  return query<AnnouncementRow>(
    `select n.id, n.title, n.body, n.href, n.visibility, n.send_at, n.created_at, s.name as published_by_name, n.send_at <= now() as sent
       from notifications n left join staff_accounts s on s.id = n.published_by
      where n.kind = 'announcement' order by n.send_at desc limit $1`,
    [limit],
  );
}

/** Latest sent announcements for a surface ('tv' or 'hub'), for /live and the hub feed. */
export async function currentAnnouncements(surface: "tv" | "hub", limit = 5) {
  return query<Pick<AnnouncementRow, "id" | "title" | "body" | "href" | "send_at">>(
    `select id, title, body, href, send_at from notifications
      where kind = 'announcement' and team_id is null and send_at <= now() and visibility in ($1, 'both')
      order by send_at desc limit $2`,
    [surface, limit],
  );
}

export async function publishAnnouncement(
  input: { title: string; body: string; href: string | null; visibility: AnnouncementVisibility; sendInMinutes: number | null; templateId?: string | null },
  staff: Staff,
) {
  if (/\[[^\]]+\]/.test(input.title + input.body)) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "Fill in the [placeholders] before sending. Never announce availability you haven't verified." });
  }
  return withAudit(staffActor(staff), "announcement.publish", "notification", async (tx) => {
    const { rows } = await tx.query<{ id: number; send_at: Date }>(
      `insert into notifications (team_id, kind, title, body, href, send_at, visibility, published_by)
       values (null, 'announcement', $1, $2, $3, now() + make_interval(mins => $4), $5, $6) returning id, send_at`,
      [input.title, input.body, input.href, input.sendInMinutes ?? 0, input.visibility, staff.id],
    );
    return {
      result: receipt(rows[0].id, rows[0].send_at),
      resourceId: rows[0].id,
      after: { title: input.title, visibility: input.visibility, send_at: rows[0].send_at },
      payload: { template: input.templateId ?? null },
    };
  });
}

/** Take an announcement down. The audit row keeps what it said. */
export async function retractAnnouncement(id: number, reason: string, staff: Staff) {
  return withAudit(staffActor(staff), "announcement.retract", "notification", async (tx) => {
    const { rows } = await tx.query<{ id: number; title: string; body: string; visibility: string; send_at: Date }>(
      "delete from notifications where id = $1 and kind = 'announcement' returning id, title, body, visibility, send_at",
      [id],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receipt(id, await now()), resourceId: id, reason, before: rows[0], payload: { title: rows[0].title } };
  });
}

// ── Integration health (T-OPS-04) ────────────────────────────────────────────

export type IntegrationStatus = "ok" | "degraded" | "down" | "paused" | "unknown";
export type IntegrationRow = {
  system: string;
  status: IntegrationStatus;
  paused: boolean;
  detail: string | null;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error_code: string | null;
  updated_at: Date;
};

export const INTEGRATIONS: Record<string, { label: string; affects: string; manual: string }> = {
  database: { label: "Database (Neon)", affects: "Everything online", manual: "Paper forms + offline roster (/ops/recovery/print)" },
  blob: { label: "Blob storage", affects: "Selfies, photos, evidence uploads", manual: "Skip optional photos; link evidence by URL" },
  slack: { label: "Slack alerts", affects: "Mentor pings", manual: "Web help queue + paper board" },
  github: { label: "GitHub webhooks", affects: "Repo activity on the feed", manual: "Repo URL + commit SHA by hand" },
  luma: { label: "Luma", affects: "Live guest updates", manual: "Import the latest Luma CSV (/ops/roster/import)" },
  kane_ingest: { label: "Kane run ingest", affects: "Run evidence and TV pulse", manual: "Mark runs manual_unverified; paste run URL" },
  renderer: { label: "Deck / PDF renderer", affects: "Rendered decks and cards", manual: "HTML deck + browser print" },
  x: { label: "X publishing", affects: "Social posts", manual: "Hold posts; share approved copy by hand" },
  cron: { label: "Cron + outbox", affects: "Queued Slack/render side effects", manual: "Run the drain from /ops/integrations" },
  ai_gateway: { label: "AI Gateway", affects: "Advisory drafts only", manual: "Rule-based drafts (automatic)" },
  live_stream: { label: "Live TV stream", affects: "Mission Control updates", manual: "Cached TV view with STALE label" },
};

export async function listIntegrations() {
  return query<IntegrationRow>(
    `select system, status, paused, detail, last_success_at, last_error_at, last_error_code, updated_at
       from integration_state where event_id = current_event_id() order by system`,
  );
}

/** Other areas call this before a side effect: a paused system must not be called. */
export async function isPaused(system: string) {
  try {
    const [r] = await query<{ paused: boolean }>("select paused from integration_state where event_id = current_event_id() and system = $1", [system]);
    return r?.paused ?? false;
  } catch {
    return false;
  }
}

/** Record a success or failure for a system (probes, outbox, webhooks). Never throws. */
export async function recordIntegration(system: string, result: { ok: true; detail?: string } | { ok: false; code: string; detail?: string; status?: "degraded" | "down" }) {
  try {
    if (result.ok) {
      await query(
        `insert into integration_state (system, status, detail, last_success_at) values ($1, 'ok', $2, now())
         on conflict (event_id, system) do update set status = case when integration_state.paused then 'paused' else 'ok' end,
           detail = coalesce($2, integration_state.detail), last_success_at = now(), updated_at = now()`,
        [system, result.detail ?? null],
      );
    } else {
      await query(
        `insert into integration_state (system, status, detail, last_error_at, last_error_code) values ($1, $2, $3, now(), $4)
         on conflict (event_id, system) do update set status = case when integration_state.paused then 'paused' else $2 end,
           detail = coalesce($3, integration_state.detail), last_error_at = now(), last_error_code = $4, updated_at = now()`,
        [system, result.status ?? "degraded", result.detail ?? null, result.code.slice(0, 80)],
      );
    }
  } catch (err) {
    log.warn("ops.integration_record_failed", { system, err });
  }
}

type ProbeResult = { system: string; ok: boolean; status: IntegrationStatus; detail: string; code?: string };

/**
 * Check what can be checked from here without side effects: DB latency, Blob
 * reachability, outbox lag, whether each integration is configured. Systems
 * that report their own health (ai_gateway, kane_ingest, live_stream…) are
 * left as their owners last wrote them unless they're unconfigured.
 */
export async function probeIntegrations(actor: Actor): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  const t0 = performance.now();
  try {
    await pool.query("select 1");
    const ms = Math.round(performance.now() - t0);
    out.push({ system: "database", ok: true, status: ms > 1500 ? "degraded" : "ok", detail: `select 1 in ${ms}ms` });
  } catch (err) {
    // Can't record to a database that's down; log and return.
    log.error("ops.probe.database_down", err);
    return [{ system: "database", ok: false, status: "down", detail: "Database unreachable", code: (err as { code?: string }).code ?? "unreachable" }];
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const tb = performance.now();
    try {
      await listBlobs({ limit: 1 });
      out.push({ system: "blob", ok: true, status: "ok", detail: `list in ${Math.round(performance.now() - tb)}ms` });
    } catch (err) {
      out.push({ system: "blob", ok: false, status: "degraded", detail: "Blob list failed", code: (err as Error).name ?? "error" });
    }
  } else out.push({ system: "blob", ok: false, status: "down", detail: "BLOB_READ_WRITE_TOKEN not set", code: "not_configured" });

  out.push(
    process.env.SLACK_WEBHOOK_URL
      ? { system: "slack", ok: true, status: "ok", detail: "Webhook configured (delivery health comes from the outbox)" }
      : { system: "slack", ok: false, status: "degraded", detail: "SLACK_WEBHOOK_URL not set: web queue only", code: "not_configured" },
  );
  out.push(
    process.env.LUMA_WEBHOOK_SECRET
      ? { system: "luma", ok: true, status: "ok", detail: "Webhook secret configured" }
      : { system: "luma", ok: true, status: "ok", detail: "CSV mode (no webhook configured)" },
  );

  const [ob] = await query<{ pending: number; failing: number; oldest_sec: number | null; last_published: Date | null }>(
    `select count(*) filter (where published_at is null)::int as pending,
            count(*) filter (where published_at is null and retries > 0)::int as failing,
            extract(epoch from now() - min(available_at) filter (where published_at is null))::int as oldest_sec,
            max(published_at) as last_published
       from outbox_events`,
  );
  const lag = ob.oldest_sec ?? 0;
  out.push({
    system: "cron",
    ok: lag < 600,
    status: lag >= 1800 ? "down" : lag >= 600 ? "degraded" : "ok",
    detail: `${ob.pending} queued, ${ob.failing} retrying, oldest ${ob.pending ? `${Math.round(lag / 60)}m` : "—"}`,
    code: lag >= 600 ? "outbox_lag" : undefined,
  });

  for (const p of out) {
    if (p.system === "database") {
      await recordIntegration("database", { ok: true, detail: p.detail });
      continue;
    }
    if (p.ok && p.status === "ok") await recordIntegration(p.system, { ok: true, detail: p.detail });
    else await recordIntegration(p.system, { ok: false, code: p.code ?? "error", detail: p.detail, status: p.status === "down" ? "down" : "degraded" });
  }
  await writeAudit(actor, { action: "integrations.probe", resourceType: "integration_state", resourceId: "all", payload: { results: out.map(({ system, status }) => ({ system, status })) } });
  return out;
}

export async function setIntegrationPaused(system: string, paused: boolean, reason: string, staff: Staff) {
  if (!(system in INTEGRATIONS)) throw new AppError("VALIDATION_FAILED");
  return withAudit(staffActor(staff), paused ? "integration.pause" : "integration.resume", "integration_state", async (tx) => {
    const { rows } = await tx.query<{ id: number; now: Date }>(
      `update integration_state set paused = $2, status = case when $2 then 'paused' else 'unknown' end, detail = $3, updated_at = now()
        where event_id = current_event_id() and system = $1 returning id, now() as now`,
      [system, paused, `${paused ? "Paused" : "Resumed"} by ${staff.name}: ${reason}`.slice(0, 300)],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receipt(system, rows[0].now), resourceId: system, reason, after: { paused } };
  });
}

/** Staff-set status (e.g. a vendor told us X is down). Drives the TV banner via integration_state. */
export async function markIntegration(system: string, status: Exclude<IntegrationStatus, "paused">, detail: string, staff: Staff) {
  if (!(system in INTEGRATIONS)) throw new AppError("VALIDATION_FAILED");
  return withAudit(staffActor(staff), "integration.mark", "integration_state", async (tx) => {
    const { rows } = await tx.query<{ before: string; now: Date }>(
      `update integration_state i set status = case when i.paused then 'paused' else $2 end, detail = $3, updated_at = now(),
              last_error_at = case when $2 in ('degraded','down') then now() else i.last_error_at end,
              last_error_code = case when $2 in ('degraded','down') then 'staff_reported' else i.last_error_code end
         from (select id, status as before from integration_state where event_id = current_event_id() and system = $1 for update) b
        where i.id = b.id returning b.before, now() as now`,
      [system, status, detail.slice(0, 300)],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { result: receipt(system, rows[0].now), resourceId: system, reason: detail, before: { status: rows[0].before }, after: { status } };
  });
}

// ── Overview (T-OPS-01) ──────────────────────────────────────────────────────

export type Overview = {
  asOf: Date;
  members: number;
  teams: number;
  solo: number;
  rosterGuests: number;
  admitted: number;
  checkedIn: number;
  walkIns: number;
  needsReconciliation: number;
  helpOpen: number | null;
  helpOldestMin: number | null;
  receipts: number | null;
  manualReceipts: number | null;
  openIncidents: { code: string; severity: string; subsystem: string; description: string; created_at: Date }[];
  problems: IntegrationRow[];
  lastAnnouncement: { title: string; send_at: Date; visibility: string } | null;
};

/** Numbers for the ops overview. A table another area hasn't migrated yet shows "—" (null), never 0. */
export async function getOverview(): Promise<Overview> {
  const safe = async <T>(p: Promise<T>, fallback: T) => p.catch((err) => (log.warn("ops.overview_partial", { err }), fallback));
  const [[core], help, subs, incidents, problems, [ann]] = await Promise.all([
    query<{ now: Date; members: number; teams: number; solo: number; guests: number; admitted: number; checked_in: number; walk_ins: number; needs: number }>(
      `select now() as now,
              (select count(*)::int from members where deleted_at is null and role = 'participant') as members,
              (select count(*)::int from teams where not is_solo) as teams,
              (select count(*)::int from teams where is_solo) as solo,
              (select count(*)::int from roster_guests where event_id = current_event_id()) as guests,
              (select count(*)::int from roster_guests where event_id = current_event_id() and admission_status = 'admitted') as admitted,
              (select count(*)::int from roster_guests where event_id = current_event_id() and checked_in_at is not null)
                + (select count(*)::int from members m where m.checked_in_at is not null and m.guest_id is null) as checked_in,
              (select count(*)::int from roster_guests where event_id = current_event_id() and source = 'walk_in') as walk_ins,
              (select count(*)::int from members where deleted_at is null and admission_state = 'needs_reconciliation') as needs`,
    ),
    safe(
      query<{ open: number; oldest_min: number | null }>(
        `select count(*)::int as open, (extract(epoch from now() - min(created_at)) / 60)::int as oldest_min
           from help_tickets where status in ('new','triaged','escalated')`,
      ).then((r) => r[0]),
      null,
    ),
    safe(
      query<{ finalized: number; manual: number }>(
        `select count(*) filter (where status in ('finalized','locked'))::int as finalized,
                count(*) filter (where source = 'manual_offline')::int as manual
           from submissions where event_id = current_event_id()`,
      ).then((r) => r[0]),
      null,
    ),
    safe(
      query<Overview["openIncidents"][number]>(
        "select code, severity, subsystem, description, created_at from recovery_cases where closed_at is null and event_id = current_event_id() order by severity, created_at",
      ),
      [],
    ),
    safe(
      query<IntegrationRow>(
        `select system, status, paused, detail, last_success_at, last_error_at, last_error_code, updated_at
           from integration_state where event_id = current_event_id() and (status in ('degraded','down') or paused) order by system`,
      ),
      [],
    ),
    safe(query<{ title: string; send_at: Date; visibility: string }>("select title, send_at, visibility from notifications where kind = 'announcement' and send_at <= now() order by send_at desc limit 1"), []),
  ]);
  return {
    asOf: core.now,
    members: core.members,
    teams: core.teams,
    solo: core.solo,
    rosterGuests: core.guests,
    admitted: core.admitted,
    checkedIn: core.checked_in,
    walkIns: core.walk_ins,
    needsReconciliation: core.needs,
    helpOpen: help?.open ?? null,
    helpOldestMin: help?.open ? help.oldest_min : null,
    receipts: subs?.finalized ?? null,
    manualReceipts: subs?.manual ?? null,
    openIncidents: incidents,
    problems,
    lastAnnouncement: ann ?? null,
  };
}

// ── Audit viewer (T-OPS-06) ──────────────────────────────────────────────────

export type AuditRow = {
  id: number;
  actor_type: string;
  actor_id: number | null;
  actor_label: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  reason: string | null;
  before_hash: string | null;
  after_hash: string | null;
  request_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

export type AuditFilter = { actorType?: string | null; actor?: string | null; action?: string | null; resourceType?: string | null; resourceId?: string | null; before?: number | null };

/** Newest first, 100 per page; `before` is the last id seen (keyset paging). */
export async function listAudit(f: AuditFilter, limit = 100) {
  const like = (s?: string | null) => (s?.trim() ? `%${s.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);
  return query<AuditRow>(
    `select id, actor_type, actor_id, actor_label, action, resource_type, resource_id, reason, before_hash, after_hash, request_id, payload, created_at
       from audit_events
      where ($1::text is null or actor_type = $1)
        and ($2::text is null or lower(coalesce(actor_label, '')) like $2 escape '\\' or actor_id::text = $7)
        and ($3::text is null or lower(action) like $3 escape '\\')
        and ($4::text is null or resource_type = $4)
        and ($5::text is null or resource_id = $5)
        and ($6::bigint is null or id < $6)
      order by id desc limit $8`,
    [f.actorType || null, like(f.actor), like(f.action), f.resourceType || null, f.resourceId?.trim() || null, f.before ?? null, f.actor?.trim() ?? "", limit],
  );
}

export async function auditFacets() {
  const [types, resources] = await Promise.all([
    query<{ v: string }>("select distinct actor_type as v from audit_events order by 1"),
    query<{ v: string }>("select distinct resource_type as v from audit_events order by 1"),
  ]);
  return { actorTypes: types.map((r) => r.v), resourceTypes: resources.map((r) => r.v) };
}

// ── Signed manual override with witness (T-OPS-08) ───────────────────────────

export const OVERRIDE_KINDS = {
  admit_guest: "Admit a roster guest (P-code or roster id)",
  revoke_admission: "Revoke a roster guest's admission",
  undo_checkin: "Undo a mistaken check-in",
  deadline_exception: "Record a deadline exception for a team (slug)",
  note: "Compensating note on any record",
} as const;
export type OverrideKind = keyof typeof OVERRIDE_KINDS;

export type OverrideInput = {
  kind: OverrideKind;
  target: string;
  reason: string;
  witness: string;
  incidentRef?: string | null;
  resourceType?: string | null;
};

function overrideSignature(body: unknown) {
  const key = process.env.RECEIPT_SIGNING_KEY ?? process.env.SESSION_SECRET;
  const digest = sha256(stableStringify(body));
  return { digest, signature: key ? createHmac("sha256", key).update(digest).digest("hex") : null };
}

/**
 * An organizer override, co-signed by a named witness. It never edits history:
 * it appends an audit event (with an HMAC over its contents) and, for the
 * record kinds that have state, applies the one compensating change. Finalized
 * submissions are never touched here; a deadline exception is a recorded
 * decision the submission desk acts on.
 */
export async function applyOverride(input: OverrideInput, staff: Staff) {
  if (input.witness.trim().toLowerCase() === staff.name.trim().toLowerCase()) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "The witness must be a different person from the organizer applying the override." });
  }
  const actor = staffActor(staff);
  return withAudit(actor, `override.${input.kind}`, input.kind === "note" ? (input.resourceType ?? "record") : input.kind === "deadline_exception" ? "team" : "roster_guest", async (tx) => {
    const { rows: nowRows } = await tx.query<{ now: Date }>("select now()");
    const at = nowRows[0].now;
    let resourceId = input.target.trim();
    let before: unknown;
    let after: unknown;

    const findGuest = async () => {
      const t = input.target.trim();
      const { rows } = await tx.query<{ id: number; admission_status: string; checked_in_at: Date | null; member_id: number | null }>(
        `select g.id, g.admission_status, g.checked_in_at, coalesce(g.member_id, m.id) as member_id
           from roster_guests g left join members m on m.guest_id = g.id
          where g.event_id = current_event_id() and (g.id::text = $1 or upper(m.public_code) = upper($1) or g.luma_guest_id = $1)
          limit 1 for update of g`,
        [t],
      );
      if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "No roster guest matches that P-code, roster id or Luma guest id." });
      return rows[0];
    };

    if (input.kind === "admit_guest" || input.kind === "revoke_admission") {
      const g = await findGuest();
      const next = input.kind === "admit_guest" ? "admitted" : "revoked";
      await tx.query("update roster_guests set admission_status = $2, staff_reference = $3, updated_at = now() where id = $1", [g.id, next, `override: ${input.reason}`.slice(0, 200)]);
      if (next === "admitted") {
        await tx.query("update roster_guests set admission_basis = 'override', admitted_by = $2, admitted_at = now(), admission_reason = $3 where id = $1", [g.id, staff.id, input.reason.slice(0, 300)]);
      }
      if (g.member_id) await tx.query("update members set admission_state = $2 where id = $1", [g.member_id, next === "admitted" ? "admitted" : "not_admitted"]);
      resourceId = String(g.id);
      before = { admission_status: g.admission_status };
      after = { admission_status: next };
    } else if (input.kind === "undo_checkin") {
      const g = await findGuest();
      if (!g.checked_in_at) throw new AppError("VALIDATION_FAILED", { userMessage: "That guest isn't checked in." });
      await tx.query("update roster_guests set checked_in_at = null, checked_in_by = null, checkin_source = null, checkin_ref = null, checkin_entered_at = null, updated_at = now() where id = $1", [g.id]);
      if (g.member_id) await tx.query("update members set checked_in_at = null where id = $1", [g.member_id]);
      resourceId = String(g.id);
      before = { checked_in_at: g.checked_in_at };
      after = { checked_in_at: null };
    } else if (input.kind === "deadline_exception") {
      const { rows } = await tx.query<{ id: number; slug: string }>("select id, slug from teams where slug = $1", [input.target.trim().toLowerCase()]);
      if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "No team with that slug." });
      resourceId = String(rows[0].id);
      after = { exception: "deadline", team: rows[0].slug };
    }

    const body = { kind: input.kind, target: input.target.trim(), resource_id: resourceId, reason: input.reason, witness: input.witness.trim(), incident_ref: input.incidentRef ?? null, by: staff.id, at: new Date(at).toISOString() };
    const sig = overrideSignature(body);
    return {
      result: { ...receipt(`OVR-${sig.digest.slice(0, 8).toUpperCase()}`, at), digest: sig.digest, signature: sig.signature },
      resourceId,
      reason: input.reason,
      before,
      after,
      payload: { ...body, digest: sig.digest, signature: sig.signature },
    };
  });
}

export async function listOverrides(limit = 50) {
  return query<AuditRow>(
    `select id, actor_type, actor_id, actor_label, action, resource_type, resource_id, reason, before_hash, after_hash, request_id, payload, created_at
       from audit_events where action like 'override.%' order by id desc limit $1`,
    [limit],
  );
}
