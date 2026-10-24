#!/usr/bin/env node
// The hack-os skill's private notes on this machine: whether the person is building,
// and the help issues they filed. The event server stays the source of progress.
//
//   node state.mjs get                  (also says whether the idea was checked here: idea_check)
//   node state.mjs set-build building|ready
//   node state.mjs add-issue https://github.com/LambdaTest/kane-cli/issues/123
//   node state.mjs check-version [--site https://kaneclihack.sh]
//   node state.mjs key-required [--site https://www.kaneclihack.sh]
//
// JSON on stdout; exit 0, or 2 for a usage error. Never store secrets here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_NAME, readNote, writeNote } from "./os-dir.mjs";

const BUNDLE_VERSION = join(dirname(fileURLToPath(import.meta.url)), "..", ".bundle-version");
const ISSUE_URL = /^https:\/\/github\.com\/LambdaTest\/kane-cli\/issues\/\d+$/;
const OFFICIAL = new Set(["kaneclihack.sh", "www.kaneclihack.sh"]);

const out = (v) => process.stdout.write(JSON.stringify(v) + "\n");
const usage = (msg) => {
  process.stderr.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(2);
};

function load() {
  const s = readNote(STATE_NAME);
  if (s && s.version === 1) return { build: null, help_issues: [], updated_at: null, ...s };
  return { version: 1, build: null, help_issues: [], updated_at: null };
}

/** Saved in ~/.kanehack/os, or the temp folder when Codex's sandbox blocks that; never throws. */
function save(s) {
  const next = { ...s, version: 1, updated_at: new Date().toISOString() };
  writeNote(STATE_NAME, next);
  return next;
}

/** Whether this machine has checked the team's idea (scripts/idea-check.mjs), and the routing verdict. */
function ideaCheck() {
  const r = readNote("idea-check.json");
  return r && typeof r.verdict === "string" ? { verdict: r.verdict, checked_at: r.checked_at ?? null } : null;
}

const parts = (v) => v.split(".").map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

function siteFrom(args, fallback) {
  const i = args.indexOf("--site");
  const site = new URL(i >= 0 ? args[i + 1] ?? "" : fallback);
  const local = process.env.KANEHACK_OS_ALLOW_LOCAL === "1" && site.protocol === "http:" && ["127.0.0.1", "localhost"].includes(site.hostname);
  if (!local && !(site.protocol === "https:" && OFFICIAL.has(site.hostname))) usage("--site must be https://kaneclihack.sh");
  return site;
}

async function checkVersion(args) {
  const site = siteFrom(args, "https://kaneclihack.sh");
  let current = "dev";
  try {
    current = readFileSync(BUNDLE_VERSION, "utf8").trim() || "dev";
  } catch {}
  try {
    const res = await fetch(new URL("/install.sh", site), { signal: AbortSignal.timeout(5000) });
    const latest = res.ok ? ((await res.text()).match(/^KANEHACK_VERSION="([0-9.]+)"/m)?.[1] ?? null) : null;
    if (!latest) return out({ current, latest: null, update: null, error: "unreachable" });
    out({ current, latest, update: current === "dev" ? null : newer(latest, current) });
  } catch {
    out({ current, latest: null, update: null, error: "unreachable" });
  }
}

// Whether the site wants the TestMu AI key right now (kanehack doctor flags a missing key either way).
async function keyRequired(args) {
  const site = siteFrom(args, "https://www.kaneclihack.sh");
  try {
    const res = await fetch(new URL("/api/v1/auth/testmu/status", site), { signal: AbortSignal.timeout(5000) });
    const v = res.ok ? (await res.json())?.data?.key_required : undefined;
    out(typeof v === "boolean" ? { key_required: v } : { key_required: null, error: "unreachable" });
  } catch {
    out({ key_required: null, error: "unreachable" });
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "get") out({ ...load(), idea_check: ideaCheck() });
else if (cmd === "set-build") {
  if (!["building", "ready"].includes(args[0])) usage("set-build takes building or ready");
  out(save({ ...load(), build: args[0] }));
} else if (cmd === "add-issue") {
  if (!ISSUE_URL.test(args[0] ?? "")) usage("add-issue takes https://github.com/LambdaTest/kane-cli/issues/<number>");
  const s = load();
  out(s.help_issues.includes(args[0]) ? s : save({ ...s, help_issues: [...s.help_issues, args[0]] }));
} else if (cmd === "check-version") await checkVersion(args);
else if (cmd === "key-required") await keyRequired(args);
else usage("Use: get | set-build building|ready | add-issue <url> | check-version [--site URL] | key-required [--site URL]");
