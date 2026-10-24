// hack-os/scripts/event-api.mjs: the skill's fallback to the event MCP server when Codex
// hasn't loaded the native tools yet. Credentials stay private; writes need --confirmed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../plugin/skills/hack-os/scripts/event-api.mjs", import.meta.url));
const MCP_TS = fileURLToPath(new URL("../../src/server/mcp.ts", import.meta.url));

type Seen = { headers: IncomingHttpHeaders[]; calls: string[] };
function server(status = 200): Promise<{ s: Server; url: string; seen: Seen }> {
  const seen: Seen = { headers: [], calls: [] };
  const s = createServer((req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      seen.headers.push(req.headers);
      if (status !== 200) { res.statusCode = status; return res.end("{}"); }
      const rpc = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      if (rpc.method === "tools/list")
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [
          { name: "participant_get_status", annotations: { readOnlyHint: true } },
          { name: "help_create", annotations: { readOnlyHint: false } },
        ] } }));
      seen.calls.push(rpc.params.name);
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ status: "ok", echo: "khk_secret_123" }) }] } }));
    });
  });
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok({ s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, seen })));
}

function home(config: object) {
  const h = mkdtempSync(join(tmpdir(), "hackos-api-"));
  mkdirSync(join(h, ".kanehack"));
  writeFileSync(join(h, ".kanehack/config.json"), JSON.stringify(config));
  writeFileSync(join(h, "args.json"), "{}");
  return h;
}

function run(h: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TESTMU_|LT_|KANEHACK_)/.test(k))) as NodeJS.ProcessEnv;
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...clean, HOME: h, USERPROFILE: h, KANEHACK_OS_ALLOW_LOCAL: "1", ...env } });
    let out = "", err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => done({ code, out, err }));
  });
}

test("fallback read-only list matches the tools mcp.ts declares readOnly", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const ro = src.split(/\btool\(\s*/).slice(1).flatMap((c) => {
    const name = c.match(/^"([a-z_]+)"/)?.[1];
    return name && /readOnly:\s*true/.test(c.split(/async\s*\(/)[0]) ? [name] : [];
  });
  const script = readFileSync(SCRIPT, "utf8");
  const list = script.match(/const READ_ONLY = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  assert.deepEqual([...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(), ro.sort());
});

test("list works with a paired config and no MCP, and never prints the token", async () => {
  const { s, url } = await server();
  try {
    const r = await run(home({ token: "khk_secret_123", api: url }), ["list"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /participant_get_status/);
    assert.doesNotMatch(r.out + r.err, /khk_secret_123/);
  } finally { s.close(); }
});

test("a read-only call needs no --confirmed and its output is scrubbed", async () => {
  const { s, url, seen } = await server();
  try {
    const h = home({ token: "khk_secret_123", api: url });
    const r = await run(h, ["call", "participant_get_status", "--args", join(h, "args.json")]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(seen.calls, ["participant_get_status"]);
    assert.doesNotMatch(r.out, /khk_secret_123/);
  } finally { s.close(); }
});

test("a write without --confirmed is refused before it is sent", async () => {
  const { s, url, seen } = await server();
  try {
    const h = home({ token: "khk_x", api: url });
    const r = await run(h, ["call", "help_create", "--args", join(h, "args.json")]);
    assert.equal(r.code, 2);
    assert.match(r.err, /Mutation needs/);
    assert.deepEqual(seen.calls, []);
    const ok = await run(h, ["call", "help_create", "--args", join(h, "args.json"), "--confirmed"]);
    assert.equal(ok.code, 0, ok.err);
    assert.deepEqual(seen.calls, ["help_create"]);
  } finally { s.close(); }
});

test("sends the TestMu key saved by kanehack login, with no pairing token, and never prints it", async () => {
  const { s, url, seen } = await server();
  try {
    const r = await run(home({ api: url, testmu: { username: "ana", access_key: "LTkey_abc999" } }), ["list"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(seen.headers[0]["x-testmu-username"], "ana");
    assert.equal(seen.headers[0]["x-testmu-access-key"], "LTkey_abc999");
    assert.equal(seen.headers[0].authorization, undefined);
    assert.doesNotMatch(r.out + r.err, /LTkey_abc999/);
  } finally { s.close(); }
});

test("TestMu env wins over the saved key: TESTMU_* first, then Kane CLI's LT_*", async () => {
  const { s, url, seen } = await server();
  try {
    const h = home({ api: url, testmu: { username: "saved", access_key: "k_saved" } });
    await run(h, ["list"], { LT_USERNAME: "lt", LT_ACCESS_KEY: "k_lt" });
    await run(h, ["list"], { LT_USERNAME: "lt", LT_ACCESS_KEY: "k_lt", TESTMU_USERNAME: "tm", TESTMU_ACCESS_KEY: "k_tm" });
    assert.equal(seen.headers[0]["x-testmu-username"], "lt");
    assert.equal(seen.headers[1]["x-testmu-username"], "tm");
  } finally { s.close(); }
});

test("not signed in at all says how to sign in", async () => {
  const r = await run(home({}), ["list"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /kanehack login/);
});

test("maps 401 and 5xx to plain errors", async () => {
  for (const [status, re] of [[401, /UNAUTHENTICATED/], [503, /outcome uncertain/]] as const) {
    const { s, url } = await server(status);
    try {
      const r = await run(home({ token: "khk_x", api: url }), ["list"]);
      assert.equal(r.code, 2);
      assert.match(r.err, re);
    } finally { s.close(); }
  }
});

test("refuses a non-official origin", async () => {
  const r = await run(home({ token: "khk_x", api: "https://evil.example" }), ["list"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /Untrusted/);
});
