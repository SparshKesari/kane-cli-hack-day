#!/usr/bin/env node
// kanehack: the Kane CLI Hack Day helper. No dependencies, Node >= 18.17.
//
//   kanehack pair [--token khk_…]          pair this machine with your account (token in ~/.kanehack/config.json, mode 600)
//   kanehack pair --start | --wait         the same, in two steps, for agents and scripts (no terminal needed)
//   kanehack doctor [--json] [--report]    check Node, Git, Chrome, Kane CLI, auth, skills, API; optionally send the result
//   kanehack report [opts] -- <kane-cli …> run a Kane command, keep its exit code + NDJSON, send a redacted summary
//   kanehack status                        your team's latest runs
//   kanehack help "<what's wrong>"         open a mentor ticket   (kanehack help --status H-0042)
//   kanehack submit --preflight            what's missing before you can submit
//   kanehack consent yes|no                allow / stop sending run summaries
//   kanehack hook status|enable|disable    the optional lifecycle hook (off; see plugin/hooks/README.md)
//   kanehack connect codex|claude          add the event MCP server to Codex / Claude Code (no token stored)
//   kanehack mcp-headers                   print {"Authorization":"Bearer …"} for the agent's headers helper
//
// Every command takes --json (one JSON document on stdout) and works without a
// terminal. Exit codes: see usage() and README.md.
//
// The server decides what a run proves. This tool never marks anything as
// passed: it forwards the real exit code and the real stream.

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync, rmSync, copyFileSync, renameSync, realpathSync } from "node:fs";
import { homedir, platform, arch, hostname } from "node:os";
import { basename, delimiter, extname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { redactText, typedOnly } from "../lib/redact.mjs";
import { scan } from "../lib/stream.mjs";

const VERSION = "0.1.3";
const DIR = join(homedir(), ".kanehack");
const CONFIG = join(DIR, "config.json");
const PENDING = join(DIR, "pending-pair.json");
const MAX_NDJSON = 1_900_000;
const MAX_DIRECT_EVIDENCE = 4 * 1024 * 1024;
const WIN = platform() === "win32";

// Exit codes (documented in README.md).
const EXIT = { OK: 0, FAIL: 1, ACTION: 2, UNREACHABLE: 3, PENDING: 4 };

// ── config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  let c = {};
  try {
    c = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {}
  return {
    api: (process.env.KANEHACK_API || c.api || "https://kaneclihack.sh").replace(/\/$/, ""),
    token: process.env.KANEHACK_TOKEN || c.token || null,
    consent: c.consent ?? null,
    raw: c,
  };
}

function writePrivate(file, obj) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {}
}

function saveConfig(patch) {
  writePrivate(CONFIG, { ...loadConfig().raw, ...patch });
}

// ── output ───────────────────────────────────────────────────────────────────

let JSON_MODE = false;
const color = process.stderr.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => c("32", s);
const warn = (s) => c("33", s);
const bad = (s) => c("31", s);
const dim = (s) => c("2", s);
// Human output goes to stderr so stdout can stay the Kane NDJSON stream (or the --json document).
const say = (...a) => console.error(...a);
const interactive = () => Boolean(process.stdin.isTTY && process.stderr.isTTY) && !process.env.CI;

/** Leave with an exit code, letting stdout drain first (process.exit can cut a piped stdout short). */
class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}
const exit = (code) => {
  throw new Exit(code);
};

function emit(obj) {
  if (JSON_MODE) process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function fail(msg, code = EXIT.FAIL, errCode = "ERROR", extra = {}) {
  say(bad(`kanehack: ${msg}`));
  emit({ ok: false, exit_code: code, error: { code: errCode, message: msg }, ...extra });
  exit(code);
}

// Flags that never take a value, so `--json yes` keeps "yes" as an argument.
const BOOLEAN_FLAGS = new Set(["json", "start", "wait", "report", "preflight", "no-upload", "help", "version", "check"]);

function args(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      out.rest = argv.slice(i + 1);
      break;
    }
    if (a === "-h") out.flags.help = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) out.flags[k] = a.slice(eq + 1);
      else if (!BOOLEAN_FLAGS.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("-")) out.flags[k] = argv[++i];
      else out.flags[k] = true;
    } else out._.push(a);
  }
  return out;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const LOOPBACK = (h) => h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]";
const site = (h) => h.replace(/^www\./, "");

async function api(cfg, path, init = {}) {
  const headers = { "user-agent": `kanehack/${VERSION} (${platform()} ${arch()})`, ...(init.headers || {}) };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  let res;
  let url = `${cfg.api}${path}`;
  try {
    // Follow redirects ourselves: fetch drops Authorization when one changes host, and
    // kaneclihack.sh ⇄ www.kaneclihack.sh is a host change. Only within the same site,
    // and only to https (plain http is allowed for loopback hosts, for local testing).
    for (let hops = 0; ; hops++) {
      res = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(init.timeout ?? 30_000) });
      const next = res.status >= 300 && res.status < 400 && res.headers.get("location");
      if (!next) break;
      const to = new URL(next, url);
      const offSite = (to.protocol !== "https:" && !LOOPBACK(to.hostname)) || site(to.hostname) !== site(new URL(url).hostname);
      if (offSite || hops >= 3) return { ok: false, status: res.status, env: null, redirect: to.toString(), error: `${cfg.api} redirected to ${to.origin}, a different site.` };
      url = to.toString();
    }
  } catch (e) {
    return { ok: false, status: 0, env: null, error: `Can't reach ${cfg.api} (${e.cause?.code ?? e.name}).` };
  }
  const env = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, env, error: env ? null : `${cfg.api} answered HTTP ${res.status} without a kanehack envelope.` };
}

/** Turn transport-level problems into the documented exit codes. Returns r when there's an envelope to read. */
function ensure(r, what = "That request") {
  if (r.status === 0) fail(`${r.error} Check your network, or the server address (KANEHACK_API).`, EXIT.UNREACHABLE, "UNREACHABLE");
  if (r.redirect) fail(`${r.error} If that's the right server, run: kanehack pair --api ${new URL(r.redirect).origin}`, EXIT.UNREACHABLE, "REDIRECT");
  if (r.status === 401) fail("Not paired (or the token was revoked or expired). Run: kanehack pair", EXIT.ACTION, "UNAUTHENTICATED");
  if (!r.env) fail(`${what} failed: ${r.error}`, EXIT.FAIL, "BAD_RESPONSE");
  return r;
}

const json = (body, key) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
  body: JSON.stringify(body),
});

