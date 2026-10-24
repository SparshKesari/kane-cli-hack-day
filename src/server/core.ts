import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, query } from "@/lib/db";

// The shared spine of every Hack OS mutation: the server clock, stable error
// codes, the audit log, idempotency keys, zod input parsing and the response
// envelope that /api/v1, /mcp and the Generative-UI cards all speak.
//
// Service functions live in src/server/<domain>.ts and are called by server
// actions, route handlers and MCP tools alike, so RBAC, deadlines and audit
// sit in one place.

// ── Clock ────────────────────────────────────────────────────────────────────

/** The database's now(). Deadlines are compared against this, never the client or the function host. */
export async function serverNow(): Promise<Date> {
  const [row] = await query<{ now: Date }>("select now() as now");
  return row.now;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export const ERROR_CODES = {
  PAIR_EXPIRED: {
    status: 410,
    userMessage: "That pairing code has expired or was already used.",
    nextAction: "Start pairing again to get a fresh code.",
    manualRoute: "/pair",
  },
  NOT_APPROVED: {
    status: 403,
    userMessage: "We couldn't find an approved registration for you.",
    nextAction: "Go to the check-in desk; staff can admit you as a walk-in.",
    manualRoute: "/ops/checkin",
  },
  CONSENT_REQUIRED: {
    status: 403,
    userMessage: "This needs your consent first.",
    nextAction: "Review your privacy choices in your passport.",
    manualRoute: "/passport",
  },
  TEAM_FULL: {
    status: 409,
    userMessage: "That team is already full.",
    nextAction: "Find another team or start your own.",
    manualRoute: "/match",
  },
  PRIVACY_RESTRICTED: {
    status: 403,
    userMessage: "That information is private.",
    nextAction: "Ask the owner to share it.",
    manualRoute: "/help",
  },
  KANE_RUN_UNVERIFIED: {
    status: 422,
    userMessage: "This Kane run isn't verified yet, so it counts as unverified.",
    nextAction: "Report the run with `kanehack report` from a paired machine.",
    manualRoute: "/help",
  },
  SUBMISSION_LOCKED: {
    status: 423,
    userMessage: "Submissions are locked.",
    nextAction: "If you were blocked by an outage, go to the help desk for a manual receipt.",
    manualRoute: "/help",
  },
  DOWNSTREAM_DEGRADED: {
    status: 503,
    userMessage: "A service we depend on is having trouble. Your data is safe.",
    nextAction: "Try again in a minute, or use the paper fallback at the help desk.",
    manualRoute: "/help",
  },
  RENDER_PENDING: {
    status: 202,
    userMessage: "Still rendering.",
    nextAction: "Check back in a minute; the HTML version works now.",
    manualRoute: "/studio",
  },
  RENDER_FAILED: {
    status: 502,
    userMessage: "The render failed. The HTML version still works.",
    nextAction: "Retry the render or present the HTML deck.",
    manualRoute: "/studio",
  },
  IDEMPOTENT_REPLAY: {
    status: 200,
    userMessage: "Already done; here is the original result.",
    nextAction: "Nothing else to do.",
    manualRoute: "/",
  },
  OUTAGE_MANUAL_RECEIPT_REQUIRED: {
    status: 503,
    userMessage: "We can't finalize online right now.",
    nextAction: "Go to the help desk; staff will write a manual receipt with the real time.",
    manualRoute: "/help",
  },
  // Generic codes every service needs.
  VALIDATION_FAILED: {
    status: 400,
    userMessage: "Some fields need another look.",
    nextAction: "Fix the highlighted fields and try again.",
    manualRoute: "/help",
  },
  UNAUTHENTICATED: {
    status: 401,
    userMessage: "Please sign in first.",
    nextAction: "Sign in and try again.",
    manualRoute: "/login",
  },
  FORBIDDEN: {
    status: 403,
    userMessage: "You don't have access to that.",
    nextAction: "Ask an organizer if you think this is wrong.",
    manualRoute: "/help",
  },
  NOT_FOUND: {
    status: 404,
    userMessage: "We couldn't find that.",
    nextAction: "Check the link or code.",
    manualRoute: "/",
  },
  CONFLICT: {
    status: 409,
    userMessage: "Someone else changed this first.",
    nextAction: "Reload and try again.",
    manualRoute: "/help",
  },
  DEADLINE_PASSED: {
    status: 423,
    userMessage: "That deadline has passed.",
    nextAction: "Ask an organizer for an exception.",
    manualRoute: "/help",
  },
  FEATURE_DISABLED: {
    status: 503,
    userMessage: "This feature is switched off right now.",
    nextAction: "Use the web or paper fallback.",
    manualRoute: "/help",
  },
  TESTMU_KEY_REQUIRED: {
    status: 401,
    userMessage: "Connect your TestMu AI account first: this needs your TestMu AI access key.",
    nextAction: "Sign in to TestMu AI, or send X-TestMu-Username and X-TestMu-Access-Key.",
    manualRoute: "/api/v1/auth/testmu/start",
  },
  TESTMU_UNAVAILABLE: {
    status: 503,
    userMessage: "We couldn't check your TestMu AI access key right now.",
    nextAction: "Try again in a minute, or ask at the help desk.",
    manualRoute: "/help",
  },
  NOT_IMPLEMENTED: {
    status: 501,
    userMessage: "This part of Hack OS isn't built yet.",
    nextAction: "Use the web page or ask at the help desk.",
    manualRoute: "/help",
  },
  RATE_LIMITED: {
    status: 429,
    userMessage: "Too many tries. Slow down a little.",
    nextAction: "Wait a minute and try again.",
    manualRoute: "/help",
  },
  INTERNAL: {
    status: 500,
    userMessage: "Something went wrong on our side.",
    nextAction: "Try again, or ask at the help desk.",
    manualRoute: "/help",
  },
} as const satisfies Record<string, { status: number; userMessage: string; nextAction: string; manualRoute: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * A failure that is safe to show. `message` is for logs; `userMessage`,
 * `nextAction` and `manualRoute` go to people and agents. Never put stack
 * traces, SQL or secrets in any of them.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly nextAction: string;
  readonly manualRoute: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, opts: { message?: string; userMessage?: string; details?: Record<string, unknown> } = {}) {
    const def = ERROR_CODES[code];
    super(opts.message ?? opts.userMessage ?? def.userMessage);
    this.name = "AppError";
    this.code = code;
    this.status = def.status;
    this.userMessage = opts.userMessage ?? def.userMessage;
    this.nextAction = def.nextAction;
    this.manualRoute = def.manualRoute;
    this.details = opts.details;
  }

  toJSON() {
    return { code: this.code, message: this.userMessage, next_action: this.nextAction, manual_route: this.manualRoute, details: this.details ?? null };
  }
}

