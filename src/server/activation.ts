import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { getEvent } from "@/lib/event";
import { setMemberSession } from "@/lib/session";
import { getMemberById, memberActor, newToken, randomCode, tokenHash, type MemberRow } from "./auth";
import { AppError, emailHash, idempotent, maskEmail, sha256, siteUrl, transaction, withAudit, writeAudit, type Actor } from "./core";
import { formatCode } from "./pairing";
import { appendConsents, deleteBlobs, getConsents, updateProfile, type ConsentChanges, type ProfilePatch } from "./passport";

// Activation (T-ACT-01..07): a durable, checkpointed state machine around
// one person's first visit, so Kane can drive the boring parts and a human
// always takes (or skips) the selfie.
//
//   invited → paired → identity_confirmed → ready_for_camera → selfie_pending
//     → selfie_confirmed | selfie_skipped → active   (+ browser_verified after
//   active, when Kane run B reports), with action_required (not on the roster)
//   and recoverable_error (an upload failed) as side branches.
//
// Every transition writes an activation_checkpoints row; the unique
// (activation, checkpoint, status) index makes retries no-ops, and the
// session row is locked FOR UPDATE while it moves, so a double click, a
// crashed tab or a second device can't fork it. Reopening /activate resumes
// from the stored status (T-ACT-05). See docs/hack-os/ACTIVATION_CONTRACT.md.

export const ACTIVATION_STATUSES = [
  "invited",
  "paired",
  "identity_confirmed",
  "ready_for_camera",
  "selfie_pending",
  "selfie_confirmed",
  "selfie_skipped",
  "browser_verified",
  "active",
  "action_required",
  "recoverable_error",
  "expired",
] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

/** Allowed moves. Same-status moves are no-ops, not errors. */
const NEXT: Record<ActivationStatus, ActivationStatus[]> = {
  invited: ["paired", "action_required", "expired"],
  paired: ["identity_confirmed", "action_required", "recoverable_error", "expired"],
  identity_confirmed: ["ready_for_camera", "expired"],
  ready_for_camera: ["selfie_pending", "selfie_confirmed", "selfie_skipped", "identity_confirmed", "expired"],
  selfie_pending: ["selfie_confirmed", "selfie_skipped", "ready_for_camera", "recoverable_error", "expired"],
  selfie_confirmed: ["browser_verified", "active"],
  selfie_skipped: ["browser_verified", "active", "ready_for_camera"],
  browser_verified: ["active"],
  active: [],
  action_required: ["paired", "expired"],
  recoverable_error: ["paired", "ready_for_camera", "selfie_pending", "expired"],
  expired: [],
};

/** The UI step for a status (the page renders one step at a time). */
export type ActivationStep = "code" | "admission" | "identity" | "consent" | "camera" | "receipt" | "blocked";

export function stepFor(status: ActivationStatus, admissionConfirmed: boolean): ActivationStep {
  switch (status) {
    case "invited":
      return "code";
    case "paired":
      return admissionConfirmed ? "identity" : "admission";
    case "identity_confirmed":
      return "consent";
    case "ready_for_camera":
    case "selfie_pending":
    case "recoverable_error":
      return "camera";
    case "selfie_confirmed":
    case "selfie_skipped":
    case "browser_verified":
    case "active":
      return "receipt";
    case "action_required":
      return "blocked";
    case "expired":
      return "code";
  }
}

export type CheckpointActor = "participant" | "kane" | "staff" | "system";

export type ActivationSession = {
  id: number;
  member_id: number | null;
  guest_id: number | null;
  status: ActivationStatus;
  expires_at: Date;
  kane_run_id: string | null;
  receipt_code: string | null;
  created_at: Date;
  updated_at: Date;
};

const SESSION_COLS = "id, member_id, guest_id, status, expires_at, kane_run_id, receipt_code, created_at, updated_at";

async function lockSession(tx: PoolClient, id: number) {
  const { rows } = await tx.query<ActivationSession>(`select ${SESSION_COLS} from activation_sessions where id = $1 for update`, [id]);
  if (!rows[0]) throw new AppError("NOT_FOUND");
  return rows[0];
}

