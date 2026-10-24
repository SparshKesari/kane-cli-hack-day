import type { ReactNode } from "react";
import FreshnessStamp from "@/components/ui/FreshnessStamp";
import StatusPill, { type PillTone } from "@/components/ui/StatusPill";
import type { Envelope } from "@/server/core";
import KaneRunCard, { runPill, type KaneRunView } from "./KaneRunCard";

// Generative-UI registry (T-GUI-01/02). A deterministic map from an
// envelope's `ui_type` to one first-party component in the site's theme.
// Models never write markup: they only pick tools, and tools return typed
// data. Unknown or malformed types render `fallback.text` and nothing else.
//
// Every card is readable as text, lists its actions as real links or as
// "ask your agent to run <tool>", marks confirm-required actions, and wraps
// async status in aria-live. A card is never proof by itself: success words
// appear only when the envelope carries a server receipt or verified evidence.

export const UI_TYPES = [
  "builder_passport",
  "readiness_check",
  "idea_checklist",
  "idea_radar",
  "team_match",
  "mentor_ticket",
  "kane_run",
  "metric_pulse",
  "submission_receipt",
  "deck_preview",
  "ship_preview",
  "social_review",
] as const;
export type UiType = (typeof UI_TYPES)[number];

type Env = Pick<Envelope, "status" | "message" | "data" | "evidence" | "actions" | "links" | "ui_type" | "fallback" | "freshness" | "warnings" | "error" | "server_time">;
type Data = Record<string, unknown>;