/** Call one MCP tool over Streamable HTTP and return its envelope. */
async function tool(cfg, name, argsObj) {
  const r = await api(cfg, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: argsObj } }),
  });
  if (r.status === 0 || r.redirect || r.status === 401) ensure(r);
  const text = r.env?.result?.content?.[0]?.text;
  if (!text) fail(r.env?.error?.message || r.env?.message || r.error || `MCP call ${name} failed (HTTP ${r.status}).`, EXIT.FAIL, "MCP_FAILED");
  try {
    return JSON.parse(text);
  } catch {
    fail(`${name} failed: ${text.slice(0, 300)}`, EXIT.FAIL, "MCP_FAILED");
  }
}

function printEnvelope(env) {
  const line = env.status === "error" ? bad : env.status === "ok" ? (s) => s : warn;
  say(line(env.fallback?.text || env.message));
  for (const w of env.warnings || []) say(warn(`! ${w}`));
  for (const l of env.links || []) say(dim(`→ ${l.label}: ${l.url}`));
}

/** The parts of a server envelope worth handing to a script. */
const envJson = (env) => ({ status: env.status, message: env.message, text: env.fallback?.text ?? env.message, data: env.data ?? null, links: env.links ?? [], warnings: env.warnings ?? [], error: env.error ?? null, request_id: env.request_id });

function needToken(cfg) {
  if (!cfg.token) fail("This machine isn't paired yet. Run: kanehack pair", EXIT.ACTION, "NOT_PAIRED");
}

// ── child processes (Windows needs a shell for .cmd shims, so quote for it) ──