/** Write a checkpoint row (idempotent). */
async function checkpoint(tx: PoolClient, activationId: number, name: string, status: string, actor: CheckpointActor, payload: Record<string, unknown> = {}, runId: string | null = null) {
  await tx.query(
    `insert into activation_checkpoints (activation_id, checkpoint, status, actor, run_id, payload)
     values ($1, $2, $3, $4, $5, $6) on conflict (activation_id, checkpoint, status) do nothing`,
    [activationId, name, status, actor, runId, JSON.stringify(payload)],
  );
}

/**
 * Move a locked session to `to`, or throw CONFLICT if that move isn't allowed
 * from where it is. Moving to the status it already has is a no-op.
 */
async function advance(tx: PoolClient, s: ActivationSession, to: ActivationStatus, actor: CheckpointActor, payload: Record<string, unknown> = {}, runId: string | null = null) {
  if (s.status === to) return s;
  if (!NEXT[s.status].includes(to)) {
    throw new AppError("CONFLICT", { userMessage: `This activation is at “${s.status.replace(/_/g, " ")}”, so it can’t move to “${to.replace(/_/g, " ")}”. Reload to continue.` });
  }
  await tx.query("update activation_sessions set status = $2, updated_at = now() where id = $1", [s.id, to]);
  await checkpoint(tx, s.id, to, "reached", actor, { from: s.status, ...payload }, runId);
  return { ...s, status: to };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** The member's live session (an active one wins), or null. */
export async function findSession(memberId: number) {
  const [s] = await query<ActivationSession>(
    `select ${SESSION_COLS} from activation_sessions
      where member_id = $1 and status not in ('expired','invited') and (expires_at > now() or status = 'active')
      order by (status = 'active') desc, created_at desc limit 1`,
    [memberId],
  );
  return s ?? null;
}

async function sessionExpiry() {
  const ev = await getEvent();
  return new Date(ev.endsAt.getTime() + 86_400_000);
}

/**
 * Begin or resume (T-ACT-05): a signed-in member gets their existing session
 * back, or a new one that starts at `paired` (signing in is the pairing).
 * Serialised on the member row, so two tabs never create two sessions.
 */
export async function beginActivation(member: MemberRow, actor: Actor = memberActor(member)) {
  const existing = await findSession(member.id);
  if (existing) return existing;
  const expires = await sessionExpiry();
  return withAudit(actor, "activation.begin", "activation_session", async (tx) => {
    await tx.query("select id from members where id = $1 for update", [member.id]);
    const { rows: again } = await tx.query<ActivationSession>(
      `select ${SESSION_COLS} from activation_sessions where member_id = $1 and status not in ('expired','invited') and (expires_at > now() or status = 'active')
        order by (status = 'active') desc, created_at desc limit 1`,
      [member.id],
    );
    if (again[0]) return { result: again[0], resourceId: again[0].id };
    const { rows } = await tx.query<ActivationSession>(
      `insert into activation_sessions (member_id, guest_id, pair_token_hash, status, expires_at)
       select id, guest_id, $2, 'paired', $3 from members where id = $1 returning ${SESSION_COLS}`,
      [member.id, sha256(`session:${randomUUID()}`), expires],
    );
    const s = rows[0];
    await checkpoint(tx, s.id, "paired", "reached", actor.type === "token" ? "kane" : "participant", { via: actor.type });
    // A member who was already activated by staff (paper form) resumes at the receipt.
    if (member.activated_at) {
      await tx.query("update activation_sessions set status = 'active', receipt_code = $2 where id = $1", [s.id, `AC-${randomCode(6)}`]);
      await checkpoint(tx, s.id, "active", "reached", "system", { reason: "already_activated" });
      return { result: { ...s, status: "active" as const }, resourceId: s.id };
    }
    return { result: s, resourceId: s.id };
  });
}

// ── Activation codes (desk, Kane link) ───────────────────────────────────────

/**
 * An activation code for a member, or for a roster guest who has no account
 * yet (a Luma guest or walk-in). Shown once; only its hash is stored.
 * Exported for admissions-ops (/ops/checkin) and used by /api/v1/activate/start.
 */
export async function issueActivationCode(target: { memberId?: number; guestId?: number }, actor: Actor, minutes = 60 * 24) {
  if (!target.memberId && !target.guestId) throw new AppError("VALIDATION_FAILED");
  const code = randomCode(8);
  const row = await withAudit(actor, "activation.issue_code", "activation_session", async (tx) => {
    const { rows } = await tx.query<{ id: number; expires_at: Date }>(
      `insert into activation_sessions (member_id, guest_id, pair_token_hash, status, expires_at)
       values ($1, $2, $3, 'invited', now() + make_interval(mins => $4)) returning id, expires_at`,
      [target.memberId ?? null, target.guestId ?? null, sha256(`code:${code}`), minutes],
    );
    await checkpoint(tx, rows[0].id, "invited", "reached", actor.type === "staff" ? "staff" : actor.type === "token" ? "kane" : "system");
    return { result: rows[0], resourceId: rows[0].id };
  });
  const pretty = formatCode(code);
  return { code: pretty, url: siteUrl(`/activate?code=${pretty}`), expires_at: row.expires_at, activation_id: row.id };
}

const codeKey = (c: string) => sha256(`code:${c.toUpperCase().replace(/[^0-9A-Z]/g, "")}`);

/**
 * Redeem a code in this browser: signs the person in and resumes their
 * session. A guest with no account must type the email Luma has for them
 * (its hash must match the roster) and gets a personal account (no team).
 * A used, expired or unknown code fails closed with PAIR_EXPIRED.
 */
export async function redeemActivationCode(code: string, email: string | null) {
  const out = await transaction(async (tx) => {
    const { rows } = await tx.query<ActivationSession & { expired: boolean }>(
      `select ${SESSION_COLS}, (expires_at <= now()) as expired from activation_sessions where pair_token_hash = $1 for update`,
      [codeKey(code)],
    );
    const s = rows[0];
    if (!s || s.status !== "invited" || s.expired) throw new AppError("PAIR_EXPIRED", { userMessage: "That activation code has expired or was already used." });

    let memberId = s.member_id;
    if (!memberId && s.guest_id) {
      const { rows: g } = await tx.query<{ id: number; name: string; email_hash: string | null; admission_status: string }>(
        "select id, name, email_hash, admission_status from roster_guests where id = $1",
        [s.guest_id],
      );
      const guest = g[0];
      if (!guest) throw new AppError("PAIR_EXPIRED");
      if (!email) return { kind: "needs_email" as const, hint: null };
      const h = emailHash(email);
      if (guest.email_hash && guest.email_hash !== h) {
        throw new AppError("UNAUTHENTICATED", { userMessage: "That email doesn’t match your registration. Use the address you registered with on Luma, or ask at the desk." });
      }
      const { rows: existing } = await tx.query<{ id: number; guest_id: number | null }>("select id, guest_id from members where lower(email) = lower($1) and deleted_at is null", [email]);
      if (existing[0]) {
        if (existing[0].guest_id && existing[0].guest_id !== guest.id) throw new AppError("CONFLICT", { userMessage: "That email is already linked to another registration. Ask at the desk." });
        memberId = existing[0].id;
        await tx.query("update members set guest_id = $2 where id = $1 and guest_id is null", [memberId, guest.id]);
      } else {
        const { rows: created } = await tx.query<{ id: number }>(
          `insert into members (team_id, name, email, email_hash, guest_id, admission_state)
           values (null, $1, $2, $3, $4, $5) returning id`,
          [guest.name, email.trim(), h, guest.id, guest.admission_status === "admitted" ? "admitted" : "needs_reconciliation"],
        );
        memberId = created[0].id;
        await writeAudit({ type: "member", id: memberId, label: guest.name }, { action: "member.create_from_roster", resourceType: "member", resourceId: memberId, payload: { guest_id: guest.id } }, tx);
      }
      await tx.query("update activation_sessions set member_id = $2 where id = $1", [s.id, memberId]);
    }
    if (!memberId) throw new AppError("PAIR_EXPIRED");

    // Already have a session in progress? Resume it and retire this code.
    const { rows: live } = await tx.query<{ id: number }>(
      `select id from activation_sessions where member_id = $1 and id <> $2 and status not in ('expired','invited') and (expires_at > now() or status = 'active')
        order by (status = 'active') desc, created_at desc limit 1`,
      [memberId, s.id],
    );
    if (live[0]) {
      await tx.query("update activation_sessions set status = 'expired', updated_at = now() where id = $1", [s.id]);
      await checkpoint(tx, s.id, "expired", "reached", "system", { reason: "resumed_existing", resumed: live[0].id });
    } else {
      await tx.query("update activation_sessions set expires_at = greatest(expires_at, $2) where id = $1", [s.id, await sessionExpiry()]);
      await advance(tx, s, "paired", "participant", { via: "code" });
    }
    await writeAudit({ type: "member", id: memberId }, { action: "activation.redeem_code", resourceType: "activation_session", resourceId: s.id }, tx);
    return { kind: "ok" as const, memberId };
  });
  if (out.kind === "needs_email") return out;
  // The activation code was issued to this person (desk or email): a personal proof.
  await setMemberSession({ memberId: out.memberId, personal: true });
  return out;
}

// ── Admission (roster match) ─────────────────────────────────────────────────

export type AdmissionCheck =
  | { status: "matched"; guest: { name: string; email_hint: string | null; source: string } | null; confirmed: boolean }
  | { status: "no_roster"; confirmed: boolean }
  | { status: "not_approved"; reason: "no_match" | "not_approved" | "needs_reconciliation"; guest: { name: string; email_hint: string | null; approval_status: string } | null };

type GuestRow = { id: number; name: string; email_hint: string | null; source: string; approval_status: string; admission_status: string; member_id: number | null };

/**
 * Is this person on the approved roster (Luma CSV or a walk-in admitted at the
 * desk)? Shows only a masked email. If the roster hasn't been imported yet we
 * don't block anyone: staff sort it out at the help desk.
 */
export async function checkAdmission(member: MemberRow): Promise<AdmissionCheck> {
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from roster_guests where event_id = current_event_id()");
  const [m] = await query<{ guest_id: number | null; email_hash: string | null; email: string; admission_state: string }>(
    "select guest_id, email_hash, email, admission_state from members where id = $1",
    [member.id],
  );
  const confirmed = m.admission_state === "admitted" && m.guest_id !== null;
  if (n === 0) return { status: "no_roster", confirmed: m.admission_state === "admitted" };
  const [g] = await query<GuestRow>(
    `select id, name, email_hint, source, approval_status, admission_status, member_id from roster_guests
      where event_id = current_event_id() and (id = $1 or email_hash = $2 or member_id = $3)
      order by (id = $1) desc nulls last, (admission_status = 'admitted') desc, id limit 1`,
    [m.guest_id, m.email_hash ?? emailHash(m.email), member.id],
  );
  const approved = (x: GuestRow) => x.admission_status === "admitted" && ["approved", "walk_in"].includes(x.approval_status);
  if (g && approved(g)) return { status: "matched", guest: { name: g.name, email_hint: g.email_hint ?? maskEmail(m.email), source: g.source }, confirmed };
  // Admitted at the desk (walk-in) without a roster row we can see.
  if (member.checked_in_at) return { status: "matched", guest: null, confirmed };
  if (!g) return { status: "not_approved", reason: "no_match", guest: null };
  return {
    status: "not_approved",
    reason: g.admission_status === "needs_reconciliation" ? "needs_reconciliation" : "not_approved",
    guest: { name: g.name, email_hint: g.email_hint, approval_status: g.approval_status },
  };
}

/**
 * Step 2: the person confirms "that's me" (or not). Not on the roster →
 * action_required + NOT_APPROVED, routed to the desk where staff can admit a
 * walk-in; coming back afterwards re-checks and moves on.
 */
export async function confirmAdmission(member: MemberRow, isMe: boolean) {
  const check = await checkAdmission(member);
  const s = await beginActivation(member);
  const actor = memberActor(member);
  if (check.status === "not_approved" || !isMe) {
    await withAudit(actor, "activation.not_approved", "activation_session", async (tx) => {
      const cur = await lockSession(tx, s.id);
      if (cur.status === "paired" || cur.status === "invited") await advance(tx, cur, "action_required", "system", { reason: isMe ? (check as { reason?: string }).reason : "not_me" });
      await tx.query("update members set admission_state = 'needs_reconciliation' where id = $1 and admission_state <> 'admitted'", [member.id]);
      return { result: null, resourceId: s.id };
    });
    throw new AppError("NOT_APPROVED", {
      userMessage: isMe ? ERROR_NOT_APPROVED : "Thanks. If that isn’t you, staff at the help desk will sort out your registration.",
    });
  }
  return withAudit(actor, "activation.admission_confirmed", "activation_session", async (tx) => {
    let cur = await lockSession(tx, s.id);
    if (cur.status === "action_required") cur = await advance(tx, cur, "paired", "participant", { reason: "admitted_on_retry" });
    if (check.status === "matched") {
      const { rows } = await tx.query<{ id: number }>(
        `select id from roster_guests where event_id = current_event_id() and admission_status = 'admitted' and (email_hash = (select email_hash from members where id = $1) or member_id = $1)
          and not exists (select 1 from members x where x.guest_id = roster_guests.id and x.id <> $1) order by id limit 1`,
        [member.id],
      );
      await tx.query("update members set admission_state = 'admitted', guest_id = coalesce(guest_id, $2) where id = $1", [member.id, rows[0]?.id ?? null]);
    }
    await checkpoint(tx, cur.id, "admission", check.status === "matched" ? "confirmed" : "roster_pending", "participant");
    return { result: { status: check.status }, resourceId: cur.id };
  });
}

const ERROR_NOT_APPROVED = "We couldn’t find an approved registration for you. Ask at the help desk; staff can sort out your registration, then come back here.";

// ── Identity and consent ─────────────────────────────────────────────────────

/** Step 3: identity fields. Re-submitting later just updates them. */
export async function saveIdentity(member: MemberRow, patch: Omit<ProfilePatch, "consents">, actor: Actor = memberActor(member)) {
  const s = await beginActivation(member, actor);
  await updateProfile(member, actor, patch, actor.type === "token" ? "mcp" : "web");
  return withAudit(actor, "activation.identity", "activation_session", async (tx) => {
    let cur = await lockSession(tx, s.id);
    if (cur.status === "recoverable_error") cur = await advance(tx, cur, "paired", "system");
    if (cur.status === "paired") cur = await advance(tx, cur, "identity_confirmed", actor.type === "token" ? "kane" : "participant");
    return { result: cur, resourceId: cur.id };
  });
}

/**
 * Step 4: one explicit answer per consent category (default off), appended,
 * never overwritten. Moves to the camera checkpoint.
 */
export async function saveActivationConsents(member: MemberRow, consents: Required<ConsentChanges>, actor: Actor = memberActor(member)) {
  const s = await beginActivation(member, actor);
  let toDelete: string[] = [];
  const out = await withAudit(actor, "activation.consents", "activation_session", async (tx) => {
    let cur = await lockSession(tx, s.id);
    const c = await appendConsents(tx, member.id, consents, actor.type === "token" ? "mcp" : "web");
    toDelete = c.deleteKeys;
    await checkpoint(tx, cur.id, "consents", `recorded:${Object.values(consents).filter(Boolean).length}`, actor.type === "token" ? "kane" : "participant", { consents });
    if (cur.status === "identity_confirmed") cur = await advance(tx, cur, "ready_for_camera", "system");
    return { result: cur, resourceId: cur.id, payload: { changed: c.changed } };
  });
  await deleteBlobs(toDelete);
  return out;
}

// ── Camera checkpoint ────────────────────────────────────────────────────────

/** The participant opened the camera (or the phone handoff): ready_for_camera → selfie_pending. */
export async function markCameraOpened(member: MemberRow, via: "desktop" | "phone") {
  const s = await beginActivation(member);
  return withAudit(memberActor(member), "activation.camera_opened", "activation_session", async (tx) => {
    let cur = await lockSession(tx, s.id);
    if (cur.status === "recoverable_error") cur = await advance(tx, cur, "selfie_pending", "participant", { via });
    else if (cur.status === "ready_for_camera") cur = await advance(tx, cur, "selfie_pending", "participant", { via });
    return { result: cur, resourceId: cur.id };
  });
}

const MAX_SELFIE_BYTES = 3 * 1024 * 1024;
const SELFIE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const SELFIE_PREFIX = "selfie/";

/**
 * The human pressed the shutter and confirmed the preview. `trusted` is the
 * browser's event.isTrusted on that click; anything else is refused. Stores
 * the file in private Blob, replaces any earlier selfie (one current per
 * member), and finishes activation. A retry with the same key returns the
 * same result (never a second selfie).
 */
export async function confirmSelfie(member: MemberRow, file: File, opts: { trusted: boolean; via: "desktop" | "phone"; idempotencyKey?: string | null }) {
  if (!opts.trusted) throw new AppError("FORBIDDEN", { userMessage: "The photo must be taken by pressing the shutter yourself." });
  if (!SELFIE_TYPES.has(file.type) || file.size === 0 || file.size > MAX_SELFIE_BYTES) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "That photo is too large or not an image. Try again." });
  }
  const consents = await getConsents(member.id);
  if (!consents.selfie_storage) throw new AppError("CONSENT_REQUIRED", { userMessage: "You chose not to store a selfie. Turn that on first, or skip the photo." });
  const s = await beginActivation(member);
  if (!["ready_for_camera", "selfie_pending", "recoverable_error", "selfie_skipped", "selfie_confirmed", "active", "browser_verified"].includes(s.status)) {
    throw new AppError("CONFLICT", { userMessage: "Finish the earlier steps first." });
  }

  return (
    await idempotent(opts.idempotencyKey, `activation.selfie:member:${member.id}`, async () => {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const key = `${SELFIE_PREFIX}${member.id}/${randomBytes(8).toString("hex")}.${ext}`;
      try {
        await put(key, file, { access: "private", contentType: file.type, addRandomSuffix: false });
      } catch (e) {
        console.error("[activation] selfie upload failed", e);
        await withAudit(memberActor(member), "activation.selfie_failed", "activation_session", async (tx) => {
          const cur = await lockSession(tx, s.id);
          if (cur.status === "selfie_pending") await advance(tx, cur, "recoverable_error", "system", { reason: "blob_put_failed" });
          return { result: null, resourceId: s.id };
        });
        throw new AppError("DOWNSTREAM_DEGRADED", { userMessage: "Your photo didn’t upload. Nothing was lost: try again, use your phone, or skip the photo." });
      }
      const ev = await getEvent();
      const deletionDue = new Date(ev.endsAt.getTime() + 30 * 86_400_000);
      let old: string[] = [];
      const result = await withAudit(memberActor(member), "activation.selfie_confirmed", "selfie", async (tx) => {
        let cur = await lockSession(tx, s.id);
        const { rows: prev } = await tx.query<{ object_key: string }>("update selfies set deleted_at = now() where member_id = $1 and deleted_at is null returning object_key", [member.id]);
        old = prev.map((r) => r.object_key);
        const { rows } = await tx.query<{ id: number }>(
          "insert into selfies (member_id, object_key, captured_by, approved_at, deletion_due_at) values ($1, $2, 'participant', now(), $3) returning id",
          [member.id, key, deletionDue],
        );
        if (cur.status === "recoverable_error") cur = await advance(tx, cur, "selfie_pending", "system");
        if (cur.status === "ready_for_camera") cur = await advance(tx, cur, "selfie_pending", "participant", { via: opts.via });
        if (cur.status === "selfie_pending" || cur.status === "selfie_skipped") {
          if (cur.status === "selfie_skipped") cur = await advance(tx, cur, "ready_for_camera", "participant", { reason: "retake_after_skip" });
          if (cur.status === "ready_for_camera") cur = await advance(tx, cur, "selfie_pending", "participant", { via: opts.via });
          cur = await advance(tx, cur, "selfie_confirmed", "participant", { via: opts.via, selfie_id: rows[0].id, trusted_click: true });
          cur = await finish(tx, cur);
        }
        return { result: { selfie_id: rows[0].id, status: cur.status, receipt_code: cur.receipt_code }, resourceId: rows[0].id };
      });
      await deleteBlobs(old);
      return result;
    })
  ).result;
}

