import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";
import { staffActor, type Staff } from "./auth";
import { AppError, emailHash, idempotent, maskEmail, sha256, withAudit, writeAudit, type Actor, type Receipt } from "./core";
import { csvObjects, toCsv } from "./csv";

// Admissions (T-ROS-01..04): the approved-guest roster from a Luma CSV (or the
// blueprint's fallback template), reconciliation against registered members,
// the staff check-in desk and walk-ins.
//
// Rules this file keeps:
// - The roster never stores a readable email. email_hash matches people,
//   email_hint ("an***@ex***.com") is for staff eyes, email_ciphertext is
//   optional (ROSTER_EMAIL_KEY) and never leaves the server.
// - A CSV import is previewed as a diff first and committed only if the file
//   hash still matches what staff saw.
// - Check-in time is the database's now(); a row already checked in is never
//   re-stamped. A guest who drops off a later CSV after checking in is flagged
//   NEEDS_RECONCILIATION, never silently revoked.
// - Walk-ins get a roster row (source 'walk_in') and a member, so they can
//   activate like everyone else.

type Db = Pick<PoolClient, "query">;

export type ApprovalStatus = "approved" | "pending_approval" | "waitlist" | "declined" | "invited" | "walk_in";
export type AdmissionStatus = "admitted" | "not_admitted" | "needs_reconciliation" | "revoked";

const APPROVALS: ApprovalStatus[] = ["approved", "pending_approval", "waitlist", "declined", "invited", "walk_in"];
const APPROVAL_ALIASES: Record<string, ApprovalStatus> = {
  approved: "approved",
  going: "approved",
  registered: "approved",
  checked_in: "approved",
  pending: "pending_approval",
  pending_approval: "pending_approval",
  waitlist: "waitlist",
  waitlisted: "waitlist",
  declined: "declined",
  rejected: "declined",
  not_going: "declined",
  invited: "invited",
  walk_in: "walk_in",
};

/** Only an approved (or walk-in) guest is admitted by an import. */
const admissionFor = (a: ApprovalStatus): AdmissionStatus => (a === "approved" || a === "walk_in" ? "admitted" : "not_admitted");

// ── Email at rest ────────────────────────────────────────────────────────────

function emailKey() {
  const k = process.env.ROSTER_EMAIL_KEY;
  return k ? Buffer.from(sha256(k), "hex") : null;
}