function winQuote(s) {
  if (/^[A-Za-z0-9_\-+=.,:/\\@]+$/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}
/** Windows: does `cmd` resolve through PATH + PATHEXT? (cmd.exe reports "not recognized" with exit 1, not a spawn error.) */
function winFound(cmd) {
  if (/[\\/]/.test(cmd)) return existsSync(cmd) || (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").some((e) => existsSync(cmd + e));
  const exts = ["", ...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)];
  const dirs = (process.env.PATH || process.env.Path || "").split(";").filter(Boolean);
  return dirs.some((d) => exts.some((e) => existsSync(join(d, cmd + e))));
}
/** [cmd, args, opts] for spawn/spawnSync: plain argv on POSIX; one quoted command line through cmd.exe on Windows. */
function cmdline(cmd, argv, opts = {}) {
  if (!WIN) return [cmd, argv, opts];
  return [[cmd, ...argv].map(winQuote).join(" "), [], { ...opts, shell: true }];
}

// ── pair ─────────────────────────────────────────────────────────────────────

function loadPending() {
  try {
    return JSON.parse(readFileSync(PENDING, "utf8"));
  } catch {
    return null;
  }
}
const clearPending = () => rmSync(PENDING, { force: true });

async function pair(a) {
  const cfg = loadConfig();
  if (a.flags.api) cfg.api = String(a.flags.api).replace(/\/$/, "");
  if (a.flags.token) return pairWithToken(cfg, String(a.flags.token).trim());
  if (a.flags.wait) {
    const p = loadPending();
    if (!p?.device_code) fail("No pairing in progress on this machine. Start one: kanehack pair --start", EXIT.ACTION, "NO_PENDING_PAIRING");
    return pairWait(p, timeoutFrom(a, 90), { pollFirst: true });
  }
  const p = await pairStart(cfg);
  say(`Open ${c("1", p.verification_url)} and approve code ${c("1", p.user_code)}`);
  say(dim(`(sign in first if asked; the code expires ${p.expires_at})`));
  if (a.flags.start) {
    say(dim("Then run: kanehack pair --wait"));
    emit({ ok: true, exit_code: 0, status: "pending", user_code: p.user_code, verification_url: p.verification_url, expires_at: p.expires_at, interval: p.interval, next: "kanehack pair --wait" });
    return;
  }
  // In a terminal: wait until the code expires. Without one (agents, CI): wait a bounded time,
  // so a tool-call timeout can't kill us mid-poll; `kanehack pair --wait` picks it up again.
  return pairWait(p, timeoutFrom(a, interactive() ? Infinity : 90), { pollFirst: false });
}

function timeoutFrom(a, dflt) {
  if (a.flags.timeout === undefined) return dflt;
  const t = Number(a.flags.timeout);
  if (!Number.isFinite(t) || t < 0) fail("--timeout takes a number of seconds.", EXIT.ACTION, "USAGE");
  return t;
}

async function pairWithToken(cfg, token) {
  if (!/^khk_[A-Za-z0-9_-]{20,}$/.test(token)) fail("That doesn't look like a kanehack token (khk_…).", EXIT.ACTION, "USAGE");
  const r = await api({ ...cfg, token }, "/api/v1/kane/runs?limit=1");
  if (r.status === 401) fail("The server rejected that token. Run kanehack pair to get a new one.", EXIT.ACTION, "UNAUTHENTICATED");
  if (r.status === 0 || r.redirect) ensure(r);
  saveConfig({ token, api: cfg.api });
  say(ok("Paired."), dim(`Token saved in ${CONFIG} (mode 600).`));
  const noTeam = r.status === 403;
  if (noTeam) say(warn("You're not on a team yet: join or create one before reporting runs."));
  emit({ ok: true, exit_code: 0, status: "paired", api: cfg.api, config: CONFIG, on_team: !noTeam });
}

async function pairStart(cfg) {
  const label = `kanehack on ${hostname().slice(0, 40)} (${platform()})`;
  const start = await api(cfg, "/api/v1/pair/start", json({ label, client: "kanehack", client_version: VERSION }, randomUUID()));
  if (start.status === 404) {
    say(warn("Device pairing isn't available on this server."));
    fail(`Ask at the help desk, or pair with a token: kanehack pair --token khk_…  (server: ${cfg.api})`, EXIT.ACTION, "PAIRING_UNAVAILABLE");
  }
  ensure(start, "Pairing");
  const d = start.env.data ?? {};
  // Field names from POST /api/v1/pair/start (src/server/pairing.ts). The old names are accepted too.
  const p = {
    api: cfg.api,
    user_code: d.user_code ?? d.pair_code,
    device_code: d.device_code ?? d.poll_token,
    verification_url: d.verification_url ?? d.approve_url ?? `${cfg.api}/pair`,
    expires_at: d.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    interval: Math.max(2, Number(d.interval) || 5),
  };
  if (!start.ok || !p.user_code || !p.device_code) fail(start.env.fallback?.text || start.env.message || `Pairing failed (HTTP ${start.status}).`, EXIT.FAIL, start.env.error?.code ?? "PAIR_FAILED");
  writePrivate(PENDING, p);
  return p;
}

async function pairWait(p, timeoutSec, { pollFirst }) {
  const cfg = { api: p.api, token: null };
  const expires = Date.parse(p.expires_at) || Date.now() + 10 * 60_000;
  const until = Math.min(expires, Date.now() + timeoutSec * 1000);
  const interval = Math.max(2, Number(p.interval) || 5) * 1000;
  let first = pollFirst;
  let lastErr = null;
  say(dim(`Waiting for approval of ${p.user_code}…`));
  while (Date.now() < until || first) {
    if (!first) await new Promise((r) => setTimeout(r, Math.min(interval, Math.max(0, until - Date.now()))));
    first = false;
    const r = await api(cfg, "/api/v1/pair/confirm", json({ device_code: p.device_code }));
    if (r.status === 0) {
      lastErr = r.error;
      if (Date.now() >= until) break;
      continue;
    }
    lastErr = null;
    const token = r.env?.data?.token;
    if (r.ok && token) {
      saveConfig({ token, api: p.api });
      clearPending();
      const m = r.env.data.member ?? {};
      say(ok(`Paired${m.name ? ` as ${m.name}` : ""}.`), dim(`Token saved in ${CONFIG} (mode 600).`));
      say(dim("Agent not connected to the event server yet? kanehack connect codex (or: kanehack connect claude). No token to copy."));
      emit({ ok: true, exit_code: 0, status: "paired", member: { name: m.name ?? null, public_code: m.public_code ?? null }, token_expires_at: r.env.data.expires_at ?? null, api: p.api, config: CONFIG });
      return;
    }
    if (r.status === 410 || r.env?.error?.code === "PAIR_EXPIRED") {
      clearPending();
      fail("That code expired, was denied or was already used. Start again: kanehack pair", EXIT.FAIL, "PAIR_EXPIRED");
    }
    if (r.redirect) ensure(r);
    if (r.env?.status === "error" || (!r.ok && r.status !== 425 && r.status !== 428)) fail(r.env?.message || r.error || `Pairing failed (HTTP ${r.status}).`, EXIT.FAIL, r.env?.error?.code ?? "PAIR_FAILED");
    if (Date.now() >= expires) break;
  }
  if (lastErr) fail(`${lastErr} Your code is kept: kanehack pair --wait`, EXIT.UNREACHABLE, "UNREACHABLE");
  if (Date.now() >= expires) {
    clearPending();
    fail("Timed out: the code expired before it was approved. Start again: kanehack pair", EXIT.FAIL, "PAIR_EXPIRED");
  }
  say(warn(`Not approved yet. Approve ${p.user_code} at ${p.verification_url}, then run: kanehack pair --wait`));
  emit({ ok: false, exit_code: EXIT.PENDING, status: "pending", user_code: p.user_code, verification_url: p.verification_url, expires_at: p.expires_at, next: "kanehack pair --wait" });
  exit(EXIT.PENDING);
}

function token() {
  const cfg = loadConfig();
  needToken(cfg);
  // For `export KANEHACK_TOKEN="$(kanehack token)"`: stdout only, so it can be captured without being shown.
  process.stdout.write(cfg.token + "\n");
}

// ── agents: connect Codex / Claude Code to the event MCP server ─────────────
//
// Both agents run a "headers helper" command when they connect and send the JSON object it
// prints as HTTP headers (Codex: http_headers_helper, run with `sh -c` / `cmd /Q /D /C`, 10 s
// timeout, PATH and HOME passed through, other env cleared; Claude Code: headersHelper). So the
// agent's config holds only `kanehack mcp-headers`, never the token, and re-pairing needs no
// reconnect.

const MCP_NAME = "kane-hack-event";
const SELF = fileURLToPath(import.meta.url);

/** The MCP endpoint. kaneclihack.sh 308s to www and agents refuse cross-origin redirects, so use www. */
function mcpUrl(cfg) {
  const u = new URL(cfg.api);
  if (u.hostname === "kaneclihack.sh") u.hostname = "www.kaneclihack.sh";
  return `${u.origin}/mcp`;
}

/** `node` from PATH when it is this same binary (that path survives `brew upgrade`), else this exact binary. */
function stableNode() {
  let real;
  try {
    real = realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
  for (const d of (process.env.PATH || process.env.Path || "").split(delimiter).filter(Boolean)) {
    const p = join(d, WIN ? "node.exe" : "node");
    try {
      if (realpathSync(p) === real) return p;
    } catch {}
  }
  return process.execPath;
}

/** The command the agent runs for headers: absolute paths, so an agent started from a GUI with a short PATH still finds it. */
function helperCommand() {
  const q = WIN ? (s) => `"${s}"` : (s) => `'${s.replaceAll("'", `'\\''`)}'`;
  return `${q(stableNode())} ${q(SELF)} mcp-headers`;
}
const isOurHelper = (cmd) => typeof cmd === "string" && cmd.includes("kanehack") && cmd.includes("mcp-headers");
const isOurUrl = (u, target) => {
  if (u === target) return true;
  try {
    const h = new URL(u).hostname;
    return h === "kaneclihack.sh" || h.endsWith(".kaneclihack.sh");
  } catch {
    return false;
  }
};

function mcpHeaders() {
  const cfg = loadConfig();
  // No --json document here: the agent reads stdout as the headers object, nothing else.
  if (!cfg.token) {
    say(bad("kanehack: not paired, so there is no token for the event MCP server. Run: kanehack pair"));
    exit(EXIT.ACTION);
  }
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${cfg.token}` }) + "\n");
}

const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

/** A TOML value (basic or literal string, or anything else raw), with a trailing comment removed. */
function tomlValue(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  if (s.startsWith("'")) {
    const m = s.match(/^'([^']*)'/);
    if (m) return m[1];
  }
  return s.replace(/\s+#.*$/, "");
}

/**
 * Find [mcp_servers.kane-hack-event] in Codex's config.toml. A small line-based reader: enough
 * for the table we write, and anything else that mentions the name is reported as
 * "unrecognized" and left alone. Codex itself validates the result (`codex mcp get`).
 */