/** Skip the photo. Never blocks activation; badge/QR covers identity. */
export async function skipSelfie(member: MemberRow, reason: "declined" | "no_camera" | "no_consent" | "later") {
  const s = await beginActivation(member);
  return withAudit(memberActor(member), "activation.selfie_skipped", "activation_session", async (tx) => {
    let cur = await lockSession(tx, s.id);
    if (cur.status === "recoverable_error") cur = await advance(tx, cur, "ready_for_camera", "system");
    if (cur.status === "ready_for_camera" || cur.status === "selfie_pending") {
      cur = await advance(tx, cur, "selfie_skipped", "participant", { reason });
      cur = await finish(tx, cur);
    }
    return { result: cur, resourceId: cur.id };
  });
}

/** → active: receipt code, server time, members.activated_at. Called inside the step's transaction. */
async function finish(tx: PoolClient, s: ActivationSession) {
  const code = s.receipt_code ?? `AC-${randomCode(6)}`;
  await tx.query("update activation_sessions set receipt_code = $2 where id = $1", [s.id, code]);
  const cur = await advance(tx, { ...s, receipt_code: code }, "active", "system", { receipt_code: code });
  await tx.query("update members set activated_at = coalesce(activated_at, now()) where id = $1", [s.member_id]);
  return cur;
}

