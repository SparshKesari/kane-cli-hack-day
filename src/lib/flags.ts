import "server-only";
import { query } from "./db";

// Feature flags / kill switches (DEPLOYMENT §8), stored in `settings` as
// key 'flag:<name>' = 'true' | 'false'. Missing keys use DEFAULTS. Reads are
// cached for 15s per function instance so a hot path doesn't query each time;
// setFlag clears the cache on the instance that wrote it.
//
// Tier-0 paths (check-in, help, submission) must never be behind a flag.

export const FLAGS = {
  activation: "Activation ceremony and /activate",
  match: "Matchmaker (/match)",
  idea: "Idea lab and validator",
  kane_ingest: "Kane run ingest (/api/v1/kane, MCP kane_record_run)",
  live_sse: "Live SSE stream (falls back to polling)",
  ship_pages: "Public showcase pages (/ship)",
  deck: "Deck studio and renders",
  photo_studio: "Photographer studio (/photo) and media queue",
  social_publish: "Publishing approved posts to X",
  video: "60s video automation",
  mcp: "Event MCP server (/mcp)",
  public_evidence: "Public evidence uploads (/api/v1/evidence/public, MCP public_evidence_*)",
} as const;

export type Flag = keyof typeof FLAGS;

const DEFAULTS: Record<Flag, boolean> = {
  activation: true,
  match: true,
  idea: true,
  kane_ingest: true,
  live_sse: true,
  ship_pages: true,
  deck: true,
  photo_studio: true,
  social_publish: false,
  video: false,
  mcp: true,
  public_evidence: true,
};

const TTL = 15_000;
let cache: { at: number; values: Record<Flag, boolean> } | null = null;

export const isFlag = (s: string): s is Flag => s in FLAGS;

/** Every flag's current value. If the DB is unreachable, the defaults. */
export async function getFlags(): Promise<Record<Flag, boolean>> {
  // performance.now(), not Date.now(): a monotonic TTL clock that Cache
  // Components allows during prerender (Date.now() there is a build error).
  if (cache && performance.now() - cache.at < TTL) return cache.values;
  const values = { ...DEFAULTS };
  try {
    const rows = await query<{ key: string; value: string }>("select key, value from settings where key like 'flag:%'");
    for (const r of rows) {
      const name = r.key.slice(5);
      if (isFlag(name)) values[name] = r.value === "true";
    }
    cache = { at: performance.now(), values };
  } catch (err) {
    console.error("[flags] using defaults", err);
  }
  return values;
}

export async function isEnabled(flag: Flag) {
  return (await getFlags())[flag];
}

/** Throws FEATURE_DISABLED when off. Import lazily to keep this file free of server/core. */
export async function requireFlag(flag: Flag) {
  if (await isEnabled(flag)) return;
  const { AppError } = await import("@/server/core");
  throw new AppError("FEATURE_DISABLED", { details: { flag } });
}

/** Organizer-only: callers must check role and write an audit event (see src/server/ops.ts). */
export async function setFlag(flag: Flag, on: boolean) {
  await query(
    "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
    [`flag:${flag}`, String(on)],
  );
  cache = null;
}