/** Anything thrown → an AppError (unknown errors become INTERNAL, with the cause logged, not returned). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) {
    return new AppError("VALIDATION_FAILED", { details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
  }
  const pg = err as { code?: string };
  if (pg?.code === "23505") return new AppError("CONFLICT");
  if (pg?.code === "42501") return new AppError("FORBIDDEN", { userMessage: "That record is locked and can't be changed." });
  console.error("[hack-os] unexpected error", err);
  return new AppError("INTERNAL");
}

// ── Actors and audit ─────────────────────────────────────────────────────────

/** Who is doing something. `id` is members.id, staff_accounts.id or member_tokens.id by type. */
export type Actor =
  | { type: "member"; id: number; label?: string; teamId?: number | null }
  | { type: "staff"; id: number | null; label?: string; role: StaffRole }
  | { type: "token"; id: number; memberId: number; label?: string; teamId?: number | null }
  | { type: "system" | "pipeline" | "anonymous"; id?: null; label?: string };

export type StaffRole = "mentor" | "photographer" | "judge" | "organizer" | "admin";

export type AuditInput = {
  action: string;
  resourceType: string;
  resourceId: string | number;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  payload?: Record<string, unknown>;
  requestId?: string;
};

type Queryable = Pick<PoolClient, "query">;

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hashOf = (v: unknown) => (v === undefined ? null : sha256(stableStringify(v)));