// ── Phone handoff (T-ACT-04) ─────────────────────────────────────────────────

const HANDOFF_MINUTES = 15;

/** A one-time link for the phone camera. Earlier links stop working. */
export async function issuePhoneHandoff(member: MemberRow) {
  const s = await beginActivation(member);
  if (!["ready_for_camera", "selfie_pending", "recoverable_error", "selfie_skipped"].includes(s.status)) {
    throw new AppError("CONFLICT", { userMessage: "Finish the earlier steps first." });
  }
  const token = newToken("phone_handoff");
  await withAudit(memberActor(member), "activation.phone_handoff", "activation_session", async (tx) => {
    await tx.query("update member_tokens set revoked_at = now() where member_id = $1 and kind = 'phone_handoff' and revoked_at is null", [member.id]);
    await tx.query(
      `insert into member_tokens (member_id, kind, token_hash, label, scopes, expires_at)
       values ($1, 'phone_handoff', $2, 'phone selfie', '{selfie}', now() + make_interval(mins => $3))`,
      [member.id, tokenHash(token), HANDOFF_MINUTES],
    );
    let cur = await lockSession(tx, s.id);
    if (cur.status === "recoverable_error") cur = await advance(tx, cur, "ready_for_camera", "system");
    if (cur.status === "selfie_skipped") cur = await advance(tx, cur, "ready_for_camera", "participant", { reason: "retake_after_skip" });
    if (cur.status === "ready_for_camera") await advance(tx, cur, "selfie_pending", "participant", { via: "phone" });
    return { result: null, resourceId: s.id };
  });
  return { url: siteUrl(`/activate/phone?token=${token}`), expires_minutes: HANDOFF_MINUTES };
}

