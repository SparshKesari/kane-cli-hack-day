#!/usr/bin/env node
// Ask the real Codex CLI what it sees, without an OpenAI login. Used by kanehack-suite.mjs and
// the installer tests. HOME / USERPROFILE / CODEX_HOME come from the environment you pass.
//
//   node tests/installer/codex-probe.mjs skills          → {"hack": {"hack-onboard": 1, …}, "roots": […]}
//   node tests/installer/codex-probe.mjs mcp             → mcpServerStatus/list entry for kane-hack-event
//   node tests/installer/codex-probe.mjs get             → codex mcp get kane-hack-event --json
//
// - skills: `codex debug prompt-input` prints the model-visible prompt; the skills catalog in it
//   lists every discovered skill as "- name: description (file: …)".
// - mcp: `codex app-server` (JSON-RPC over stdio) → initialize → mcpServerStatus/list. That makes
//   Codex start the MCP servers from config.toml (running http_headers_helper) and list their tools.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const MCP_NAME = "kane-hack-event";

/** Every hack-* skill in Codex's prompt, with how many times it's listed, plus the skill roots. */
export function codexSkills(env = process.env, cwd = process.cwd()) {
  const r = spawnSync("codex", ["debug", "prompt-input", "hi"], { env, cwd, encoding: "utf8", timeout: 120_000, shell: WIN });
  const text = (r.stdout || "").replace(/\\n/g, "\n");
  const hack = {};
  for (const m of text.matchAll(/^- (hack-[a-z]+): /gm)) hack[m[1]] = (hack[m[1]] ?? 0) + 1;
  const roots = [...text.matchAll(/`(r\d+)` = `([^`]+)`/g)].map((m) => m[2]);
  return { code: r.status, hack, roots, stderr: (r.stderr || "").slice(0, 2000) };
}

/** codex mcp get kane-hack-event --json */
export function codexGet(env = process.env) {
  const r = spawnSync("codex", ["mcp", "get", MCP_NAME, "--json"], { env, encoding: "utf8", timeout: 60_000, shell: WIN });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { code: r.status, json, out: `${r.stdout}${r.stderr}`.slice(0, 2000) };
}

/** Start `codex app-server`, initialize, and return the mcpServerStatus/list entry for kane-hack-event. */
export function codexMcpStatus(env = process.env, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    const child = spawn("codex", ["app-server"], { env, stdio: ["pipe", "pipe", "pipe"], shell: WIN });
    let buf = "";
    let err = "";
    const waiting = new Map();
    let id = 0;
    const done = (v) => {
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {}
      child.kill();
      if (WIN && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      resolve(v);
    };
    const timer = setTimeout(() => done({ error: `timeout; stderr: ${err.slice(-1500)}` }), timeoutMs);
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => done({ error: String(e) }));
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id !== undefined && waiting.has(m.id)) {
          waiting.get(m.id)(m);
          waiting.delete(m.id);
        }
      }
    });
    const call = (method, params) =>
      new Promise((ok) => {
        const n = ++id;
        waiting.set(n, ok);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
      });
    (async () => {
      const init = await call("initialize", { clientInfo: { name: "kanehack-tests", version: "0" } });
      if (init.error) return done({ error: `initialize: ${JSON.stringify(init.error)}` });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
      const r = await call("mcpServerStatus/list", {});
      if (r.error) return done({ error: `mcpServerStatus/list: ${JSON.stringify(r.error)}` });
      const entry = (r.result?.data ?? []).find((s) => s.name === MCP_NAME) ?? null;
      done({ entry, tools: entry ? Object.keys(entry.tools ?? {}) : [], toolsError: entry?.toolsError ?? null, servers: (r.result?.data ?? []).map((s) => s.name) });
    })();
  });
}

/** Run a headers-helper command line the way Codex does: sh -c / cmd /Q /D /C "…", only PATH + home vars, stdin closed. */
export function runHelperLikeCodex(command, env = process.env) {
  const keep = WIN ? ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "HOME"] : ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"];
  const small = Object.fromEntries(Object.entries(env).filter(([k]) => keep.includes(k)));
  const r = WIN
    ? spawnSync(env.ComSpec || env.COMSPEC || "cmd.exe", ["/Q", "/D", "/C", `"${command}"`], { env: small, encoding: "utf8", windowsVerbatimArguments: true, stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 })
    : spawnSync("sh", ["-c", command], { env: small, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { code: r.status, json, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const what = process.argv[2];
  const out = what === "skills" ? codexSkills() : what === "get" ? codexGet() : what === "mcp" ? await codexMcpStatus() : null;
  if (!out) {
    console.error("usage: codex-probe.mjs skills|mcp|get");
    process.exit(2);
  }
  console.log(JSON.stringify(out));
}