// ── tiny safe readers (data is untyped JSON) ─────────────────────────────────
const obj = (v: unknown): Data => (v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const STATUS: Record<Env["status"], { tone: PillTone | null; word: string }> = {
  ok: { tone: null, word: "Done" },
  partial: { tone: "pending", word: "In progress" },
  needs_action: { tone: "pending", word: "Needs you" },
  error: { tone: "danger", word: "Failed" },
};

function Frame({ env, title, children }: { env: Env; title: string; children?: ReactNode }) {
  const s = STATUS[env.status];
  return (
    <section aria-label={title} className="border border-hairline bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{title}</p>
          <p aria-live="polite" className="mt-1 font-plex text-sm break-words text-bright">
            {env.message}
          </p>
        </div>
        {s.tone ? <StatusPill tone={s.tone}>{s.word}</StatusPill> : <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{s.word}</span>}
      </header>
      {children && <div className="mt-4">{children}</div>}
      {env.evidence.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Evidence">
          {env.evidence.map((e) => (
            <li key={`${e.kind}:${e.id}`}>
              <StatusPill tone={e.confidence === "verified" ? "verified" : e.confidence === "inferred" ? "suspected" : "unverified"}>
                {e.confidence === "verified" ? `Verified ${e.id}` : `${e.id} · ${e.confidence.replace("_", " ")}`}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
      {env.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 border-l-2 border-warning pl-3 font-plex text-xs text-warning">
          {env.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <Actions env={env} />
      {env.freshness && (
        <div className="mt-3">
          <FreshnessStamp asOf={env.freshness.as_of} state={env.freshness.state} source={env.freshness.source} />
        </div>
      )}
    </section>
  );
}

function Actions({ env }: { env: Env }) {
  if (!env.actions.length && !env.links.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-dashed border-hairline pt-3 font-plex text-xs">
      {env.actions.map((a) =>
        a.href ? (
          <a key={a.id} href={a.href} className="inline-flex min-h-11 items-center gap-2 bg-bright px-3 text-ink transition-colors hover:bg-lime">
            {a.label} →{a.requires_human_confirmation && <span className="font-pixel text-[9px] uppercase tracking-[0.2em]">· you confirm</span>}
          </a>
        ) : (
          <span key={a.id} className="inline-flex min-h-11 items-center border border-dashed border-hairline px-3 text-lightgray">
            {a.label}
            {a.tool ? ` · ask your agent to run ${a.tool}` : ""}
            {a.requires_human_confirmation ? " · needs your confirmation" : ""}
          </span>
        ),
      )}
      {env.links.map((l) => (
        <a key={l.url} href={l.url} className="inline-flex min-h-11 items-center text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
          {l.label}
        </a>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 font-plex text-xs sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-lightgray">{k}</dt>
          <dd className="break-words text-bright">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Checklist({ items }: { items: { label: string; state: "ok" | "warn" | "fail"; note?: string | null }[] }) {
  const glyph = { ok: "✓", warn: "!", fail: "✗" } as const;
  const cls = { ok: "text-bright", warn: "text-warning", fail: "text-danger" } as const;
  return (
    <ul className="space-y-1.5 font-plex text-xs">
      {items.map((i) => (
        <li key={i.label} className="flex gap-2">
          <span aria-hidden="true" className={cls[i.state]}>
            {glyph[i.state]}
          </span>
          <span className="min-w-0">
            <span className="text-bright">{i.label}</span>
            <span className="sr-only"> ({i.state === "ok" ? "met" : i.state === "warn" ? "partly" : "missing"})</span>
            {i.note && <span className="text-lightgray"> · {i.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── one renderer per ui_type ─────────────────────────────────────────────────

const RENDER: Record<UiType, { title: string; body: (d: Data, env: Env) => ReactNode }> = {
  builder_passport: {
    title: "Builder passport",
    body: (d) => {
      const m = obj(d.member);
      const t = obj(d.team);
      const a = obj(d.activation);
      return (
        <Rows
          rows={[
            ["Name", str(m.name)],
            ["Code", str(m.public_code)],
            ["Team", str(t.name) ?? (d.team === null ? "No team yet" : null)],
            ["Activation", str(a.status) ?? str(d.status)],
            ["Next", str(obj(d.next_action).label) ?? str(d.instruction)],
          ]}
        />
      );
    },
  },
  readiness_check: {
    title: "Readiness",
    body: (d) => {
      const checks = arr(d.checks).map(obj);
      const failing = arr(d.failing).map(String);
      return checks.length ? (
        <Checklist items={checks.map((c) => ({ label: str(c.id) ?? "?", state: c.status === "pass" ? "ok" : c.status === "fail" ? "fail" : "warn", note: str(c.version) ?? str(c.detail) }))} />
      ) : (
        <Rows rows={[["Failing", failing.length ? failing.join(", ") : "None"]]} />
      );
    },
  },
  idea_checklist: {
    title: "Idea check · advisory",
    body: (d) => (
      <div className="space-y-4">
        <Checklist items={arr(d.criteria).map(obj).map((c) => ({ label: str(c.id)?.replace(/_/g, " ") ?? "?", state: c.met === "yes" ? "ok" : c.met === "partly" ? "warn" : "fail", note: str(c.note) }))} />
        {arr(d.changes).length > 0 && (
          <ol className="list-inside list-decimal space-y-1 font-plex text-xs text-bright">
            {arr(d.changes).map((c, i) => (
              <li key={i}>{String(c)}</li>
            ))}
          </ol>
        )}
        <p className="font-plex text-[11px] text-lightgray">{d.generator === "llm" ? "Advisory draft (AI)" : "Rule-based draft"}. Never an official score.</p>
      </div>
    ),
  },
  idea_radar: {
    title: "Idea radar",
    body: (d) =>
      d.opted_in === false ? (
        <p className="font-plex text-xs text-lightgray">Your team hasn’t opted in. Only opted-in public summaries are ever compared.</p>
      ) : (
        <ul className="space-y-2 font-plex text-xs">
          {arr(d.overlaps)
            .map(obj)
            .map((o, i) => (
              <li key={i}>
                <StatusPill tone="unverified">{str(o.label)?.replace(/_/g, " ") ?? "similar"}</StatusPill> <span className="text-bright">{str(o.team)}</span>
                <span className="text-lightgray"> · {str(o.explanation) ?? str(o.public_summary)}</span>
              </li>
            ))}
        </ul>
      ),
  },
  team_match: {
    title: "Team match",
    body: (d) => {
      const teams = arr(d.teams).map(obj);
      if (!teams.length) return <Rows rows={[["Team", str(d.slug) ?? str(d.id)]]} />;
      return (
        <ul className="space-y-2 font-plex text-xs">
          {teams.slice(0, 8).map((t) => (
            <li key={str(t.slug) ?? ""} className="flex flex-wrap justify-between gap-2 border-b border-hairline pb-2">
              <span className="text-bright">{str(t.name)}</span>
              <span className="text-lightgray">{num(t.seats_left) ?? "—"} seat(s) left</span>
            </li>
          ))}
        </ul>
      );
    },
  },
  mentor_ticket: {
    title: "Mentor help",
    body: (d) => (
      <Rows
        rows={[
          ["Ticket", str(d.code) ?? str(d.id)],
          ["Status", str(d.status)],
          ["Mentor", str(d.mentor)],
          ["Last reply", str(obj(d.last_reply).body)],
          ["Steps", str(d.steps)],
        ]}
      />
    ),
  },
  kane_run: {
    title: "Kane run",
    body: (d, env) => {
      // A full run (GET /kane/runs/{id}) gets the real card; a receipt gets the summary.
      if (num(d.id) !== null && typeof d.status === "string" && Array.isArray(d.members)) {
        return <KaneRunCard run={{ ...(d as unknown as KaneRunView), trust_reasons: arr(d.trust_reasons).map(String), summary: obj(d.summary) }} now={env.server_time} compact />;
      }
      const status = str(d.status) as KaneRunView["status"] | null;
      const pill = status ? runPill({ status, source_verified: d.source_verified === true, verification_state: (str(d.verification_state) ?? "reported") as KaneRunView["verification_state"] }) : null;
      return (
        <div className="space-y-3">
          {pill && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
          <Rows
            rows={[
              ["Run", str(d.id)],
              ["Completion event", d.has_terminal_event === undefined ? null : d.has_terminal_event ? "Received" : "Missing"],
              ["Suspected defects", num(d.defects_opened)],
              ["Fixes re-verified", num(d.defects_reverified)],
              ["Confidence", str(d.confidence)?.replace("_", " ")],
            ]}
          />
        </div>
      );
    },
  },
  metric_pulse: {
    title: "Event pulse",
    body: (d) => {
      const dl = obj(d.deadlines);
      return (
        <Rows
          rows={[
            ["Phase", str(d.phase)?.toUpperCase()],
            ["Server time", str(d.server_time)],
            ["Submissions lock", str(dl.submission_lock)],
            ["Value", num(d.value) ?? null],
            ["Definition", str(d.definition)],
          ]}
        />
      );
    },
  },
  submission_receipt: {
    title: "Submission",
    body: (d) => {
      const reqs = arr(d.requirements).map(obj);
      return (
        <div className="space-y-3">
          {str(d.receipt_code) && (
            <p className="font-dots text-3xl text-bright">
              {str(d.receipt_code)} <span className="font-plex text-xs text-lightgray">at {str(d.server_time)}</span>
            </p>
          )}
          {reqs.length > 0 && <Checklist items={reqs.map((r) => ({ label: str(r.label) ?? "?", state: r.state === "uncertain" ? "warn" : r.ok ? "ok" : "fail", note: str(r.detail) }))} />}
          <Rows rows={[["Locks at", str(d.locks_at)], ["Server time", str(d.server_time)]]} />
        </div>
      );
    },
  },
  deck_preview: {
    title: "Deck",
    body: (d) => (
      <Rows
        rows={[
          ["Version", num(obj(d.deck).version) ?? num(d.version)],
          ["Status", str(obj(d.deck).status) ?? str(d.status)],
          ["Renders", arr(d.renders).length ? arr(d.renders).map(obj).map((r) => `${str(r.kind)} ${str(r.status)}`).join(", ") : (obj(d.job).kind ? `${str(obj(d.job).kind)} ${str(obj(d.job).status)}` : null)],
        ]}
      />
    ),
  },
  ship_preview: {
    title: "Ship page",
    body: (d) => (
      <div className="space-y-3">
        <Rows rows={[["State", str(d.showcase_state) ?? str(d.id)], ["Story version", num(d.story_version)]]} />
        {arr(d.missing_proof).length > 0 && (
          <ul className="space-y-1 font-plex text-xs">
            {arr(d.missing_proof)
              .map(obj)
              .map((c, i) => (
                <li key={`${i}-${str(c.claim) ?? ""}`}>
                  <StatusPill tone="unverified">Unverified</StatusPill> <span className="text-bright">{str(c.claim)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    ),
  },
  social_review: {
    title: "Social draft · not posted",
    body: (d) => (
      <div className="space-y-2">
        {str(d.text) && <blockquote className="border-l-2 border-hairline pl-3 font-plex text-sm text-bright">{str(d.text)}</blockquote>}
        <Rows rows={[["Draft", str(d.id)], ["Status", str(d.status)], ["Written by", d.generator === "llm" ? "AI draft" : str(d.generator)]]} />
      </div>
    ),
  },
};

export const isUiType = (s: unknown): s is UiType => typeof s === "string" && (UI_TYPES as readonly string[]).includes(s);

/** Render any envelope. Unknown `ui_type` → the fallback text only. */
export default function GenUI({ envelope }: { envelope: Env }) {
  if (!isUiType(envelope.ui_type)) {
    return (
      <p aria-live="polite" className="border border-dashed border-hairline p-4 font-plex text-sm whitespace-pre-wrap text-bright">
        {envelope.fallback?.text || envelope.message}
      </p>
    );
  }
  const r = RENDER[envelope.ui_type];
  let body: ReactNode = null;
  try {
    body = r.body(obj(envelope.data), envelope);
  } catch {
    body = <p className="font-plex text-xs whitespace-pre-wrap text-lightgray">{envelope.fallback?.text}</p>;
  }
  return (
    <Frame env={envelope} title={r.title}>
      {envelope.error ? <p className="font-plex text-xs text-danger">{envelope.error.next_action}</p> : body}
    </Frame>
  );
}