/** The member behind a phone link (not used, revoked or expired), else null. */
export async function resolvePhoneHandoff(token: string) {
  if (!token.startsWith("khh_")) return null;
  const [row] = await query<{ id: number; member_id: number }>(
    "select id, member_id from member_tokens where token_hash = $1 and kind = 'phone_handoff' and revoked_at is null and used_at is null and expires_at > now()",
    [tokenHash(token)],
  );
  if (!row) return null;
  const member = await getMemberById(row.member_id);
  return member ? { tokenId: row.id, member } : null;
}

/** Selfie from the phone: the token is single use, burned only after the upload succeeds. */
export async function confirmPhoneSelfie(token: string, file: File, opts: { trusted: boolean; idempotencyKey?: string | null }) {
  const h = await resolvePhoneHandoff(token);
  if (!h) throw new AppError("PAIR_EXPIRED", { userMessage: "This phone link has expired or was already used. Make a new one on your computer." });
  const out = await confirmSelfie(h.member, file, { trusted: opts.trusted, via: "phone", idempotencyKey: opts.idempotencyKey });
  await query("update member_tokens set used_at = now() where id = $1", [h.tokenId]);
  return out;
}

// ── Kane controller hooks ────────────────────────────────────────────────────

/** Checkpoints an agent may report. Never selfie_*: only a human click does that. */
export const AGENT_CHECKPOINTS = ["kane_run_a_started", "kane_run_a_stopped", "browser_verified"] as const;
export type AgentCheckpoint = (typeof AGENT_CHECKPOINTS)[number];

