#!/usr/bin/env node
// A small stand-in for the Kane Hack OS server, for installer/CLI tests on CI legs
// that don't run the real app (no Postgres, no Next build). It serves public/ and
// implements only what install.sh, install.ps1 and kanehack call, with the real
// response envelope (src/server/core.ts toEnvelope) and the real status codes:
//
//   GET  /install.sh, /install.ps1, /*.tgz          files from --public (default ./public)
//   GET  /api/v1/kane/runs                          401 without a valid bearer; 403 for a member with no team
//   POST /api/v1/kane/runs                          records a run; source_verified = paired + completion event + exit code
//   POST /api/v1/pair/start, /api/v1/pair/confirm   the device flow (user_code / device_code, 410 PAIR_EXPIRED)
//   POST /mcp                                       initialize, tools/list, notifications (202), and tools/call:
//                                                   readiness_report, help_create, help_get_status, submission_preflight
//
// Test-only controls (not in the real app):
//   POST /__mock/approve {user_code, team?}   approve a pairing as the demo member (team:false → member with no team)
//   POST /__mock/deny {user_code}             deny it
//   POST /__mock/revoke                       revoke every bearer token
//   GET  /__mock/runs                         every run recorded
//   GET  /__mock/mcp                          how many authenticated MCP requests arrived, and their methods
//
//   node tests/installer/mock-server.mjs [--port 3399] [--public DIR] [--redirect-to http://www.localhost:3399]
//
// With --redirect-to it only answers 308 → <target><path>, like kaneclihack.sh → www.
// Prints "mock-server listening on <port>" once it is ready.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve, extname } from "node:path";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const port = Number(arg("port", 3399));
const pub = resolve(arg("public", "public"));
const redirectTo = arg("redirect-to", null);
const site = `http://localhost:${port}`;

const pairings = new Map(); // device_code → { user_code, status, expires, team }
const tokens = new Map(); // token → { revoked, team }
const runs = [];
const tickets = new Map();
const mcpAuthed = { count: 0, methods: [] }; // POST /mcp requests with a valid bearer (GET /__mock/mcp)
const MCP_TOOLS = ["readiness_report", "help_create", "help_get_status", "submission_preflight"];

const env = (o) => ({
  schema_version: 1,
  status: o.status ?? (o.error ? "error" : "ok"),
  message: o.message,
  data: o.data ?? null,
  evidence: [],
  actions: [],
  links: [], // the real server drops non-https links; local SITE_URL is http, so these stay empty too
  ui_resource: null,
  ui_type: null,
  design_version: "kane-hack-os@1",
  fallback: { text: o.fallbackText ?? o.message },
  freshness: null,
  warnings: o.warnings ?? [],
  error: o.error ?? null,
  request_id: randomUUID(),
  server_time: new Date().toISOString(),
});
const ERR = {
  UNAUTHENTICATED: [401, "Please sign in first.", "Sign in and try again."],
  PAIR_EXPIRED: [410, "That pairing code has expired or was already used.", "Start pairing again to get a fresh code."],
  FORBIDDEN: [403, "Join or create a team first; Kane runs belong to a team project.", "Ask an organizer if you think this is wrong."],
  VALIDATION_FAILED: [400, "Some fields need another look.", "Fix the highlighted fields and try again."],
  NOT_FOUND: [404, "We couldn't find that.", "Check the link."],
};
const errEnv = (code, msg) => {
  const [status, userMessage, nextAction] = ERR[code];
  return [status, env({ message: msg ?? userMessage, error: { code, message: msg ?? userMessage, next_action: nextAction }, fallbackText: `${msg ?? userMessage} ${nextAction}` })];
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok) => {
    const b = [];
    req.on("data", (c) => b.push(c)).on("end", () => ok(Buffer.concat(b).toString("utf8")));
  });
