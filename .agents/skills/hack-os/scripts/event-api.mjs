#!/usr/bin/env node
// Call the event MCP server directly when Codex hasn't loaded the kane-hack-event tools yet
// (they appear only in a new session after `kanehack connect codex`). Never prints credentials.
//
//   node event-api.mjs list
//   node event-api.mjs call <tool> --args <file.json> [--confirmed]
//
// /mcp needs the token from `kanehack signin` / `kanehack register` (or `kanehack pair`) (src/app/mcp/route.ts). The TestMu AI key
// (TESTMU_USERNAME/TESTMU_ACCESS_KEY, then Kane CLI's LT_USERNAME/LT_ACCESS_KEY, then the one
// `kanehack login` saved) rides along for the site's key gate, the way kanehack 0.1.4 sends it. Writes need --confirmed, given only after the person
// approved those exact arguments. No automatic retry of writes.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Fallback when tools/list carries no readOnlyHint: the tools src/server/mcp.ts declares readOnly.
const READ_ONLY = new Set(["event_get_brief", "participant_get_status", "team_find", "harness_get_capabilities", "help_get_status", "submission_preflight", "deck_get", "showcase_preview", "activation_get_checkpoint", "help_diagnose", "public_evidence_list", "team_page_get"]);

const a = process.argv.slice(2);
const [mode, name] = a;
const secrets = [];
const scrub = (x) => {
  if (typeof x === "string" && /^[{[]/.test(x.trim())) {
    try {
      return JSON.stringify(scrub(JSON.parse(x)));
    } catch {}
  }
  if (typeof x === "string") {
    let s = x;
    for (const v of secrets) s = s.replaceAll(v, "[redacted]");
    return s.replace(/khk_[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [redacted]");
  }
  if (Array.isArray(x)) return x.map(scrub);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, /token|secret|password|authorization|access_key|device_code|credit_code/i.test(k) ? "[redacted]" : scrub(v)]));
  return x;
};
const fail = (msg) => {
  process.stderr.write(JSON.stringify({ error: scrub(msg), no_automatic_write_retry: true }) + "\n");
  process.exit(2);
};

try {
  if (!["list", "call"].includes(mode)) fail("Use: list | call TOOL --args FILE.json [--confirmed]");
  let c = {};
  try {
    c = JSON.parse(readFileSync(join(homedir(), ".kanehack/config.json"), "utf8"));
  } catch {}
  const base = new URL(process.env.KANEHACK_API || c.api || "https://www.kaneclihack.sh");
  const local = (u) => process.env.KANEHACK_OS_ALLOW_LOCAL === "1" && u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname);
  const trusted = (u) => local(u) || (u.protocol === "https:" && ["kaneclihack.sh", "www.kaneclihack.sh"].includes(u.hostname) && !u.port && !u.username && !u.password);
  if (!trusted(base)) fail("Untrusted API origin; only https://www.kaneclihack.sh is used");

  const pick = (u, k) => (u && k ? { username: String(u).trim(), access_key: String(k).trim() } : null);
  const testmu =
    pick(process.env.TESTMU_USERNAME, process.env.TESTMU_ACCESS_KEY) ||
    pick(process.env.LT_USERNAME, process.env.LT_ACCESS_KEY) ||
    pick(c.testmu?.username, c.testmu?.access_key);
  const token = process.env.KANEHACK_TOKEN || c.token || "";
  if (!token) fail("NOT_SIGNED_IN: run `kanehack signin --email <their email> --json` (new here: `kanehack register`), after the person saved their password with `kanehack password` in their own terminal. Fallback: `kanehack pair --start --json` and they approve in the browser. If the site also asks for the TestMu AI key, the person runs `kanehack login` in their own terminal.");
  if (token) secrets.push(token);
  if (testmu) secrets.push(testmu.access_key);
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(testmu ? { "X-TestMu-Username": testmu.username, "X-TestMu-Access-Key": testmu.access_key } : {}),
  };

  const down = "Try again in a minute; https://kaneclihack.sh shows whether the site is up. Carry on with local work and show server state as unknown.";
  const rpc = async (method, params, write = false) => {
    let url = new URL("/mcp", base);
    for (let i = 0; i < 4; i++) {
      let res;
      try {
        res = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20000), headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      } catch {
        fail(write ? "UNREACHABLE: the write's outcome is uncertain; read back before trying again. " + down : "UNREACHABLE: can't reach the event server (check Wi-Fi). " + down);
      }
      if (res.status >= 300 && res.status < 400) {
        const next = new URL(res.headers.get("location") ?? "", url);
        if (!trusted(next) || next.pathname !== "/mcp") fail("Redirect refused");
        url = next;
        continue;
      }
      if (res.status === 401) fail("UNAUTHENTICATED: sign in again with `kanehack signin --email <their email> --json` (fallback: `kanehack pair --start --json`). If the site wants the TestMu AI key, the person runs `kanehack login` in their own terminal; TESTMU_* or LT_* environment variables, when set, are sent instead and must be their event key.");
      if (res.status === 403) fail("FORBIDDEN: check the person's role and team");
      if (res.status === 429) fail("RATE_LIMITED: retry after " + (res.headers.get("retry-after") || "a minute"));
      if (!res.ok) fail(write ? `HTTP ${res.status}: outcome uncertain for this write; read back before trying again` : `SERVER_UNAVAILABLE: the event server isn't answering (HTTP ${res.status}). ${down}`);
      const body = await res.json();
      if (body.error) fail("MCP error: " + JSON.stringify(scrub(body.error)));
      if (!body.result) fail("Missing JSON MCP result; use the native MCP tools in a new Codex session");
      return body.result;
    }
    fail("Too many redirects");
  };

  const listed = await rpc("tools/list", {});
  const tools = listed.tools ?? [];
  for (let cursor = listed.nextCursor, n = 0; cursor && n < 10; n++) {
    const page = await rpc("tools/list", { cursor });
    tools.push(...(page.tools ?? []));
    cursor = page.nextCursor;
  }
  if (mode === "list") {
    console.log(JSON.stringify(scrub({ tools }), null, 2));
  } else {
    const tool = tools.find((t) => t.name === name);
    if (!tool) fail("TOOL_UNAVAILABLE: use the website instead; do not invent a call");
    const readOnly = typeof tool.annotations?.readOnlyHint === "boolean" ? tool.annotations.readOnlyHint : READ_ONLY.has(name);
    if (!readOnly && !a.includes("--confirmed")) fail("Mutation needs the person's approval of these exact arguments, then --confirmed");
    const pos = a.indexOf("--args");
    if (pos < 0 || !a[pos + 1]) fail("Provide --args FILE.json (use {} for no arguments)");
    const args = JSON.parse(readFileSync(a[pos + 1], "utf8"));
    if (!args || Array.isArray(args) || typeof args !== "object") fail("Arguments must be a JSON object matching the tool's schema");
    const result = await rpc("tools/call", { name, arguments: args }, !readOnly);
    console.log(JSON.stringify(scrub(result), null, 2));
    if (result.isError) process.exitCode = 1;
    for (const part of result.content ?? [])
      if (part.type === "text")
        try {
          if (JSON.parse(part.text).status === "error") process.exitCode = 1;
        } catch {}
  }
} catch (e) {
  fail(e?.message ?? String(e));
}