/** AES-256-GCM (iv | tag | ciphertext) when ROSTER_EMAIL_KEY is set, else null (only the hash is kept). */
function encryptEmail(email: string | null) {
  const key = emailKey();
  if (!key || !email) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(email.trim().toLowerCase(), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

/** Organizer-only: read back an encrypted roster email (e.g. to send a walk-in their login link). */
export function decryptEmail(blob: Buffer | null) {
  const key = emailKey();
  if (!key || !blob || blob.length < 29) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── CSV → rows ───────────────────────────────────────────────────────────────

export type RosterInputRow = {
  line: number;
  lumaGuestId: string;
  name: string;
  email: string | null;
  approval: ApprovalStatus;
  checkedInAt: Date | null;
  staffReference: string | null;
};

export type RosterReject = { line: number; reason: string; guest?: string };

export type ParsedRoster = {
  format: "template" | "luma_export";
  hash: string;
  sourceVersion: string;
  rows: RosterInputRow[];
  rejected: RosterReject[];
  warnings: string[];
};

const MAX_ROWS = 5000;
const pick = (v: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (v[k]?.trim()) return v[k].trim();
  return "";
};

/**
 * Read either the blueprint template
 *   event_id,luma_guest_id,approval_status,display_name,checked_in_at,source_version,staff_reference
 * or a Luma guest export (api_id, name / first_name + last_name, email,
 * approval_status, checked_in_at…). An optional `email` column on the template
 * enables reconciliation by email hash.
 */
export function parseRosterCsv(csv: string, opts: { sourceVersion?: string | null; now?: Date } = {}): ParsedRoster {
  const text = csv.replace(/^﻿/, "");
  const hash = sha256(text);
  const { headers, rows } = csvObjects(text);
  const warnings: string[] = [];
  const rejected: RosterReject[] = [];
  if (!headers.length) throw new AppError("VALIDATION_FAILED", { userMessage: "That file is empty." });
  const idCol = ["luma_guest_id", "api_id", "guest_api_id", "guest_id"].find((h) => headers.includes(h));
  if (!idCol) throw new AppError("VALIDATION_FAILED", { userMessage: "No guest id column. Expected luma_guest_id (template) or api_id (Luma export)." });
  if (!headers.some((h) => ["display_name", "name", "first_name"].includes(h))) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "No name column. Expected display_name, name or first_name." });
  }
  if (rows.length > MAX_ROWS) throw new AppError("VALIDATION_FAILED", { userMessage: `Too many rows (${rows.length}); the limit is ${MAX_ROWS}.` });
  const format = idCol === "luma_guest_id" ? "template" : "luma_export";
  if (!headers.includes("email")) warnings.push("No email column: guests can be checked in, but registrations can't be matched to them automatically.");

  const versions = new Set<string>();
  const seen = new Set<string>();
  const out: RosterInputRow[] = [];
  for (const { line, values: v } of rows) {
    const id = pick(v, idCol);
    const name = pick(v, "display_name", "name") || [pick(v, "first_name"), pick(v, "last_name")].filter(Boolean).join(" ");
    if (!id) {
      rejected.push({ line, reason: "Missing guest id" });
      continue;
    }
    if (id.length > 120) {
      rejected.push({ line, reason: "Guest id is too long", guest: id.slice(0, 20) });
      continue;
    }
    if (seen.has(id)) {
      rejected.push({ line, reason: "Duplicate guest id in this file", guest: id });
      continue;
    }
    if (!name || name.length > 120) {
      rejected.push({ line, reason: name ? "Name is too long" : "Missing name", guest: id });
      continue;
    }
    const rawStatus = pick(v, "approval_status", "status").toLowerCase().replace(/[\s-]+/g, "_");
    const approval = rawStatus ? APPROVAL_ALIASES[rawStatus] : "approved";
    if (!approval) {
      rejected.push({ line, reason: `Unknown approval status "${rawStatus}"`, guest: id });
      continue;
    }
    const rawEmail = pick(v, "email", "email_address").toLowerCase();
    const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 200 ? rawEmail : null;
    if (rawEmail && !email) warnings.push(`Line ${line}: email looks invalid, so it was ignored.`);
    const rawChecked = pick(v, "checked_in_at");
    let checkedInAt: Date | null = null;
    if (rawChecked) {
      const d = new Date(rawChecked);
      if (Number.isNaN(d.getTime())) warnings.push(`Line ${line}: checked_in_at "${rawChecked.slice(0, 40)}" isn't a date, so it was ignored.`);
      else if (opts.now && d.getTime() > opts.now.getTime() + 60_000) warnings.push(`Line ${line}: checked_in_at is in the future, so it was ignored.`);
      else checkedInAt = d;
    }
    const sv = pick(v, "source_version");
    if (sv) versions.add(sv);
    seen.add(id);
    out.push({ line, lumaGuestId: id, name, email, approval, checkedInAt, staffReference: pick(v, "staff_reference").slice(0, 200) || null });
  }

  let sourceVersion = opts.sourceVersion?.trim() || "";
  if (!sourceVersion && versions.size === 1) sourceVersion = [...versions][0];
  if (versions.size > 1) warnings.push(`The file mixes ${versions.size} source_version values; using "${sourceVersion || "the file hash"}".`);
  if (!sourceVersion) sourceVersion = `${format === "luma_export" ? "luma" : "roster"}-${hash.slice(0, 10)}`;
  return { format, hash, sourceVersion: sourceVersion.slice(0, 120), rows: out, rejected, warnings };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export type DiffChange = { field: "name" | "approval_status" | "email" | "admission_status"; from: string | null; to: string | null };

export type DiffRow = {
  lumaGuestId: string;
  name: string;
  approval: ApprovalStatus;
  emailHint: string | null;
  changes?: DiffChange[];
  /** Why the admission won't simply follow the approval status. */
  note?: string;
};

export type RosterDiff = {
  hash: string;
  format: ParsedRoster["format"];
  sourceVersion: string;
  added: DiffRow[];
  changed: DiffRow[];
  unchanged: number;
  removed: DiffRow[];
  rejected: RosterReject[];
  warnings: string[];
  rowCount: number;
};

type ExistingGuest = {
  id: number;
  luma_guest_id: string;
  name: string;
  approval_status: ApprovalStatus;
  admission_status: AdmissionStatus;
  email_hash: string | null;
  email_hint: string | null;
  checked_in_at: Date | null;
  staff_reference: string | null;
};

/** An organizer admitted this person at the desk (or as a walk-in) over the file: imports never undo that. */
const deskOverride = (g: Pick<ExistingGuest, "admission_status" | "staff_reference">) =>
  g.admission_status === "admitted" && /^(admitted at desk|walk-in admit)/.test(g.staff_reference ?? "");

/** The admission a file row implies for an existing guest (revoked stays revoked; checked-in never silently loses admission). */
export function expectedAdmission(cur: ExistingGuest, approval: ApprovalStatus): AdmissionStatus {
  if (cur.admission_status === "revoked") return "revoked";
  if (deskOverride(cur)) return "admitted";
  const target = admissionFor(approval);
  return cur.checked_in_at && target !== "admitted" ? "needs_reconciliation" : target;
}

async function loadLumaGuests(db: Db) {
  const { rows } = await db.query<ExistingGuest>(
    `select id, luma_guest_id, name, approval_status, admission_status, email_hash, email_hint, checked_in_at, staff_reference
       from roster_guests where event_id = current_event_id() and luma_guest_id is not null`,
  );
  return new Map(rows.map((r) => [r.luma_guest_id, r]));
}

function diffAgainst(parsed: ParsedRoster, existing: Map<string, ExistingGuest>): RosterDiff {
  const added: DiffRow[] = [];
  const changed: DiffRow[] = [];
  let unchanged = 0;
  const inFile = new Set<string>();
  for (const r of parsed.rows) {
    inFile.add(r.lumaGuestId);
    const hint = r.email ? maskEmail(r.email) : null;
    const cur = existing.get(r.lumaGuestId);
    if (!cur) {
      added.push({ lumaGuestId: r.lumaGuestId, name: r.name, approval: r.approval, emailHint: hint });
      continue;
    }
    const changes: DiffChange[] = [];
    if (cur.name !== r.name) changes.push({ field: "name", from: cur.name, to: r.name });
    if (cur.approval_status !== r.approval) changes.push({ field: "approval_status", from: cur.approval_status, to: r.approval });
    if (r.email && cur.email_hash !== emailHash(r.email)) changes.push({ field: "email", from: cur.email_hint, to: hint });
    // A guest dropped by an earlier "mark missing" import and back in this file
    // has the same name/approval/email, but their admission must be restored.
    const want = expectedAdmission(cur, r.approval);
    if (cur.admission_status !== want) changes.push({ field: "admission_status", from: cur.admission_status, to: want });
    if (!changes.length) {
      unchanged++;
      continue;
    }
    let note: string | undefined;
    if (cur.admission_status === "revoked") note = "Admission was revoked by an organizer and stays revoked.";
    else if (cur.checked_in_at && admissionFor(r.approval) !== "admitted") note = "Already checked in: will be flagged NEEDS_RECONCILIATION, not revoked.";
    changed.push({ lumaGuestId: r.lumaGuestId, name: r.name, approval: r.approval, emailHint: hint ?? cur.email_hint, changes, note });
  }
  const removed: DiffRow[] = [];
  for (const cur of existing.values()) {
    if (inFile.has(cur.luma_guest_id) || cur.admission_status === "revoked" || cur.admission_status === "not_admitted") continue;
    removed.push({
      lumaGuestId: cur.luma_guest_id,
      name: cur.name,
      approval: cur.approval_status,
      emailHint: cur.email_hint,
      note: cur.checked_in_at ? "Already checked in: would be flagged NEEDS_RECONCILIATION." : undefined,
    });
  }
  return {
    hash: parsed.hash,
    format: parsed.format,
    sourceVersion: parsed.sourceVersion,
    added,
    changed,
    unchanged,
    removed,
    rejected: parsed.rejected,
    warnings: parsed.warnings,
    rowCount: parsed.rows.length + parsed.rejected.length,
  };
}

/** Parse a CSV and compare it with the stored roster. Reads only. */
export async function previewRosterImport(input: { csv: string; sourceVersion?: string | null }): Promise<RosterDiff> {
  const [{ now }] = await query<{ now: Date }>("select now()");
  const parsed = parseRosterCsv(input.csv, { sourceVersion: input.sourceVersion, now });
  const existing = await loadLumaGuests(pool);
  return diffAgainst(parsed, existing);
}

export type ImportReceipt = Receipt & { importId: number; added: number; changed: number; removed: number; unchanged: number; rejected: number; reconciled: ReconcileResult };

/**
 * Apply a previewed CSV. `expectedHash` must equal the hash shown in the
 * preview, so staff commit exactly the file they reviewed. Guests missing from
 * the file are only marked not-admitted when `markMissing` is set.
 */
export async function commitRosterImport(
  input: { csv: string; expectedHash: string; sourceVersion?: string | null; fileName?: string | null; markMissing: boolean },
  staff: Staff,
): Promise<ImportReceipt> {
  const actor = staffActor(staff);
  return withAudit(actor, "roster.import", "roster_import", async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('roster_import'))");
    const { rows: nowRows } = await tx.query<{ now: Date }>("select now()");
    const now = nowRows[0].now;
    const parsed = parseRosterCsv(input.csv, { sourceVersion: input.sourceVersion, now });
    if (parsed.hash !== input.expectedHash) {
      throw new AppError("CONFLICT", { userMessage: "The file changed since the preview. Preview it again before importing." });
    }
    const existing = await loadLumaGuests(tx);
    const diff = diffAgainst(parsed, existing);
    const byId = new Map(parsed.rows.map((r) => [r.lumaGuestId, r]));

    for (const a of diff.added) {
      const r = byId.get(a.lumaGuestId)!;
      await tx.query(
        `insert into roster_guests (source, luma_guest_id, name, email_hash, email_hint, email_ciphertext, approval_status, admission_status,
                                    checked_in_at, source_version, source_hash, staff_reference)
         values ('luma_csv', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          r.lumaGuestId,
          r.name,
          r.email ? emailHash(r.email) : null,
          r.email ? maskEmail(r.email) : null,
          encryptEmail(r.email),
          r.approval,
          admissionFor(r.approval),
          r.checkedInAt,
          parsed.sourceVersion,
          parsed.hash,
          r.staffReference,
        ],
      );
    }
    for (const c of diff.changed) {
      const r = byId.get(c.lumaGuestId)!;
      const cur = existing.get(c.lumaGuestId)!;
      const admission = expectedAdmission(cur, r.approval);
      await tx.query(
        `update roster_guests
            set name = $2, approval_status = $3, admission_status = $4,
                email_hash = coalesce($5, email_hash), email_hint = coalesce($6, email_hint), email_ciphertext = coalesce($7, email_ciphertext),
                checked_in_at = coalesce(checked_in_at, $8), source_version = $9, source_hash = $10,
                staff_reference = coalesce($11, staff_reference), updated_at = now()
          where id = $1`,
        [
          cur.id,
          r.name,
          r.approval,
          admission,
          r.email ? emailHash(r.email) : null,
          r.email ? maskEmail(r.email) : null,
          encryptEmail(r.email),
          r.checkedInAt,
          parsed.sourceVersion,
          parsed.hash,
          r.staffReference,
        ],
      );
    }
    // Unchanged rows still record that this version confirmed them.
    await tx.query(
      `update roster_guests set source_version = $1, source_hash = $2, checked_in_at = coalesce(roster_guests.checked_in_at, x.checked_in_at), updated_at = now()
         from (select unnest($3::text[]) as gid, unnest($4::timestamptz[]) as checked_in_at) x
        where roster_guests.event_id = current_event_id() and roster_guests.luma_guest_id = x.gid and roster_guests.source_hash is distinct from $2`,
      [parsed.sourceVersion, parsed.hash, parsed.rows.map((r) => r.lumaGuestId), parsed.rows.map((r) => r.checkedInAt)],
    );
    if (input.markMissing && diff.removed.length) {
      await tx.query(
        `update roster_guests
            set admission_status = case when checked_in_at is not null then 'needs_reconciliation' else 'not_admitted' end, updated_at = now()
          where event_id = current_event_id() and luma_guest_id = any($1::text[]) and admission_status not in ('revoked','not_admitted')`,
        [diff.removed.map((r) => r.lumaGuestId)],
      );
    }

    const { rows: imp } = await tx.query<{ id: number; created_at: Date }>(
      `insert into roster_imports (source, source_version, source_hash, file_name, row_count, added, changed, removed, unchanged, rejected, imported_by)
       values ('luma_csv', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, created_at`,
      [
        parsed.sourceVersion,
        parsed.hash,
        input.fileName?.slice(0, 200) ?? null,
        diff.rowCount,
        diff.added.length,
        diff.changed.length,
        input.markMissing ? diff.removed.length : 0,
        diff.unchanged,
        diff.rejected.length,
        staff.id,
      ],
    );
    const reconciled = await reconcileIn(tx);
    const counts = {
      added: diff.added.length,
      changed: diff.changed.length,
      removed: input.markMissing ? diff.removed.length : 0,
      unchanged: diff.unchanged,
      rejected: diff.rejected.length,
    };
    return {
      result: { id: `RI-${imp[0].id}`, server_time: new Date(imp[0].created_at).toISOString(), importId: imp[0].id, ...counts, reconciled },
      resourceId: imp[0].id,
      after: { source_version: parsed.sourceVersion, source_hash: parsed.hash, ...counts },
      payload: { file_name: input.fileName ?? null, format: parsed.format, mark_missing: input.markMissing, reconciled },
    };
  });
}

// ── Reconciliation (T-ROS-02) ────────────────────────────────────────────────

export type ReconcileResult = { linked: number; admitted: number; notAdmitted: number; needsReconciliation: number };

/**
 * Link registered members to roster guests by email hash, then set each
 * member's admission_state from their guest row. Members with no roster match
 * become NEEDS_RECONCILIATION once a Luma roster exists. Never deletes anything.
 */
async function reconcileIn(tx: Db): Promise<ReconcileResult> {
  // Keep the hash in step for rows written before 005 (same as emailHash()).
  await tx.query(
    "update members set email_hash = encode(sha256(convert_to(lower(trim(email)), 'UTF8')), 'hex') where email_hash is null and email is not null",
  );
  const { rows: linked } = await tx.query<{ n: number }>(
    `with pairs as (
       select distinct on (m.id) m.id as member_id, g.id as guest_id
         from members m
         join roster_guests g on g.email_hash = m.email_hash and g.event_id = current_event_id()
        where m.deleted_at is null and m.guest_id is null and g.member_id is null
          and not exists (select 1 from members x where x.guest_id = g.id)
        order by m.id, (g.admission_status = 'admitted') desc, g.imported_at desc
     ), lg as (
       update roster_guests g set member_id = p.member_id, updated_at = now() from pairs p where g.id = p.guest_id returning g.id
     ), lm as (
       update members m set guest_id = p.guest_id from pairs p where m.id = p.member_id returning m.id
     )
     select count(*)::int as n from lm`,
  );
  // A guest row that already names its member but the member doesn't point back.
  await tx.query(
    `update members m set guest_id = g.id from roster_guests g
      where g.member_id = m.id and m.guest_id is null and not exists (select 1 from members x where x.guest_id = g.id)`,
  );
  await tx.query(
    `update members m
        set admission_state = case g.admission_status when 'admitted' then 'admitted' when 'needs_reconciliation' then 'needs_reconciliation' else 'not_admitted' end,
            checked_in_at = coalesce(m.checked_in_at, g.checked_in_at)
       from roster_guests g
      where g.id = m.guest_id
        and (m.admission_state is distinct from (case g.admission_status when 'admitted' then 'admitted' when 'needs_reconciliation' then 'needs_reconciliation' else 'not_admitted' end)
             or (m.checked_in_at is null and g.checked_in_at is not null))`,
  );
  await tx.query(
    `update members set admission_state = 'needs_reconciliation'
      where guest_id is null and deleted_at is null and role = 'participant' and admission_state <> 'needs_reconciliation'
        and exists (select 1 from roster_guests where event_id = current_event_id() and source = 'luma_csv')`,
  );
  const { rows } = await tx.query<{ admitted: number; not_admitted: number; needs: number }>(
    `select count(*) filter (where admission_state = 'admitted')::int as admitted,
            count(*) filter (where admission_state = 'not_admitted')::int as not_admitted,
            count(*) filter (where admission_state = 'needs_reconciliation')::int as needs
       from members where deleted_at is null and role = 'participant'`,
  );
  return { linked: linked[0]?.n ?? 0, admitted: rows[0].admitted, notAdmitted: rows[0].not_admitted, needsReconciliation: rows[0].needs };
}

/** Run reconciliation on demand (organizer button, cron, or after a registration). */
export async function reconcileRoster(actor: Actor): Promise<ReconcileResult & Receipt> {
  return withAudit(actor, "roster.reconcile", "roster", async (tx) => {
    const r = await reconcileIn(tx);
    const { rows } = await tx.query<{ now: Date }>("select now()");
    return { result: { ...r, id: "reconcile", server_time: new Date(rows[0].now).toISOString() }, resourceId: "roster", after: r };
  });
}

/** For identity/activation (A02): may this member activate? Unknown or unapproved guests can't. */
export async function getAdmission(memberId: number) {
  const [row] = await query<{ admission_state: string; guest_id: number | null; approval_status: ApprovalStatus | null; admission_status: AdmissionStatus | null; checked_in_at: Date | null }>(
    `select m.admission_state, m.guest_id, g.approval_status, g.admission_status, coalesce(m.checked_in_at, g.checked_in_at) as checked_in_at
       from members m left join roster_guests g on g.id = m.guest_id where m.id = $1`,
    [memberId],
  );
  if (!row) return null;
  return { ...row, admitted: row.admission_status === "admitted" };
}

// ── Check-in desk (T-ROS-03) ─────────────────────────────────────────────────

export type CheckinHit = {
  key: string;
  guestId: number | null;
  memberId: number | null;
  name: string;
  displayName: string | null;
  publicCode: string | null;
  teamName: string | null;
  teamSlug: string | null;
  source: "luma_csv" | "walk_in" | "manual_offline" | "api" | "registration";
  approval: ApprovalStatus | null;
  admission: AdmissionStatus | null;
  memberAdmission: string | null;
  emailHint: string | null;
  checkedInAt: Date | null;
  /** The member has finished activation (has a personal account). */
  activated: boolean;
  /** Event-day checklist in words, e.g. "Activation 2/3 · plan: not registered" (null without a member). */
  checklist: string | null;
} & Provenance;

/** How a roster row was admitted and how its check-in was taken: two separate facts. */
export type Provenance = {
  /** null: admitted by the roster file. */
  admissionBasis: "walk_in_exception" | "desk_override" | "override" | null;
  admittedByName: string | null;
  admittedAt: Date | null;
  admissionReason: string | null;
  checkedInByName: string | null;
  checkinSource: "desk" | "offline_ledger" | "import" | null;
  /** The paper slip id for an offline_ledger check-in. */
  checkinRef: string | null;
  checkinEnteredAt: Date | null;
};

type ProvenanceCols = {
  admission_basis: Provenance["admissionBasis"];
  admitted_by_name: string | null;
  admitted_at: Date | null;
  admission_reason: string | null;
  checked_in_by_name: string | null;
  checkin_source: Provenance["checkinSource"];
  checkin_ref: string | null;
  checkin_entered_at: Date | null;
};

/** Select list for ProvenanceCols, given roster_guests as g, admitter as ab and checker as cb. */
const PROVENANCE_SQL = `g.admission_basis, ab.name as admitted_by_name, g.admitted_at, g.admission_reason, cb.name as checked_in_by_name,
              g.checkin_source, g.checkin_ref, g.checkin_entered_at`;
const PROVENANCE_JOINS = `left join staff_accounts ab on ab.id = g.admitted_by left join staff_accounts cb on cb.id = g.checked_in_by`;

const provenance = (r: ProvenanceCols): Provenance => ({
  admissionBasis: r.admission_basis,
  admittedByName: r.admitted_by_name,
  admittedAt: r.admitted_at,
  admissionReason: r.admission_reason,
  checkedInByName: r.checked_in_by_name,
  checkinSource: r.checkin_source,
  checkinRef: r.checkin_ref,
  checkinEnteredAt: r.checkin_entered_at,
});

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Find people by name, P-code, Luma guest id or exact email (compared by hash).
 * Covers roster guests (linked or not) and registered members with no roster row.
 */
export async function searchCheckin(raw: string, limit = 25): Promise<CheckinHit[]> {
  const q = raw.trim().slice(0, 120);
  if (q.length < 2) return [];
  const code = /^p-?(\d{3,6})$/i.exec(q);
  const email = q.includes("@") ? emailHash(q) : null;
  const like = `%${likeEscape(q.toLowerCase())}%`;
  const rows = await query<{
    guest_id: number | null;
    member_id: number | null;
    name: string;
    display_name: string | null;
    public_code: string | null;
    team_name: string | null;
    team_slug: string | null;
    source: CheckinHit["source"];
    approval_status: ApprovalStatus | null;
    admission_status: AdmissionStatus | null;
    admission_state: string | null;
    email_hint: string | null;
    checked_in_at: Date | null;
    activated: boolean;
  } & ProvenanceCols>(
    `with hits as (
       select g.id as guest_id, m.id as member_id, coalesce(m.name, g.name) as name, m.display_name, m.public_code,
              t.name as team_name, t.slug as team_slug, g.source, g.approval_status, g.admission_status, m.admission_state,
              g.email_hint, coalesce(g.checked_in_at, m.checked_in_at) as checked_in_at, (m.activated_at is not null) as activated, ${PROVENANCE_SQL}
         from roster_guests g
         left join members m on m.id = coalesce(g.member_id, (select x.id from members x where x.guest_id = g.id limit 1)) and m.deleted_at is null
         left join teams t on t.id = m.team_id
         ${PROVENANCE_JOINS}
        where g.event_id = current_event_id()
          and ( ($1::text is not null and upper(m.public_code) = $1)
             or ($2::text is not null and (g.email_hash = $2 or m.email_hash = $2))
             or ($1::text is null and $2::text is null and (lower(g.name) like $3 escape '\\' or lower(m.name) like $3 escape '\\'
                  or lower(coalesce(m.display_name, '')) like $3 escape '\\' or g.luma_guest_id = $4 or lower(coalesce(t.name, '')) like $3 escape '\\')) )
       union all
       select null, m.id, m.name, m.display_name, m.public_code, t.name, t.slug, 'registration', null, null, m.admission_state,
              null, m.checked_in_at, (m.activated_at is not null), null, null, null, null, null, null, null, null
         from members m left join teams t on t.id = m.team_id
        where m.deleted_at is null and m.guest_id is null and m.role = 'participant'
          and not exists (select 1 from roster_guests g where g.member_id = m.id)
          and ( ($1::text is not null and upper(m.public_code) = $1)
             or ($2::text is not null and m.email_hash = $2)
             or ($1::text is null and $2::text is null and (lower(m.name) like $3 escape '\\' or lower(coalesce(m.display_name, '')) like $3 escape '\\'
                  or lower(coalesce(t.name, '')) like $3 escape '\\')) )
     )
     select * from hits order by checked_in_at is not null, lower(name) limit $5`,
    [code ? `P-${code[1]}` : null, email, like, q, limit],
  );
  const memberIds = rows.map((r) => r.member_id).filter((x): x is number => !!x);
  const steps = memberIds.length
    ? await query<{ member_id: number; ticks: number; plan: string | null; code: boolean }>(
        `select m.id as member_id, (select count(*)::int from activation_ticks a where a.member_id = m.id) as ticks,
                (select c.status from testmu_plan_claims c where c.member_id = m.id) as plan,
                exists (select 1 from codex_credit_codes k where k.assigned_member_id = m.id and k.status = 'assigned') as code
           from members m where m.id = any($1::bigint[])`,
        [memberIds],
      ).catch(() => [])
    : [];
  const checklist = new Map(steps.map((s) => [s.member_id, `Activation ${s.ticks}/3${s.plan && s.plan !== "claimed" ? ` · plan: ${s.plan.replace("_", " ")}` : ""}${s.code ? " · Codex code given" : ""}`]));
  return rows.map((r) => ({
    checklist: r.member_id ? (checklist.get(r.member_id) ?? null) : null,
    key: r.guest_id ? `g${r.guest_id}` : `m${r.member_id}`,
    guestId: r.guest_id,
    memberId: r.member_id,
    name: r.name,
    displayName: r.display_name,
    publicCode: r.public_code,
    teamName: r.team_name,
    teamSlug: r.team_slug,
    source: r.source,
    approval: r.approval_status,
    admission: r.admission_status,
    memberAdmission: r.admission_state,
    emailHint: r.email_hint,
    checkedInAt: r.checked_in_at,
    activated: r.activated,
    ...provenance(r),
  }));
}

export type CheckinReceipt = Receipt & {
  guestId: number;
  memberId: number | null;
  publicCode: string | null;
  name: string;
  checkedInAt: string;
  alreadyCheckedIn: boolean;
  createdMember?: boolean;
  createdGuest?: boolean;
};

/** SET fragment for a desk check-in: stamps how and when only on the first check-in (SET sees the old row). */
const DESK_CHECKIN = "checkin_source = case when checked_in_at is null then 'desk' else checkin_source end, checkin_entered_at = case when checked_in_at is null then now() else checkin_entered_at end";

/**
 * Mark a roster guest checked in (server time, staff id). An unapproved guest
 * needs an organizer `override` with a reason. Checking in twice returns the
 * first check-in, not a new time.
 */
export async function checkInGuest(
  input: { guestId: number; override?: { reason: string } | null; idempotencyKey?: string | null },
  staff: Staff,
): Promise<CheckinReceipt> {
  const actor = staffActor(staff);
  const { result } = await idempotent(input.idempotencyKey, `checkin.guest:${input.guestId}`, () =>
    withAudit(actor, "checkin.guest", "roster_guest", async (tx) => {
      const { rows } = await tx.query<ExistingGuest & { member_id: number | null; source: string }>(
        `select id, luma_guest_id, name, approval_status, admission_status, email_hash, email_hint, checked_in_at, member_id, source
           from roster_guests where id = $1 and event_id = current_event_id() for update`,
        [input.guestId],
      );
      const g = rows[0];
      if (!g) throw new AppError("NOT_FOUND", { userMessage: "No roster row with that id." });
      let reason: string | null = null;
      if (g.admission_status !== "admitted") {
        if (!input.override) {
          throw new AppError("NOT_APPROVED", {
            userMessage: `This guest is ${g.admission_status.replace("_", " ")} (Luma: ${g.approval_status.replace("_", " ")}). An organizer can admit them with a reason.`,
          });
        }
        if (staff.role !== "organizer" && staff.role !== "admin") throw new AppError("FORBIDDEN", { userMessage: "Only an organizer can admit a guest who isn't approved." });
        reason = input.override.reason;
        await tx.query(
          `update roster_guests set admission_status = 'admitted', staff_reference = $2, admission_basis = 'desk_override', admitted_by = $3, admitted_at = now(),
                  admission_reason = $4, updated_at = now() where id = $1`,
          [g.id, `admitted at desk: ${reason}`.slice(0, 200), staff.id, reason.slice(0, 300)],
        );
      }
      const memberId = g.member_id ?? (await tx.query<{ id: number }>("select id from members where guest_id = $1", [g.id])).rows[0]?.id ?? null;
      const already = !!g.checked_in_at;
      const { rows: up } = await tx.query<{ checked_in_at: Date }>(
        `update roster_guests set checked_in_at = coalesce(checked_in_at, now()), checked_in_by = coalesce(checked_in_by, $2), ${DESK_CHECKIN}, updated_at = now()
          where id = $1 returning checked_in_at`,
        [g.id, staff.id],
      );
      let publicCode: string | null = null;
      if (memberId) {
        const { rows: m } = await tx.query<{ public_code: string | null }>(
          "update members set checked_in_at = coalesce(checked_in_at, now()), admission_state = 'admitted', guest_id = coalesce(guest_id, $2) where id = $1 returning public_code",
          [memberId, g.id],
        );
        publicCode = m[0]?.public_code ?? null;
      }
      const { rows: n } = await tx.query<{ now: Date }>("select now()");
      return {
        result: {
          id: `CI-${g.id}`,
          server_time: new Date(n[0].now).toISOString(),
          guestId: g.id,
          memberId,
          publicCode,
          name: g.name,
          checkedInAt: new Date(up[0].checked_in_at).toISOString(),
          alreadyCheckedIn: already,
        },
        resourceId: g.id,
        reason,
        before: { checked_in_at: g.checked_in_at, admission_status: g.admission_status },
        after: { checked_in_at: up[0].checked_in_at, admission_status: "admitted" },
        payload: { override: !!input.override, member_id: memberId, already_checked_in: already },
      };
    }),
  );
  return result;
}

/**
 * Admit a walk-in at the desk: find or create their member (by email), find or
 * create a roster row (source 'walk_in'), link the two and check them in.
 * If the email already has a roster row (e.g. waitlisted on Luma), that row is
 * admitted instead of creating a duplicate, and the reason is recorded.
 */
export async function admitWalkIn(
  input: { name: string; email: string; displayName?: string | null; note?: string | null; idempotencyKey?: string | null },
  staff: Staff,
): Promise<CheckinReceipt> {
  const actor = staffActor(staff);
  const hash = emailHash(input.email);
  const { result } = await idempotent(input.idempotencyKey, `checkin.walk_in:${hash.slice(0, 16)}`, () =>
    withAudit(actor, "checkin.walk_in", "roster_guest", async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`walkin:${hash}`]);
      const note = input.note?.trim() || null;
      const { rows: ms } = await tx.query<{ id: number; name: string; guest_id: number | null; public_code: string | null; admission_state: string | null }>(
        "select id, name, guest_id, public_code, admission_state from members where lower(email) = lower($1) and deleted_at is null for update",
        [input.email.trim()],
      );
      let member = ms[0] ?? null;
      // Walk-in admission is for people we've never heard of. Admitting someone
      // the roster says is declined, waitlisted, removed or revoked is an
      // override: organizer only, with a reason (same rule as checkInGuest).
      const isOrganizer = staff.role === "organizer" || staff.role === "admin";
      const needOverride = (status: string) => {
        if (!isOrganizer) {
          throw new AppError("FORBIDDEN", {
            userMessage: `This person is on the roster as ${status.replace(/_/g, " ")}. Only an organizer can admit them; ask one to come to the desk.`,
          });
        }
        if (!note) throw new AppError("VALIDATION_FAILED", { userMessage: `They are on the roster as ${status.replace(/_/g, " ")}. Add a reason in the note to override.` });
      };
      const { rows: gs } = await tx.query<{ id: number; admission_status: AdmissionStatus; member_id: number | null; name: string }>(
        `select id, admission_status, member_id, name from roster_guests
          where event_id = current_event_id() and (email_hash = $1 or id = $2 or member_id = $3)
          order by (admission_status = 'admitted') desc, id limit 1 for update`,
        [hash, member?.guest_id ?? null, member?.id ?? null],
      );
      let guest = gs[0] ?? null;
      let createdGuest = false;
      let createdMember = false;
      let reason: string | null = note;
      // Set when this call admits them (not on the roster, or over a status): the staff walk-in exception.
      let exception = false;
      if (guest && guest.admission_status !== "admitted") needOverride(guest.admission_status);
      else if (!guest && member && member.admission_state && !["admitted", "unknown"].includes(member.admission_state)) needOverride(member.admission_state);
      if (guest) {
        if (guest.admission_status !== "admitted") {
          reason = `walk-in admit over ${guest.admission_status}${note ? `: ${note}` : ""}`;
          exception = true;
          await tx.query(
            `update roster_guests set admission_status = 'admitted', staff_reference = $2, admission_basis = 'walk_in_exception', admitted_by = $3, admitted_at = now(),
                    admission_reason = $2, updated_at = now() where id = $1`,
            [guest.id, reason.slice(0, 200), staff.id],
          );
        }
      } else {
        // Not on the roster at all: the staff walk-in exception, recorded on the row (who, when, why).
        const { rows } = await tx.query<{ id: number; admission_status: AdmissionStatus; member_id: number | null; name: string }>(
          `insert into roster_guests (source, name, email_hash, email_hint, email_ciphertext, approval_status, admission_status, source_version, staff_reference,
                                      admission_basis, admitted_by, admitted_at, admission_reason)
           values ('walk_in', $1, $2, $3, $4, 'walk_in', 'admitted', 'walk-in', $5, 'walk_in_exception', $6, now(), $7) returning id, admission_status, member_id, name`,
          [input.name.trim(), hash, maskEmail(input.email), encryptEmail(input.email), note?.slice(0, 200) ?? null, staff.id, (note ?? "walk-in, not on the Luma roster").slice(0, 300)],
        );
        guest = rows[0];
        createdGuest = true;
        exception = true;
      }
      if (!member) {
        const { rows } = await tx.query<{ id: number; name: string; guest_id: number | null; public_code: string | null; admission_state: string | null }>(
          `insert into members (team_id, name, email, email_hash, display_name, admission_state, checked_in_at, guest_id)
           values (null, $1, $2, $3, $4, 'admitted', now(), $5) returning id, name, guest_id, public_code, admission_state`,
          [input.name.trim(), input.email.trim().toLowerCase(), hash, input.displayName?.trim() || null, guest.id],
        );
        member = rows[0];
        createdMember = true;
      } else {
        await tx.query(
          `update members set checked_in_at = coalesce(checked_in_at, now()), admission_state = 'admitted',
                  guest_id = case when guest_id is null and not exists (select 1 from members x where x.guest_id = $2) then $2 else guest_id end
            where id = $1`,
          [member.id, guest.id],
        );
      }
      const { rows: up } = await tx.query<{ checked_in_at: Date; already: boolean }>(
        `update roster_guests set member_id = coalesce(member_id, $2), checked_in_at = coalesce(checked_in_at, now()),
                checked_in_by = coalesce(checked_in_by, $3), ${DESK_CHECKIN}, updated_at = now()
          where id = $1 returning checked_in_at, (checked_in_at < now()) as already`,
        [guest.id, member.id, staff.id],
      );
      // Admission and attendance are two facts: checkin.walk_in (below, via
      // withAudit) records the admission; this records the check-in itself.
      if (!up[0].already) {
        await writeAudit(
          actor,
          { action: "checkin.guest", resourceType: "roster_guest", resourceId: guest.id, after: { checked_in_at: up[0].checked_in_at }, payload: { via: "walk_in", member_id: member.id } },
          tx,
        );
      }
      const { rows: n } = await tx.query<{ now: Date }>("select now()");
      return {
        result: {
          id: `CI-${guest.id}`,
          server_time: new Date(n[0].now).toISOString(),
          guestId: guest.id,
          memberId: member.id,
          publicCode: member.public_code,
          name: member.name,
          checkedInAt: new Date(up[0].checked_in_at).toISOString(),
          alreadyCheckedIn: up[0].already,
          createdGuest,
          createdMember,
        },
        resourceId: guest.id,
        reason,
        after: { guest_id: guest.id, member_id: member.id, public_code: member.public_code, source: createdGuest ? "walk_in" : "existing" },
        payload: { created_guest: createdGuest, created_member: createdMember, admission_basis: exception ? "walk_in_exception" : null },
      };
    }),
  );
  return result;
}

/** A registered member with no roster row: admit them at the desk as a walk-in (keeps their existing member). */
export async function admitRegisteredMember(input: { memberId: number; note?: string | null; idempotencyKey?: string | null }, staff: Staff) {
  const [m] = await query<{ name: string; email: string; display_name: string | null }>("select name, email, display_name from members where id = $1 and deleted_at is null", [input.memberId]);
  if (!m) throw new AppError("NOT_FOUND");
  return admitWalkIn({ name: m.name, email: m.email, displayName: m.display_name, note: input.note ?? "registered on site, not on the Luma roster", idempotencyKey: input.idempotencyKey }, staff);
}

// ── Internal API: add people to the participant list ─────────────────────────

export type RosterAddOutcome = "added" | "already_on_list" | "revoked";

/**
 * /api/import/roster: put people on the participant list (source 'api', approved and
 * admitted) so they can get a Codex coupon. Nobody is checked in and no member is
 * created. An email already on the list is left as it is; one an organizer revoked
 * stays revoked (re-admit them at /ops/checkin).
 */
export async function addRosterPeople(people: { email: string; name: string | null }[]) {
  const actor: Actor = { type: "system", label: "roster-api" };
  return withAudit(actor, "roster.api_add", "roster_guest", async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('roster:api_add'))");
    const results: { email: string; outcome: RosterAddOutcome }[] = [];
    for (const p of people) {
      const hash = emailHash(p.email);
      const { rows } = await tx.query<{ admission_status: AdmissionStatus }>("select admission_status from roster_guests where event_id = current_event_id() and email_hash = $1", [hash]);
      if (rows.some((r) => r.admission_status === "revoked")) results.push({ email: p.email, outcome: "revoked" });
      else if (rows.length) results.push({ email: p.email, outcome: "already_on_list" });
      else {
        await tx.query(
          `insert into roster_guests (source, name, email_hash, email_hint, email_ciphertext, approval_status, admission_status, source_version)
           values ('api', $1, $2, $3, $4, 'approved', 'admitted', 'api')`,
          [p.name ?? p.email.split("@")[0], hash, maskEmail(p.email), encryptEmail(p.email)],
        );
        results.push({ email: p.email, outcome: "added" });
      }
    }
    const count = (o: RosterAddOutcome) => results.filter((r) => r.outcome === o).length;
    const summary = { added: count("added"), already_on_list: count("already_on_list"), revoked: count("revoked") };
    return { result: { ...summary, people: results }, resourceId: "api", payload: summary };
  });
}

// ── Badge ────────────────────────────────────────────────────────────────────

export type Badge = { publicCode: string; name: string; displayName: string | null; teamName: string | null; checkedInAt: Date | null; source: string | null };

/** What a printed badge shows: name, P-code and team. No email, no token. */
export async function getBadge(publicCode: string): Promise<Badge | null> {
  const [b] = await query<{ public_code: string; name: string; display_name: string | null; team_name: string | null; checked_in_at: Date | null; source: string | null }>(
    `select m.public_code, m.name, m.display_name, t.name as team_name, coalesce(m.checked_in_at, g.checked_in_at) as checked_in_at, g.source
       from members m left join teams t on t.id = m.team_id left join roster_guests g on g.id = m.guest_id
      where upper(m.public_code) = upper($1) and m.deleted_at is null`,
    [publicCode.trim()],
  );
  return b
    ? { publicCode: b.public_code, name: b.name, displayName: b.display_name, teamName: b.team_name, checkedInAt: b.checked_in_at, source: b.source }
    : null;
}

// ── Roster views and export (T-FB-03) ────────────────────────────────────────

export type RosterRow = {
  id: number;
  source: string;
  luma_guest_id: string | null;
  name: string;
  email_hint: string | null;
  approval_status: ApprovalStatus;
  admission_status: AdmissionStatus;
  checked_in_at: Date | null;
  member_id: number | null;
  public_code: string | null;
  team_name: string | null;
  source_version: string | null;
  staff_reference: string | null;
} & ProvenanceCols;

export type RosterFilter = "all" | "admitted" | "checked_in" | "not_checked_in" | "walk_in" | "not_admitted" | "needs_reconciliation" | "unlinked";

export async function listRoster(opts: { filter?: RosterFilter; q?: string; limit?: number } = {}) {
  const filter = opts.filter ?? "all";
  const cond: Record<RosterFilter, string> = {
    all: "true",
    admitted: "g.admission_status = 'admitted'",
    checked_in: "g.checked_in_at is not null",
    not_checked_in: "g.checked_in_at is null and g.admission_status = 'admitted'",
    walk_in: "g.source = 'walk_in'",
    not_admitted: "g.admission_status in ('not_admitted','revoked')",
    needs_reconciliation: "g.admission_status = 'needs_reconciliation'",
    unlinked: "m.id is null",
  };
  const q = opts.q?.trim() ? `%${likeEscape(opts.q.trim().toLowerCase())}%` : null;
  return query<RosterRow>(
    `select g.id, g.source, g.luma_guest_id, g.name, g.email_hint, g.approval_status, g.admission_status, g.checked_in_at,
            m.id as member_id, m.public_code, t.name as team_name, g.source_version, g.staff_reference, ${PROVENANCE_SQL}
       from roster_guests g
       left join members m on m.id = coalesce(g.member_id, (select x.id from members x where x.guest_id = g.id limit 1))
       left join teams t on t.id = m.team_id
       ${PROVENANCE_JOINS}
      where g.event_id = current_event_id() and ${cond[filter]}
        and ($1::text is null or lower(g.name) like $1 escape '\\' or g.luma_guest_id = $2 or upper(coalesce(m.public_code, '')) = upper($2))
      order by lower(g.name)
      limit $3`,
    [q, opts.q?.trim() ?? "", opts.limit ?? 2000],
  );
}

/** Registered members with no roster row (NEEDS_RECONCILIATION). */
export async function listUnmatchedMembers(limit = 500) {
  return query<{ id: number; name: string; public_code: string | null; team_name: string | null; team_slug: string | null; admission_state: string; created_at: Date }>(
    `select m.id, m.name, m.public_code, t.name as team_name, t.slug as team_slug, m.admission_state, m.created_at
       from members m left join teams t on t.id = m.team_id
      where m.deleted_at is null and m.role = 'participant' and m.guest_id is null
        and not exists (select 1 from roster_guests g where g.member_id = m.id)
      order by m.created_at desc limit $1`,
    [limit],
  );
}

export type RosterStats = {
  guests: number;
  admitted: number;
  checkedIn: number;
  walkIns: number;
  notAdmitted: number;
  needsReconciliation: number;
  unmatchedMembers: number;
  members: number;
  lastImport: { id: number; source_version: string; source_hash: string; created_at: Date; row_count: number; imported_by_name: string | null } | null;
  asOf: Date;
};

export async function rosterStats(): Promise<RosterStats> {
  const [[s], [imp]] = await Promise.all([
    query<{ guests: number; admitted: number; checked_in: number; walk_ins: number; not_admitted: number; needs: number; unmatched: number; members: number; now: Date }>(
      `select count(*)::int as guests,
              count(*) filter (where admission_status = 'admitted')::int as admitted,
              count(*) filter (where checked_in_at is not null)::int as checked_in,
              count(*) filter (where source = 'walk_in')::int as walk_ins,
              count(*) filter (where admission_status in ('not_admitted','revoked'))::int as not_admitted,
              count(*) filter (where admission_status = 'needs_reconciliation')::int as needs,
              (select count(*)::int from members m where m.deleted_at is null and m.role = 'participant' and m.guest_id is null
                  and not exists (select 1 from roster_guests x where x.member_id = m.id)) as unmatched,
              (select count(*)::int from members m where m.deleted_at is null and m.role = 'participant') as members,
              now() as now
         from roster_guests where event_id = current_event_id()`,
    ),
    query<NonNullable<RosterStats["lastImport"]>>(
      `select i.id, i.source_version, i.source_hash, i.created_at, i.row_count, s.name as imported_by_name
         from roster_imports i left join staff_accounts s on s.id = i.imported_by
        where i.event_id = current_event_id() order by i.created_at desc limit 1`,
    ),
  ]);
  return {
    guests: s.guests,
    admitted: s.admitted,
    checkedIn: s.checked_in,
    walkIns: s.walk_ins,
    notAdmitted: s.not_admitted,
    needsReconciliation: s.needs,
    unmatchedMembers: s.unmatched,
    members: s.members,
    lastImport: imp ?? null,
    asOf: s.now,
  };
}

export async function listRosterImports(limit = 20) {
  return query<{ id: number; source: string; source_version: string; source_hash: string; file_name: string | null; row_count: number; added: number; changed: number; removed: number; unchanged: number; rejected: number; imported_by_name: string | null; created_at: Date }>(
    `select i.*, s.name as imported_by_name from roster_imports i left join staff_accounts s on s.id = i.imported_by
      where i.event_id = current_event_id() order by i.created_at desc limit $1`,
    [limit],
  );
}

/** HMAC over a document hash with the receipt key (or the session secret), so a printed copy can be checked later. */
export function signDigest(hexDigest: string) {
  const key = process.env.RECEIPT_SIGNING_KEY ?? process.env.SESSION_SECRET;
  return key ? createHmac("sha256", key).update(hexDigest).digest("hex") : null;
}

export const ROSTER_EXPORT_HEADERS = [
  "roster_id",
  "luma_guest_id",
  "source",
  "name",
  "public_code",
  "team",
  "approval_status",
  "admission_status",
  "email_hint",
  "checked_in_at",
  "source_version",
] as const;

/**
 * The "last signed roster" for offline check-in: CSV with no full emails,
 * plus its sha256 and HMAC signature (sent as headers and shown on the
 * printable copy). Audited, because it is a PII-bearing export.
 */
export async function exportRoster(staff: Staff) {
  const rows = await listRoster({ filter: "all", limit: 10000 });
  const csv = toCsv([
    [...ROSTER_EXPORT_HEADERS],
    ...rows.map((r) => [r.id, r.luma_guest_id, r.source, r.name, r.public_code, r.team_name, r.approval_status, r.admission_status, r.email_hint, r.checked_in_at, r.source_version]),
  ]);
  const digest = sha256(csv);
  const signature = signDigest(digest);
  const [{ now }] = await query<{ now: Date }>("select now()");
  await writeAudit(staffActor(staff), { action: "roster.export", resourceType: "roster", resourceId: "roster", after: { rows: rows.length, sha256: digest } });
  return { csv, rows, digest, signature, exportedAt: now };
}

// ── Luma webhook (T-ROS-04) ──────────────────────────────────────────────────

/** Upsert one guest from a verified Luma webhook. Same admission rules as the CSV import. */
export async function upsertGuestFromLuma(input: { lumaGuestId: string; name: string; email: string | null; approval: string; eventType: string }) {
  const approval: ApprovalStatus = APPROVAL_ALIASES[input.approval.toLowerCase().replace(/[\s-]+/g, "_")] ?? "pending_approval";
  return withAudit({ type: "system", label: "luma webhook" }, `roster.luma_${input.eventType.replace(/\W+/g, "_")}`, "roster_guest", async (tx) => {
    const { rows: cur } = await tx.query<ExistingGuest>(
      `select id, luma_guest_id, name, approval_status, admission_status, email_hash, email_hint, checked_in_at
         from roster_guests where event_id = current_event_id() and luma_guest_id = $1 for update`,
      [input.lumaGuestId],
    );
    const target = admissionFor(approval);
    let id: number;
    if (cur[0]) {
      const c = cur[0];
      const admission: AdmissionStatus = c.admission_status === "revoked" ? "revoked" : c.checked_in_at && target !== "admitted" ? "needs_reconciliation" : target;
      await tx.query(
        `update roster_guests set name = $2, approval_status = $3, admission_status = $4,
                email_hash = coalesce($5, email_hash), email_hint = coalesce($6, email_hint), email_ciphertext = coalesce($7, email_ciphertext),
                source_version = 'luma-webhook', updated_at = now()
          where id = $1`,
        [c.id, input.name, approval, admission, input.email ? emailHash(input.email) : null, input.email ? maskEmail(input.email) : null, encryptEmail(input.email)],
      );
      id = c.id;
    } else {
      const { rows } = await tx.query<{ id: number }>(
        `insert into roster_guests (source, luma_guest_id, name, email_hash, email_hint, email_ciphertext, approval_status, admission_status, source_version)
         values ('luma_csv', $1, $2, $3, $4, $5, $6, $7, 'luma-webhook') returning id`,
        [input.lumaGuestId, input.name, input.email ? emailHash(input.email) : null, input.email ? maskEmail(input.email) : null, encryptEmail(input.email), approval, target],
      );
      id = rows[0].id;
    }
    await reconcileIn(tx);
    return { result: { id }, resourceId: id, after: { approval_status: approval } };
  });
}

export const APPROVAL_STATUSES = APPROVALS;