const parseJson = (s) => {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
};
const bearer = (req) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const t = m && tokens.get(m[1]);
  return t && !t.revoked ? t : null;
};
const code8 = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const s = Array.from(randomBytes(8), (b) => a[b % a.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

const TYPES = { ".sh": "text/plain; charset=utf-8", ".ps1": "text/plain; charset=utf-8", ".tgz": "application/gzip" };

async function handle(req, res) {
  const url = new URL(req.url, site);
  const p = url.pathname;
  if (redirectTo) return send(res, 308, {}, { location: `${redirectTo}${p}${url.search}` });

  // ── static ──
  if (req.method === "GET" && /^\/(install\.(sh|ps1)|[\w.-]+\.tgz)$/.test(p)) {
    const f = join(pub, p.slice(1));
    if (!existsSync(f)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream", "content-length": statSync(f).size });
    return createReadStream(f).pipe(res);
  }

  const body = req.method === "POST" ? await readBody(req) : "";

  // ── test controls ──
  if (p === "/__mock/approve" || p === "/__mock/deny") {
    const { user_code, team = true } = parseJson(body);
    const pr = [...pairings.values()].find((x) => x.user_code === user_code);
    if (!pr || pr.status !== "pending") return send(res, 404, { ok: false });
    pr.status = p.endsWith("approve") ? "approved" : "denied";
    pr.team = team;
    return send(res, 200, { ok: true });
  }
  if (p === "/__mock/revoke") {
    for (const t of tokens.values()) t.revoked = true;
    return send(res, 200, { ok: true });
  }
  if (p === "/__mock/runs") return send(res, 200, runs);
  if (p === "/__mock/mcp") return send(res, 200, { authed_requests: mcpAuthed.count, methods: mcpAuthed.methods });

  // ── pairing ──
  if (p === "/api/v1/pair/start" && req.method === "POST") {
    const user_code = code8();
    const device_code = `khp_${randomBytes(24).toString("base64url")}`;
    const expires = Date.now() + 10 * 60_000;
    pairings.set(device_code, { user_code, status: "pending", expires });
    const verification_url = `${site}/pair?code=${user_code}`;
    return send(res, 200, env({ status: "needs_action", message: `Open ${verification_url} and approve code ${user_code}.`, data: { user_code, device_code, verification_url, expires_at: new Date(expires).toISOString(), interval: 2 } }));
  }
  if (p === "/api/v1/pair/confirm" && req.method === "POST") {
    const { device_code } = parseJson(body);
    if (typeof device_code !== "string" || device_code.length < 10) return send(res, ...errEnv("VALIDATION_FAILED"));
    const pr = pairings.get(device_code);
    if (!pr || pr.expires < Date.now() || (pr.status !== "pending" && pr.status !== "approved")) {
      if (pr) pr.status = "expired";
      return send(res, ...errEnv("PAIR_EXPIRED"));
    }
    if (pr.status === "pending") return send(res, 200, env({ status: "needs_action", message: "Waiting for approval in the browser.", data: { status: "pending", interval: 2, expires_at: new Date(pr.expires).toISOString() } }));
    pr.status = "exchanged";
    const token = `khk_${randomBytes(24).toString("base64url")}`;
    tokens.set(token, { revoked: false, team: pr.team !== false });
    return send(res, 200, env({ message: "Paired as Ana (P-1057).", data: { status: "approved", token, token_id: tokens.size, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), member: { public_code: "P-1057", name: "Ana" } }, warnings: ["Store this token securely. It is shown once; revoke it from /pair if it leaks."] }));
  }

  // ── Kane runs ──
  if (p === "/api/v1/kane/runs") {
    if (req.headers.authorization && !bearer(req)) return send(res, ...errEnv("UNAUTHENTICATED", "Missing or invalid token. Pair this machine again with `kanehack pair`."));
    const t = bearer(req);
    if (!t) return send(res, ...errEnv("UNAUTHENTICATED"));
    if (!t.team) return send(res, ...errEnv("FORBIDDEN"));
    if (req.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
      const list = runs.slice(-limit).reverse();
      return send(res, 200, env({ message: `${list.length} run(s) for Demo Project.`, data: { project_id: 1, team_slug: "demo-orbit", runs: list }, fallbackText: list.length ? list.map((r) => `KR-${r.id} ${r.status}`).join("; ") : "No Kane runs reported yet." }));
    }
    const input = parseJson(body);
    if (typeof input.source_execution_id !== "string" || typeof input.ndjson !== "string") return send(res, ...errEnv("VALIDATION_FAILED"));
    const dup = runs.find((r) => r.upstream_execution_id === input.source_execution_id);
    const terminal = /"type":"(run_end|test_md_done|testrun_done)"/.test(input.ndjson);
    const status = !terminal ? "errored" : input.exit_code === 0 ? "passed" : input.exit_code === 1 ? "failed" : input.exit_code === 3 ? "cancelled" : "blocked";
    const run = dup ?? { id: runs.length + 1, upstream_execution_id: input.source_execution_id, status, exit_code: input.exit_code, source_verified: terminal && Number.isInteger(input.exit_code), verification_state: terminal ? "verified" : "reported", objective: input.objective ?? null, commit_sha: input.commit_sha ?? null, ndjson_lines: input.ndjson.split("\n").filter(Boolean).length };
    if (!dup) runs.push(run);
    const receipt = { id: `KR-${run.id}`, run_id: run.id, status: run.status, verification_state: run.verification_state, source_verified: run.source_verified, has_terminal_event: terminal, defects_opened: 0, defects_reverified: 0, warnings: [], url: `${site}/t/demo-orbit/proof#run-${run.id}`, replayed: Boolean(dup) };
    return send(res, 200, env({ status: run.status === "passed" && run.source_verified ? "ok" : "needs_action", message: `Recorded run ${run.id}: ${run.status}.`, data: receipt, fallbackText: `Kane run KR-${run.id}: ${run.status.toUpperCase()} (${run.source_verified ? "VERIFIED source" : "UNVERIFIED"}). Details: ${receipt.url}` }));
  }

  // ── MCP ──
  if (p === "/mcp" && req.method === "POST") {
    const t = bearer(req);
    if (!t) return send(res, 401, env({ status: "error", message: "Missing or invalid token." }), { "www-authenticate": 'Bearer realm="kaneclihack", error="invalid_token"' });
    const rpc = parseJson(body);
    mcpAuthed.count++;
    mcpAuthed.methods.push(rpc.method ?? null);
    // Enough of the MCP handshake for the real Codex to connect and list tools.
    if (rpc.id === undefined || rpc.id === null) return send(res, 202, {});
    if (rpc.method === "initialize") return send(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: rpc.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kane-hack-event-mock", version: "1" } } });
    if (rpc.method === "tools/list") return send(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { tools: MCP_TOOLS.map((t) => ({ name: t, description: t, inputSchema: { type: "object", properties: {} } })) } });
    const empty = { "resources/list": { resources: [] }, "resources/templates/list": { resourceTemplates: [] }, "prompts/list": { prompts: [] }, ping: {} }[rpc.method];
    if (empty) return send(res, 200, { jsonrpc: "2.0", id: rpc.id, result: empty });
    if (rpc.method && rpc.method !== "tools/call") return send(res, 200, { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
    const name = rpc.params?.name;
    const a = rpc.params?.arguments ?? {};
    let e;
    if (name === "readiness_report") {
      const failing = (a.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
      e = env({ status: failing.length ? "partial" : "ok", message: `Readiness recorded: ${failing.length} check(s) need a fix.`, data: { receipt: "RD-1", failing } });
    } else if (name === "help_create") {
      const id = `H-${String(tickets.size + 1).padStart(4, "0")}`;
      tickets.set(id, a);
      e = env({ message: `Ticket ${id} opened.`, data: { id, ticket_id: tickets.size, status: "open", url: `/help/${id}`, replayed: false }, fallbackText: `Ticket ${id} is open. A mentor will reply on /help.` });
    } else if (name === "help_get_status") {
      e = tickets.has(a.ticket_id) ? env({ message: `Ticket ${a.ticket_id}: open.`, data: { ticket_id: a.ticket_id, status: "open" } }) : errEnv("NOT_FOUND", "No ticket with that id on your team.")[1];
    } else if (name === "submission_preflight") {
      e = env({ status: "needs_action", message: "2 things are missing before you can submit.", data: { ready: false, missing: ["repo_url", "demo_video"] } });
    } else return send(res, 200, { jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32602, message: `Unknown tool: ${name}` } });
    return send(res, 200, { jsonrpc: "2.0", id: rpc.id ?? 1, result: { content: [{ type: "text", text: JSON.stringify(e) }], isError: e.status === "error" } });
  }

  return send(res, ...errEnv("NOT_FOUND"));
}

createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { error: String(e) }))).listen(port, () => console.log(`mock-server listening on ${port}`));