/** JSON with sorted keys, so the same object always hashes the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** Append one audit row. Pass `db` to write inside the caller's transaction. */
export async function writeAudit(actor: Actor, input: AuditInput, db: Queryable = pool) {
  await db.query(
    `insert into audit_events (actor_type, actor_id, actor_label, action, resource_type, resource_id, before_hash, after_hash, reason, request_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      actor.type,
      actor.id ?? null,
      actor.label ?? null,
      input.action,
      input.resourceType,
      String(input.resourceId),
      hashOf(input.before),
      hashOf(input.after),
      input.reason ?? null,
      input.requestId ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

/**
 * Run `fn` inside a transaction and append an audit event in the same
 * transaction, so a change and its audit row commit or fail together.
 * `fn` returns the result plus (optionally) the resource id / after-state if
 * they're only known once it has run.
 *
 *   const ticket = await withAudit(actor, "help.create", "help_ticket", async (tx) => {
 *     const { rows } = await tx.query("insert … returning *", […]);
 *     return { result: rows[0], resourceId: rows[0].id, after: rows[0] };
 *   });
 */
export async function withAudit<T>(
  actor: Actor,
  action: string,
  resourceType: string,
  fn: (tx: PoolClient) => Promise<{ result: T; resourceId: string | number; before?: unknown; after?: unknown; reason?: string | null; payload?: Record<string, unknown> }>,
  opts: { requestId?: string } = {},
): Promise<T> {
  return transaction(async (tx) => {
    const out = await fn(tx);
    await writeAudit(
      actor,
      { action, resourceType, resourceId: out.resourceId, before: out.before, after: out.after, reason: out.reason, payload: out.payload, requestId: opts.requestId },
      tx,
    );
    return out.result;
  });
}

/** begin / commit / rollback around `fn`. */
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Run `fn` at most once per (scope, key). A retry with the same key returns
 * the stored result instead of running again (double-click on Finalize gets
 * the same receipt). `scope` should include who is asking, e.g.
 * `submission.finalize:team:42`, so keys can't collide across teams.
 *
 * While the first call is still running, a concurrent retry gets CONFLICT.
 * If `fn` throws, the key is released so the caller can retry.
 * The result must be JSON-serialisable.
 */
export async function idempotent<T>(key: string | null | undefined, scope: string, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await fn(), replayed: false };
  if (key.length > 200) throw new AppError("VALIDATION_FAILED", { userMessage: "Idempotency key is too long." });

  const claimed = await query<{ key: string }>(
    `insert into idempotency_keys (scope, key) values ($1, $2)
     on conflict (scope, key) do nothing returning key`,
    [scope, key],
  );
  if (claimed.length === 0) {
    const [row] = await query<{ status: string; response: T }>("select status, response from idempotency_keys where scope = $1 and key = $2", [scope, key]);
    if (row?.status === "done") return { result: row.response, replayed: true };
    // A claim left 'pending' by a crash or timeout between fn() and the 'done'
    // update would block every retry forever. After 60s, take it over and run
    // fn again; callers that use this (finalize, help create) are naturally
    // idempotent inside fn, so a re-run returns the original result.
    const stale = await query<{ key: string }>(
      `update idempotency_keys set created_at = now()
        where scope = $1 and key = $2 and status = 'pending' and created_at < now() - interval '60 seconds'
        returning key`,
      [scope, key],
    );
    if (!stale.length) throw new AppError("CONFLICT", { userMessage: "That request is still being processed. Try again in a moment." });
  }
  try {
    const result = await fn();
    await query("update idempotency_keys set status = 'done', response = $3 where scope = $1 and key = $2", [scope, key, JSON.stringify(result ?? null)]);
    return { result, replayed: false };
  } catch (err) {
    await query("delete from idempotency_keys where scope = $1 and key = $2 and status = 'pending'", [scope, key]).catch(() => {});
    throw err;
  }
}

// ── Input validation ─────────────────────────────────────────────────────────

export { z };

/** Parse or throw VALIDATION_FAILED (with per-field issues in details). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw toAppError(r.error);
  return r.data;
}

/** FormData → plain object (repeated keys become arrays), for parse(schema, formObject(form)). */
export function formObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== "string") continue;
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/** Common field schemas. */
export const zx = {
  id: z.coerce.number().int().positive(),
  /** Trimmed text, required, with a max length. */
  text: (max: number) => z.string().trim().min(1).max(max),
  optText: (max: number) =>
    z
      .string()
      .trim()
      .max(max)
      .optional()
      .transform((s) => (s ? s : null)),
  /** https URL only (participant links are never http/javascript/data). */
  httpsUrl: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((s) => s.startsWith("https://"), "Must be an https:// link"),
  /** Full 40-hex git commit SHA. */
  commitSha: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{40}$/, "Must be the full 40-character commit SHA"),
  slug: z.string().trim().regex(/^[a-z0-9-]{1,64}$/),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  /** Checkbox: "on" / "true" / true → true. */
  checkbox: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  email: z.string().trim().toLowerCase().email().max(200),
};

/** sha256(lower(trim(email))): what roster_guests.email_hash and members.email_hash store. */
export const emailHash = (email: string) => sha256(email.trim().toLowerCase());

/** "ann@example.com" → "an***@ex***.com" for staff confirmation screens. */
export function maskEmail(email: string) {
  const [user, domain = ""] = email.trim().toLowerCase().split("@");
  const [host, ...tld] = domain.split(".");
  return `${user.slice(0, 2)}***@${(host ?? "").slice(0, 2)}***${tld.length ? "." + tld.join(".") : ""}`;
}

// ── Envelope (API / MCP / Generative UI) ─────────────────────────────────────

export const DESIGN_VERSION = "kane-hack-os@1";

export type EnvelopeStatus = "ok" | "needs_action" | "partial" | "error";

export type Evidence = { kind: string; id: string; confidence: "verified" | "participant_reported" | "inferred" | "unverified"; url?: string };
export type EnvelopeAction = { id: string; label: string; requires_human_confirmation: boolean; href?: string; tool?: string };
export type EnvelopeLink = { label: string; url: string };
export type Freshness = { as_of: string; state: "fresh" | "delayed" | "stale" | "offline"; source?: string };

export type Envelope<T = unknown> = {
  schema_version: 1;
  status: EnvelopeStatus;
  message: string;
  data: T | null;
  evidence: Evidence[];
  actions: EnvelopeAction[];
  links: EnvelopeLink[];
  ui_resource: string | null;
  ui_type: string | null;
  design_version: typeof DESIGN_VERSION;
  fallback: { text: string };
  freshness: Freshness | null;
  warnings: string[];
  error: ReturnType<AppError["toJSON"]> | null;
  request_id: string;
  server_time: string;
};

const ALLOWED_LINK_HOSTS = new Set(["kaneclihack.sh", "www.kaneclihack.sh", "github.com", "devpost.com", "www.testmuai.com", "testmuai.com", "lu.ma", "luma.com"]);

/** Absolute site URL for links in envelopes, from SITE_URL (default https://kaneclihack.sh). */
export function siteUrl(path = "/") {
  const base = (process.env.SITE_URL ?? "https://kaneclihack.sh").replace(/\/$/, "");
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Only https links on the allowlist (plus our own SITE_URL host) survive. */
function safeLinks(links: EnvelopeLink[]) {
  const own = new URL(siteUrl()).host;
  return links
    .map((l) => ({ ...l, url: siteUrl(l.url) }))
    .filter((l) => {
      try {
        const u = new URL(l.url);
        return u.protocol === "https:" && (u.host === own || ALLOWED_LINK_HOSTS.has(u.host));
      } catch {
        return false;
      }
    });
}

/**
 * Build the standard envelope. `fallbackText` must make the workflow operable
 * as plain text (headless agents never see the UI). Pass an AppError as
 * `error` to build an error envelope.
 */
export function toEnvelope<T>(input: {
  status?: EnvelopeStatus;
  message: string;
  data?: T | null;
  evidence?: Evidence[];
  actions?: EnvelopeAction[];
  links?: EnvelopeLink[];
  uiType?: string | null;
  uiResource?: string | null;
  fallbackText?: string;
  freshness?: Freshness | null;
  warnings?: string[];
  error?: AppError | null;
  requestId?: string;
  serverTime?: Date;
}): Envelope<T> {
  const err = input.error ?? null;
  const status = input.status ?? (err ? "error" : "ok");
  const actions = input.actions ?? (err ? [{ id: "manual_route", label: err.nextAction, requires_human_confirmation: false, href: siteUrl(err.manualRoute) }] : []);
  return {
    schema_version: 1,
    status,
    message: err ? err.userMessage : input.message,
    data: input.data ?? null,
    evidence: input.evidence ?? [],
    actions,
    links: safeLinks(input.links ?? []),
    ui_resource: input.uiResource ?? null,
    ui_type: input.uiType ?? null,
    design_version: DESIGN_VERSION,
    fallback: { text: input.fallbackText ?? (err ? `${err.userMessage} ${err.nextAction}` : input.message) },
    freshness: input.freshness ?? null,
    warnings: input.warnings ?? [],
    error: err ? err.toJSON() : null,
    request_id: input.requestId ?? randomUUID(),
    server_time: (input.serverTime ?? new Date()).toISOString(),
  };
}

/** Route-handler helper: run `fn`, wrap the result (or the error) in an envelope Response. */
export async function envelopeResponse<T>(fn: () => Promise<Parameters<typeof toEnvelope<T>>[0]>): Promise<Response> {
  const requestId = randomUUID();
  try {
    const env = toEnvelope<T>({ requestId, serverTime: await serverNow().catch(() => new Date()), ...(await fn()) });
    return Response.json(env, { status: env.status === "error" ? 400 : 200, headers: { "x-request-id": requestId } });
  } catch (e) {
    unstable_rethrow(e);
    const err = toAppError(e);
    return Response.json(toEnvelope({ message: err.userMessage, error: err, requestId }), { status: err.status, headers: { "x-request-id": requestId } });
  }
}

/** Server-action helper: `{ ok: true, data }` or `{ ok: false, error }` with user-safe text. */
export type ActionResult<T> = { ok: true; data: T; receipt?: Receipt } | { ok: false; error: ReturnType<AppError["toJSON"]> };

/** What every mutation hands back: an id people can quote and the server time it happened. */
export type Receipt = { id: string; server_time: string };

export async function runAction<T>(fn: () => Promise<T | { data: T; receipt: Receipt }>): Promise<ActionResult<T>> {
  try {
    const out = await fn();
    if (out && typeof out === "object" && "receipt" in out && "data" in out) return { ok: true, data: out.data, receipt: out.receipt };
    return { ok: true, data: out as T };
  } catch (e) {
    unstable_rethrow(e); // let redirect() / notFound() through
    return { ok: false, error: toAppError(e).toJSON() };
  }
}

export const newRequestId = () => randomUUID();