function readCodexEntry(file, url, helper) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { file, text: null, state: "absent" };
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const name = String.raw`(?:"${MCP_NAME}"|'${MCP_NAME}'|${MCP_NAME})`;
  const header = new RegExp(String.raw`^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*${name}[ \t]*\][ \t]*(?:#.*)?$`);
  const subtable = new RegExp(String.raw`^[ \t]*\[{1,2}[ \t]*mcp_servers[ \t]*\.[ \t]*${name}[ \t]*\.`);
  const start = lines.findIndex((l) => header.test(l));
  let end = start + 1;
  if (start >= 0) while (end < lines.length && !/^[ \t]*\[/.test(lines[end])) end++;
  const elsewhere = lines.some((l, i) => (start < 0 || i < start || i >= end) && l.includes(MCP_NAME) && !/^[ \t]*#/.test(l) && !subtable.test(l));
  if (start < 0) return { file, text, eol, lines, state: elsewhere ? "unrecognized" : "absent" };
  const body = lines.slice(start + 1, end);
  const get = (k) => {
    const l = body.find((x) => new RegExp(String.raw`^[ \t]*${k}[ \t]*=`).test(x));
    return l === undefined ? undefined : tomlValue(l.slice(l.indexOf("=") + 1));
  };
  const existing = { url: get("url"), http_headers_helper: get("http_headers_helper"), bearer_token_env_var: get("bearer_token_env_var"), command: get("command") };
  const ours = existing.command === undefined && (isOurHelper(existing.http_headers_helper) || (existing.url && isOurUrl(existing.url, url)));
  const state = elsewhere ? "unrecognized" : !ours ? "different" : existing.url === url && existing.http_headers_helper === helper && existing.bearer_token_env_var === undefined ? "current" : "outdated";
  return { file, text, eol, lines, start, end, body, existing, state };
}

function codexEntryText(e, url, helper) {
  const block = [
    `[mcp_servers.${MCP_NAME}]`,
    "# Added by kanehack (Kane CLI Hack Day). The helper prints the Authorization header from ~/.kanehack/config.json: no token is stored here.",
    `url = ${JSON.stringify(url)}`,
    `http_headers_helper = ${JSON.stringify(helper)}`,
  ];
  if (e.state === "absent") {
    const t = e.text ?? "";
    const eol = e.eol ?? "\n";
    return t + (t && !t.endsWith("\n") ? eol : "") + (t.trim() ? eol : "") + block.join(eol) + eol;
  }
  // Keep the user's other keys (timeouts, enabled_tools…); replace what we own; drop the old env-var auth.
  const kept = e.body.filter((l) => !/^[ \t]*(url|http_headers_helper|bearer_token_env_var)[ \t]*=/.test(l) && !/^[ \t]*# Added by kanehack/.test(l));
  return [...e.lines.slice(0, e.start), ...block, ...kept, ...e.lines.slice(e.end)].join(e.eol);
}

function codexCli() {
  const r = probe("codex", ["--version"], { timeout: 20_000 });
  return r.found && r.code === 0 ? r.stdout.trim().split("\n")[0].slice(0, 40) || "codex" : null;
}

/** What `codex mcp get kane-hack-event --json` says (Codex's own parse of the config). */
function codexGet() {
  const r = probe("codex", ["mcp", "get", MCP_NAME, "--json"], { timeout: 30_000 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { ok: r.code === 0 && Boolean(json), json, out: r.out };
}

function writeAtomic(file, text) {
  const tmp = `${file}.kanehack-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function nextSteps(cfg, agent) {
  if (!cfg.token) say(warn("Not paired yet: run kanehack pair (the agent gets 401 until you do)."));
  say(dim(agent === "codex" ? "Start a new Codex session, then try $hack-onboard. Check with: codex mcp list" : "Start a new Claude Code session, then try /hack-onboard. Check with: claude mcp list"));
}

async function connectCodex(a, cfg) {
  const url = a.flags.url ? String(a.flags.url) : mcpUrl(cfg);
  const helper = helperCommand();
  const file = join(codexHome(), "config.toml");
  const e = readCodexEntry(file, url, helper);
  const cli = codexCli();
  const base = { agent: "codex", name: MCP_NAME, url, config: file, codex_cli: cli, paired: Boolean(cfg.token) };
  if (e.state === "different" || e.state === "unrecognized") {
    const what = e.state === "different" ? `another server named ${MCP_NAME} (${e.existing.url ?? e.existing.command ?? "no url"})` : `${MCP_NAME} in a form kanehack doesn't edit`;
    fail(`${file} already has ${what}. Left it alone. To replace it: codex mcp remove ${MCP_NAME}, then kanehack connect codex`, EXIT.ACTION, "MCP_NAME_TAKEN", { ...base, state: e.state });
  }
  if (a.flags.check) {
    const current = e.state === "current";
    if (!JSON_MODE) say(current ? ok(`Codex is connected to ${url}.`) : warn(`Codex isn't connected (${e.state === "absent" ? `no ${MCP_NAME} in ${file}` : "old setup"}). Run: kanehack connect codex`));
    emit({ ok: current, exit_code: current ? 0 : 1, ...base, state: e.state });
    process.exitCode = current ? EXIT.OK : EXIT.FAIL;
    return;
  }
  if (e.state === "current") {
    say(ok(`Codex is already connected: ${MCP_NAME} → ${url}`));
    nextSteps(cfg, "codex");
    return emit({ ok: true, exit_code: 0, ...base, state: "current", backup: null });
  }
  mkdirSync(codexHome(), { recursive: true });
  const backup = e.text !== null ? `${file}.kanehack-${stamp()}.bak` : null;
  if (backup) copyFileSync(file, backup);
  writeAtomic(file, codexEntryText(e, url, helper));
  if (cli) {
    const g = codexGet();
    const t = g.json?.transport ?? {};
    if (!g.ok || t.url !== url || !t.http_headers_helper) {
      if (backup) copyFileSync(backup, file);
      else rmSync(file, { force: true });
      fail(`Codex didn't accept the change, so ${file} was restored. codex said: ${g.out.slice(0, 300)}`, EXIT.FAIL, "CODEX_REJECTED", { ...base, state: e.state });
    }
  }
  say(ok(`Codex ${e.state === "absent" ? "connected" : "updated"}: ${MCP_NAME} → ${url} (${cli ? "checked with codex mcp get" : "codex isn't on PATH, so not checked"}). No token is stored in ${file}.`));
  if (backup) say(dim(`Backup of the old file: ${backup}`));
  nextSteps(cfg, "codex");
  emit({ ok: true, exit_code: 0, ...base, state: e.state === "absent" ? "added" : "updated", backup, verified_with_codex: Boolean(cli) });
}

const claudeConfig = () => join(process.env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json");
function readClaudeEntry(url, helper) {
  let s = null;
  try {
    s = JSON.parse(readFileSync(claudeConfig(), "utf8"))?.mcpServers?.[MCP_NAME] ?? null;
  } catch {}
  if (!s) return { state: "absent" };
  const ours = isOurHelper(s.headersHelper) || (s.url && isOurUrl(s.url, url));
  const state = !ours ? "different" : s.type === "http" && s.url === url && s.headersHelper === helper && !s.headers ? "current" : "outdated";
  return { state, existing: { url: s.url ?? null, type: s.type ?? null } };
}

async function connectClaude(a, cfg) {
  const url = a.flags.url ? String(a.flags.url) : mcpUrl(cfg);
  const helper = helperCommand();
  const base = { agent: "claude", name: MCP_NAME, url, config: claudeConfig(), scope: "user", paired: Boolean(cfg.token) };
  const v = probe("claude", ["--version"], { timeout: 20_000 });
  if (!v.found || v.code !== 0) fail("Claude Code (claude) isn't on PATH. Install it, then run: kanehack connect claude", EXIT.ACTION, "CLAUDE_NOT_FOUND", base);
  const e = readClaudeEntry(url, helper);
  if (e.state === "different") fail(`Claude Code already has another server named ${MCP_NAME} (${e.existing.url ?? "no url"}). Left it alone. To replace it: claude mcp remove -s user ${MCP_NAME}, then kanehack connect claude`, EXIT.ACTION, "MCP_NAME_TAKEN", { ...base, state: e.state });
  if (a.flags.check) {
    const current = e.state === "current";
    if (!JSON_MODE) say(current ? ok(`Claude Code is connected to ${url}.`) : warn("Claude Code isn't connected. Run: kanehack connect claude"));
    emit({ ok: current, exit_code: current ? 0 : 1, ...base, state: e.state });
    process.exitCode = current ? EXIT.OK : EXIT.FAIL;
    return;
  }
  if (e.state === "current") {
    say(ok(`Claude Code is already connected: ${MCP_NAME} → ${url}`));
    nextSteps(cfg, "claude");
    return emit({ ok: true, exit_code: 0, ...base, state: "current" });
  }
  if (e.state === "outdated") probe("claude", ["mcp", "remove", "-s", "user", MCP_NAME], { timeout: 30_000 });
  const add = probe("claude", ["mcp", "add-json", "-s", "user", MCP_NAME, JSON.stringify({ type: "http", url, headersHelper: helper })], { timeout: 30_000 });
  if (readClaudeEntry(url, helper).state !== "current") fail(`claude mcp add-json didn't take: ${add.out.slice(0, 300)}`, EXIT.FAIL, "CLAUDE_REJECTED", { ...base, state: e.state });
  say(ok(`Claude Code ${e.state === "absent" ? "connected" : "updated"} (user scope): ${MCP_NAME} → ${url}. No token is stored; it runs kanehack mcp-headers.`));
  nextSteps(cfg, "claude");
  emit({ ok: true, exit_code: 0, ...base, state: e.state === "absent" ? "added" : "updated" });
}

async function connect(a) {
  const cfg = loadConfig();
  const which = a._[1];
  if (which === "codex") return connectCodex(a, cfg);
  if (which === "claude") return connectClaude(a, cfg);
  fail("Usage: kanehack connect codex|claude [--check] [--url URL]", EXIT.ACTION, "USAGE");
}

// ── doctor ───────────────────────────────────────────────────────────────────

function probe(cmd, argv, opts = {}) {
  const [file, rest, o] = cmdline(cmd, argv, { encoding: "utf8", timeout: opts.timeout ?? 15_000 });
  const r = spawnSync(file, rest, o);
  // On Windows the shell itself starts, so "not found" is cmd's exit code 9009.
  if (r.error || (WIN && r.status === 9009)) return { found: false, code: null, out: "", stdout: "" };
  return { found: true, code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim(), stdout: r.stdout || "" };
}

function chromePresent() {
  const p = platform();
  const paths =
    p === "darwin"
      ? ["/Applications/Google Chrome.app", join(homedir(), "Applications/Google Chrome.app")]
      : p === "win32"
        ? [join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"), join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"), join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe")]
        : [];
  if (paths.some((x) => x && existsSync(x))) return true;
  if (p === "win32") return false;
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].some((b) => probe(b, ["--version"]).code === 0);
}

// The server's readiness ids (src/server/passport.ts READINESS_CHECKS) and statuses (pass|warn|fail|skip).
const SERVER_CHECK_IDS = { os: "os_arch", kane_cli: "kane_version", kane_auth: "kane_whoami" };

/** Codex (and Claude Code, when present): installed, skills discoverable, event MCP server connected. */
function agentChecks(cfg, add, reinstall) {
  const url = mcpUrl(cfg);
  const helper = helperCommand();
  const cx = codexCli();
  if (!cx && !existsSync(codexHome())) add("codex", "skipped", null, "not installed (optional)", "Optional: npm i -g @openai/codex, then kanehack connect codex");
  else {
    add("codex", cx ? "pass" : "warn", cx, cx ? null : `${codexHome()} exists but codex isn't on PATH`, "npm i -g @openai/codex");
    // Codex reads ~/.agents/skills (documented) and also $CODEX_HOME/skills: a copy in both lists every skill twice.
    const inAgents = existsSync(join(homedir(), ".agents/skills/hack-onboard/SKILL.md"));
    const dupDir = join(codexHome(), "skills");
    const dup = existsSync(join(dupDir, "hack-onboard/SKILL.md"));
    const rmDup = WIN ? `Remove-Item -Recurse -Force "${join(dupDir, "hack-*")}"` : `rm -rf "${dupDir}"/hack-*`;
    add("codex_skills", inAgents && !dup ? "pass" : "warn", null, !inAgents ? "hack-* skills not in ~/.agents/skills" : dup ? `a second copy in ${dupDir} makes Codex list each skill twice` : null, !inAgents ? `Re-run the installer: ${reinstall}` : rmDup);
    const e = readCodexEntry(join(codexHome(), "config.toml"), url, helper);
    const detail = { current: null, absent: `no ${MCP_NAME} server in ${e.file}`, outdated: `${MCP_NAME} uses an older setup`, different: `another server is named ${MCP_NAME}`, unrecognized: `${MCP_NAME} is configured in a form kanehack doesn't edit` }[e.state];
    add("codex_mcp", e.state === "current" ? "pass" : "warn", null, detail, e.state === "different" || e.state === "unrecognized" ? `codex mcp remove ${MCP_NAME}, then kanehack connect codex` : "kanehack connect codex");
  }
  const cl = probe("claude", ["--version"], { timeout: 20_000 });
  if (cl.found && cl.code === 0) {
    const e = readClaudeEntry(url, helper);
    const detail = { current: null, absent: `no ${MCP_NAME} server in Claude Code (user scope)`, outdated: `${MCP_NAME} uses an older setup`, different: `another server is named ${MCP_NAME}` }[e.state];
    add("claude_mcp", e.state === "current" ? "pass" : "warn", null, detail, e.state === "different" ? `claude mcp remove -s user ${MCP_NAME}, then kanehack connect claude` : "kanehack connect claude");
  }
}

async function doctor(a) {
  const cfg = loadConfig();
  const checks = [];
  const add = (id, status, version, detail, fix) => checks.push({ id, status, ...(version ? { version } : {}), ...(detail ? { detail } : {}), fix });

  add("os", "pass", `${platform()}-${arch()}`);
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 18 ? "pass" : "fail", process.versions.node, null, "Install Node 18 or newer from https://nodejs.org");
  const git = probe("git", ["--version"]);
  add("git", git.code === 0 ? "pass" : "fail", git.out.replace("git version ", "").slice(0, 30) || null, null, "Install Git from https://git-scm.com");
  add("chrome", chromePresent() ? "pass" : "fail", null, null, "Install Google Chrome; Kane drives a real browser");
  const kane = probe("kane-cli", ["--version"]);
  add("kane_cli", kane.code === 0 ? "pass" : "fail", kane.out.split("\n")[0]?.slice(0, 40) || null, null, "npm i -g @testmuai/kane-cli");
  if (kane.code === 0) {
    const who = probe("kane-cli", ["whoami"], { timeout: 20_000 });
    add("kane_auth", who.code === 0 ? "pass" : "fail", null, null, "kane-cli login");
  } else add("kane_auth", "skipped", null, "kane-cli not installed", "Install Kane CLI first");
  const skillDirs = [".claude/skills/kane-cli", ".agents/skills/kane-cli", ".codex/skills/kane-cli", ".gemini/skills/kane-cli"].map((d) => join(homedir(), d));
  add("kane_skill", skillDirs.some((d) => existsSync(join(d, "SKILL.md"))) ? "pass" : "warn", null, null, "npx @testmuai/kane-cli-skill");
  const pluginDirs = [join(process.cwd(), ".agents/skills/hack-onboard"), join(homedir(), ".agents/skills/hack-onboard"), join(homedir(), ".claude/skills/hack-onboard"), join(homedir(), ".codex/skills/hack-onboard")];
  const reinstall = WIN ? "irm https://www.kaneclihack.sh/install.ps1 | iex" : "curl -fsSL https://kaneclihack.sh/install.sh | sh";
  add("plugin", pluginDirs.some((d) => existsSync(join(d, "SKILL.md"))) ? "pass" : "warn", null, null, `Re-run the installer to add the hack-* skills: ${reinstall}`);
  agentChecks(cfg, add, reinstall);
  const r = await api(cfg, "/api/v1/kane/runs?limit=1", { timeout: 10_000 });
  if (!cfg.token) add("api", r.status === 401 ? "warn" : "fail", null, r.status === 401 ? "reachable, not paired" : r.status === 0 ? "unreachable" : `HTTP ${r.status}`, r.status === 401 ? "kanehack pair" : `Check your network; the server is ${cfg.api}`);
  else add("api", r.status === 200 || r.status === 403 ? "pass" : "fail", null, r.status === 0 ? "unreachable" : r.status === 403 ? "paired, not on a team yet" : `HTTP ${r.status}`, r.status === 401 ? "kanehack pair (token rejected)" : `Check your network; the server is ${cfg.api}`);

  if (!JSON_MODE)
    for (const ch of checks) {
      const mark = ch.status === "pass" ? ok("✓") : ch.status === "fail" ? bad("✗") : warn("!");
      say(`${mark} ${ch.id.padEnd(11)} ${ch.version ?? ""}${ch.detail ? dim(` (${ch.detail})`) : ""}${ch.status === "pass" ? "" : dim(`  → ${ch.fix}`)}`);
    }
  const failed = checks.some((x) => x.status === "fail");
  let readiness = null;
  if (a.flags.report) {
    needToken(cfg);
    const env = await tool(cfg, "readiness_report", { checks: checks.map(({ fix, ...rest }) => (void fix, { ...rest, id: SERVER_CHECK_IDS[rest.id] ?? rest.id, status: rest.status === "skipped" ? "skip" : rest.status })) });
    if (!JSON_MODE) printEnvelope(env);
    readiness = envJson(env);
  }
  emit({ ok: !failed, exit_code: failed ? 1 : 0, version: VERSION, api: cfg.api, paired: Boolean(cfg.token), checks, ...(readiness ? { readiness } : {}) });
  process.exitCode = failed ? EXIT.FAIL : EXIT.OK;
}

// ── report ───────────────────────────────────────────────────────────────────

const KIND_BY_EXT = { zip: "zip", png: "screenshot", jpg: "screenshot", jpeg: "screenshot", webp: "screenshot", mp4: "video", webm: "video", ndjson: "ndjson", jsonl: "ndjson", json: "report", pdf: "report", html: "report", md: "testmd", log: "log", txt: "log" };

async function askConsent(cfg) {
  if (cfg.consent === true) return true;
  if (cfg.consent === false) return false;
  if (!interactive()) {
    say(warn("Not sending: run summaries need your OK once. Run `kanehack consent yes` (or `no`)."));
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const a = (await rl.question("Send a redacted summary of Kane runs (exit code, status, test names; no secrets, no local paths) to your team's Proof tab? [y/N] ")).trim().toLowerCase();
  rl.close();
  const yes = a === "y" || a === "yes";
  saveConfig({ consent: yes });
  return yes;
}

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : null;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return { sha: null, dirty: false };
  const s = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  return { sha, dirty: s.status === 0 && s.stdout.trim().length > 0 };
}

async function report(a) {
  const cmd = a.rest;
  if (!cmd?.length) {
    const example = 'kanehack report -- kane-cli run "Open https://kaneclihack.sh and find the schedule" --agent';
    say('Usage: kanehack report [--evidence pack.zip] [--objective "…"] [--json] -- kane-cli run "…" --agent');
    say(`Example: ${example}`);
    fail("Put the Kane command to run after --", EXIT.ACTION, "USAGE", { example });
  }
  const cfg = loadConfig();

  if (WIN && !winFound(cmd[0])) fail(`Couldn't start ${cmd[0]}: not found on PATH`, 127, "COMMAND_NOT_FOUND");
  // Run Kane exactly as given; stdout is passed through untouched and captured.
  const [file, rest, opts] = cmdline(cmd[0], cmd.slice(1), { stdio: ["inherit", "pipe", "inherit"] });
  const child = spawn(file, rest, opts);
  const chunks = [];
  child.stdout.on("data", (b) => {
    chunks.push(b);
    process.stdout.write(b);
  });
  const ran = await new Promise((resolve) => {
    child.on("error", (e) => resolve({ code: null, error: e }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  if (ran.error || (WIN && ran.code === 9009)) fail(`Couldn't start ${cmd[0]}: ${ran.error?.code ?? ran.error?.message ?? "not found"}`, 127, "COMMAND_NOT_FOUND");
  // Killed by a signal: Kane didn't exit on its own → treat as cancelled (3).
  const exitCode = ran.code ?? 3;
  const raw = Buffer.concat(chunks).toString("utf8");
  const s = scan(raw);
  const summary = { type: "kanehack_report", version: VERSION, exit_code: exitCode, completion_event: s.terminal, kane_status: s.status, reported: false };
  // --json: one more NDJSON line after Kane's own, so the stream stays line-delimited JSON.
  const done = (extra = {}) => {
    if (JSON_MODE) process.stdout.write(`${raw && !raw.endsWith("\n") ? "\n" : ""}${JSON.stringify({ ...summary, ...extra })}\n`);
    exit(exitCode);
  };

  say("");
  say(`${exitCode === 0 && s.terminal ? ok("●") : exitCode === 1 ? warn("●") : bad("●")} exit ${exitCode}${s.terminal ? ` · ${s.terminal}` : bad(" · no completion event (not a pass)")}${s.oneLiner ? ` · ${s.oneLiner}` : ""}`);
  if (s.totals) say(dim(`  ${s.totals.tests ?? "?"} tests · ${s.totals.passed ?? "?"} passed · ${s.totals.failed ?? "?"} failed`));
  for (const f of s.failures.slice(0, 5)) say(warn(`  ✗ ${f.path}: ${f.message ?? f.status} (a detection, not yet a confirmed bug)`));

  if (a.flags["no-upload"]) return done({ reason: "no_upload" });
  if (!cfg.token) {
    say(warn("Not reported: this machine isn't paired. Run `kanehack pair`, or log the run by hand on your Proof tab."));
    return done({ reason: "not_paired" });
  }
  if (!(await askConsent(cfg))) return done({ reason: cfg.consent === false ? "consent_no" : "consent_needed" });

  let ndjson = redactText(raw);
  if (ndjson.length > MAX_NDJSON) ndjson = typedOnly(ndjson).slice(-MAX_NDJSON);
  const git = gitHead();
  const commit = a.flags.commit ? String(a.flags.commit) : git.sha;
  if (git.dirty && !a.flags.commit) say(warn("! Uncommitted changes: the run is tied to HEAD, which isn't exactly what ran."));

  let evidenceSha = null;
  let evidencePath = null;
  if (a.flags.evidence) {
    evidencePath = String(a.flags.evidence);
    if (!existsSync(evidencePath)) {
      say(bad(`No such evidence file: ${evidencePath}. The run was not reported.`));
      return done({ reason: "evidence_missing" });
    }
    evidenceSha = createHash("sha256").update(readFileSync(evidencePath)).digest("hex");
  }

  const family = s.family === "unknown" ? (cmd.includes("testrun") ? "testrun" : cmd.includes("testmd") ? "testmd" : cmd.includes("cover") ? "cover" : "run") : s.family;
  const execId = s.executionId || s.sessionId || `kanehack-${randomUUID()}`;
  const objective = a.flags.objective ? String(a.flags.objective) : objectiveFrom(cmd, family);
  const payload = {
    source_execution_id: execId,
    exit_code: exitCode,
    command: ["run", "testmd", "testrun", "cover"].includes(family) ? family : family === "assurance" ? "cover" : "other",
    ...(objective ? { objective: objective.slice(0, 500) } : {}),
    ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { commit_sha: commit } : {}),
    ...(evidenceSha ? { evidence_sha256: evidenceSha } : {}),
    ndjson,
  };
  const r = await api(cfg, "/api/v1/kane/runs", { ...json(payload, `kanehack:${execId}:${exitCode}`), timeout: 60_000 });
  if (!r.env) {
    say(bad(`Report failed (${r.error ?? `HTTP ${r.status}`}). Your run still happened; keep the evidence and log it on the Proof tab.`));
    return done({ reason: r.status === 0 ? "unreachable" : "upload_failed", http_status: r.status });
  }
  printEnvelope(r.env);
  if (r.status === 401) say(warn("The token was rejected: run `kanehack pair` again."));
  const d = r.env.data ?? {};
  const runId = d.run_id ?? d.id ?? null;
  const result = { reported: r.env.status !== "error" && runId != null, run_id: runId, status: d.status ?? null, source_verified: d.source_verified ?? null, url: d.url ?? null, server: envJson(r.env) };

  if (evidencePath && runId) {
    const size = statSync(evidencePath).size;
    if (size > MAX_DIRECT_EVIDENCE) say(warn(`! ${basename(evidencePath)} is over 4 MB: upload it on the Proof tab (it'll be matched by sha256).`));
    else {
      const kind = KIND_BY_EXT[extname(evidencePath).slice(1).toLowerCase()] || "other";
      const form = new FormData();
      form.set("file", new Blob([readFileSync(evidencePath)]), basename(evidencePath));
      form.set("kind", kind);
      form.set("run_id", String(runId));
      form.set("sha256", evidenceSha);
      const e = await api(cfg, "/api/v1/kane/evidence", { method: "POST", body: form, timeout: 120_000 });
      if (e.env) printEnvelope(e.env);
      else say(bad(`Evidence upload failed (${e.error ?? `HTTP ${e.status}`}). Upload it on the Proof tab.`));
      result.evidence = e.env ? envJson(e.env) : { status: "error", message: e.error };
    }
  }
  return done(result);
}

function objectiveFrom(cmd, family) {
  // kane-cli run "<objective>" … → the objective; testmd/testrun → the file or selection.
  const i = cmd.findIndex((x) => x === "run");
  const next = i >= 0 ? cmd[i + 1] : null;
  if (next && !next.startsWith("-")) return family === "testmd" || family === "testrun" ? basename(next) : next;
  return null;
}

// ── status, help, submit, consent, hook ──────────────────────────────────────

async function status() {
  const cfg = loadConfig();
  needToken(cfg);
  const r = ensure(await api(cfg, "/api/v1/kane/runs?limit=10"), "Status");
  if (r.env.status === "error") {
    const code = r.status === 403 ? EXIT.ACTION : EXIT.FAIL;
    printEnvelope(r.env);
    emit({ ok: false, exit_code: code, ...envJson(r.env) });
    exit(code);
  }
  const runs = r.env.data?.runs ?? [];
  if (!runs.length) say(r.env.fallback?.text || "No Kane runs reported yet.");
  for (const run of runs) {
    const v = run.source_verified ? ok("VERIFIED") : run.verification_state === "manual_unverified" ? dim("manual") : warn("unverified");
    say(`KR-${run.id}  ${String(run.status).padEnd(9)} exit ${run.exit_code ?? "—"}  ${v}  ${dim(run.commit_sha?.slice(0, 7) ?? "")}  ${run.objective ?? ""}`);
  }
  for (const l of r.env.links ?? []) say(dim(`→ ${l.url}`));
  emit({ ok: true, exit_code: 0, team_slug: r.env.data?.team_slug ?? null, project_id: r.env.data?.project_id ?? null, runs, links: r.env.links ?? [] });
}

function finishEnvelope(env, okCode = EXIT.OK) {
  printEnvelope(env);
  const failed = env.status === "error";
  emit({ ok: !failed, exit_code: failed ? EXIT.FAIL : okCode, ...envJson(env) });
  process.exitCode = failed ? EXIT.FAIL : okCode;
}

async function help(a) {
  const cfg = loadConfig();
  if (a.flags.status) {
    const id = String(a.flags.status).trim();
    if (!/^[A-Za-z]{1,4}-?\d{1,6}$/.test(id)) fail("Usage: kanehack help --status H-0042 (the ticket code you were given).", EXIT.ACTION, "USAGE");
    needToken(cfg);
    return finishEnvelope(await tool(cfg, "help_get_status", { ticket_id: id }));
  }
  const summary = a._.slice(1).join(" ").trim();
  if (summary.length < 5) fail('Usage: kanehack help "what is wrong, in a sentence" [--category kane_cli] [--priority high]', EXIT.ACTION, "USAGE");
  needToken(cfg);
  const env = await tool(cfg, "help_create", {
    category: String(a.flags.category || "kane_cli"),
    safe_summary: redactText(summary).slice(0, 300),
    ...(a.flags.tried ? { tried: redactText(String(a.flags.tried)).slice(0, 1000) } : {}),
    ...(a.flags.run ? { run_id: String(a.flags.run) } : {}),
    priority: String(a.flags.priority || "normal"),
    idempotency_key: `kanehack-help-${createHash("sha256").update(summary).digest("hex").slice(0, 24)}`,
  });
  finishEnvelope(env);
}

async function submit(a) {
  const cfg = loadConfig();
  if (!a.flags.preflight) {
    say("Finalizing needs your explicit confirmation, so it happens on the Submit tab or through your agent (submission_finalize).");
    fail("Run `kanehack submit --preflight` to see what's missing.", EXIT.ACTION, "USAGE");
  }
  needToken(cfg);
  const env = await tool(cfg, "submission_preflight", {});
  finishEnvelope(env, env.data?.ready ? EXIT.OK : EXIT.FAIL);
}

function consent(a) {
  const v = a._[1];
  if (v === undefined || v === "status") {
    const cur = loadConfig().consent;
    say(cur === true ? "Run summaries: allowed." : cur === false ? "Run summaries: off." : "Run summaries: not decided yet (nothing is sent until you run `kanehack consent yes`).");
    return emit({ ok: true, exit_code: 0, consent: cur });
  }
  if (v !== "yes" && v !== "no") fail("Usage: kanehack consent yes|no|status", EXIT.ACTION, "USAGE");
  saveConfig({ consent: v === "yes" });
  say(v === "yes" ? ok("Run summaries will be sent when you use kanehack report.") : "kanehack report will no longer send anything.");
  emit({ ok: true, exit_code: 0, consent: v === "yes" });
}

function hook(a) {
  const sub = a._[1] || "status";
  const off = (msg) => {
    say(msg);
    emit({ ok: true, exit_code: 0, hook: "off" });
  };
  if (sub === "status") return off("Lifecycle hook: off. (It's optional and not available yet; see plugin/hooks/README.md.)");
  if (sub === "disable") return off("Lifecycle hook: off.");
  if (sub === "enable") fail("The lifecycle hook isn't available yet: its endpoint must ship with the same redaction and consent checks first. Nothing was enabled.", EXIT.ACTION, "NOT_AVAILABLE", { hook: "off" });
  if (sub === "emit") return; // no-op until the endpoint exists
  fail("Usage: kanehack hook status|enable|disable", EXIT.ACTION, "USAGE");
}

function usage() {
  console.log(`kanehack ${VERSION}: Kane CLI Hack Day helper

  kanehack pair [--token khk_…] [--api URL]   pair this machine (device code, or a token)
  kanehack pair --start                       agents/scripts: print the approve URL + code and exit
  kanehack pair --wait [--timeout SECONDS]    agents/scripts: wait for that code's approval (default 90 s)
  kanehack token                              print the saved token (for: export KANEHACK_TOKEN="$(kanehack token)")
  kanehack doctor [--report]                  check your setup; --report sends statuses + versions (no paths, no env)
  kanehack report [--evidence FILE] [--objective TEXT] [--commit SHA] [--no-upload] -- <kane-cli command>
                                              run Kane, keep its exit code + NDJSON, send a redacted summary
                                              e.g. kanehack report -- kane-cli run "Open https://kaneclihack.sh and find the schedule" --agent
  kanehack status                             your team's latest runs
  kanehack help "<what's wrong>" [--category kane_cli|auth|…] [--priority low|normal|high]
  kanehack help --status H-0042
  kanehack submit --preflight                 what's missing before you can submit
  kanehack consent yes|no|status              allow / stop / show sending run summaries
  kanehack hook status|enable|disable         optional lifecycle hook (off)
  kanehack connect codex|claude [--check]     add the event MCP server to Codex / Claude Code (no token stored)
  kanehack mcp-headers                        print the Authorization header as JSON (the agent's headers helper runs it)
  kanehack version

  Every command takes --json: one JSON document on stdout (report: one extra NDJSON line).
  Exit codes: 0 ok · 1 failed / not ready · 2 needs you (not paired, usage, consent) ·
              3 server unreachable · 4 pairing still pending · report: Kane's own exit code

Server: ${loadConfig().api}   Config: ${CONFIG}
Kane CLI syntax: the official skill, npx @testmuai/kane-cli-skill`);
}

const a = args(process.argv.slice(2));
JSON_MODE = Boolean(a.flags.json);
const cmd = a._[0];
const commands = { pair, token, doctor, report, status, help, submit, consent, hook, connect, "mcp-headers": mcpHeaders };
const run = Object.hasOwn(commands, cmd) ? commands[cmd] : null;

Promise.resolve()
  .then(() => {
    if (cmd === "version" || (!cmd && a.flags.version)) {
      if (JSON_MODE) emit({ ok: true, version: VERSION });
      else console.log(VERSION);
      return;
    }
    if (!cmd || a.flags.help) return usage();
    if (!run) {
      if (!JSON_MODE) usage();
      fail(`Unknown command: ${cmd}`, EXIT.ACTION, "USAGE");
    }
    return run(a);
  })
  .catch((e) => {
    if (e instanceof Exit) {
      process.exitCode = e.code;
      return;
    }
    say(bad(`kanehack: ${e?.message ?? e}`));
    emit({ ok: false, exit_code: 1, error: { code: "INTERNAL", message: String(e?.message ?? e) } });
    process.exitCode = 1;
  });