/**
 * Kane run A start/stop and run B's verification. browser_verified is only
 * accepted once the session is active (run B checks the finished passport);
 * the status stays `active` and the run id is kept for the passport ribbon,
 * which shows VERIFIED only when that run is source-verified in kane_runs.
 */
export async function recordAgentCheckpoint(member: MemberRow, actor: Actor, cp: AgentCheckpoint, runId: string | null, payload: Record<string, unknown> = {}) {
  const s = await findSession(member.id);
  if (!s) throw new AppError("NOT_FOUND", { userMessage: "No activation in progress. Start one first." });
  return withAudit(actor, `activation.${cp}`, "activation_session", async (tx) => {
    const cur = await lockSession(tx, s.id);
    if (cp === "browser_verified") {
      if (cur.status !== "active") throw new AppError("CONFLICT", { userMessage: "Run B can verify only after the participant has finished activation." });
      if (!runId) throw new AppError("VALIDATION_FAILED", { userMessage: "browser_verified needs the Kane run id." });
      await tx.query("update activation_sessions set kane_run_id = $2, updated_at = now() where id = $1", [cur.id, runId]);
    }
    await checkpoint(tx, cur.id, cp, "reached", "kane", payload, runId);
    return { result: { activation_id: cur.id, status: cur.status, checkpoint: cp }, resourceId: cur.id };
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type CheckpointRow = { checkpoint: string; status: string; actor: string; run_id: string | null; created_at: Date };

export type ActivationState = {
  session: ActivationSession | null;
  step: ActivationStep;
  /** The machine-readable marker Kane stops at (data-checkpoint). */
  marker: "awaiting_selfie" | "active" | "awaiting_participant" | "blocked";
  awaiting_human: boolean;
  checkpoints: CheckpointRow[];
  admission_confirmed: boolean;
  receipt: ActivationReceipt | null;
};

export type ActivationReceipt = {
  code: string;
  server_time: Date;
  checks: { id: string; label: string; ok: boolean; detail?: string }[];
  kane_run_id: string | null;
};

export async function getActivationState(memberId: number): Promise<ActivationState> {
  const session = await findSession(memberId);
  if (!session) return { session: null, step: "admission", marker: "awaiting_participant", awaiting_human: true, checkpoints: [], admission_confirmed: false, receipt: null };
  const checkpoints = await query<CheckpointRow>(
    "select checkpoint, status, actor, run_id, created_at from activation_checkpoints where activation_id = $1 order by id",
    [session.id],
  );
  const [m] = await query<{ admission_state: string }>("select admission_state from members where id = $1", [memberId]);
  const admissionConfirmed = checkpoints.some((c) => c.checkpoint === "admission") || m?.admission_state === "admitted";
  const step = stepFor(session.status, admissionConfirmed);
  const marker = step === "camera" ? "awaiting_selfie" : step === "receipt" ? "active" : step === "blocked" ? "blocked" : "awaiting_participant";
  return { session, step, marker, awaiting_human: step !== "receipt", checkpoints, admission_confirmed: admissionConfirmed, receipt: buildReceipt(session, checkpoints) };
}

function buildReceipt(s: ActivationSession, cps: CheckpointRow[]): ActivationReceipt | null {
  const done = cps.find((c) => c.checkpoint === "active");
  if (s.status !== "active" || !s.receipt_code || !done) return null;
  const has = (name: string) => cps.some((c) => c.checkpoint === name);
  const consent = cps.find((c) => c.checkpoint === "consents");
  const selfie = has("selfie_confirmed") ? "confirmed" : has("selfie_skipped") ? "skipped" : null;
  return {
    code: s.receipt_code,
    server_time: done.created_at,
    kane_run_id: s.kane_run_id,
    checks: [
      { id: "admission", label: "Registration matched", ok: cps.some((c) => c.checkpoint === "admission" && c.status === "confirmed"), detail: cps.some((c) => c.status === "roster_pending") ? "Roster not imported yet: confirmed at the desk" : undefined },
      { id: "identity", label: "Identity confirmed", ok: has("identity_confirmed") },
      { id: "consents", label: "Privacy choices recorded", ok: !!consent },
      { id: "selfie", label: selfie === "skipped" ? "Selfie skipped (badge works without it)" : "Selfie taken by you", ok: selfie !== null },
      { id: "browser_verified", label: "Kane browser check", ok: has("browser_verified"), detail: has("browser_verified") ? undefined : "Optional; not run" },
    ],
  };
}
