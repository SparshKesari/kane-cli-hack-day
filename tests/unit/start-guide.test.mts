// /start explains the whole participant flow for people and their agents, and /start.md serves
// the same guide as markdown, both from src/data/start-guide.ts. It names only real event tools
// and kanehack commands, in the order the day goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startGuideMarkdown } from "../../src/data/start-guide.ts";
import { startCommands } from "../../src/data/hackday.ts";

const md = startGuideMarkdown();

test("/start covers the whole flow, in order, with the day's times", () => {
  const order = [startCommands.unix, "$hack-os", "kanehack password", "kanehack register", "team_create", "team_invite_create", "team_join", "team_lock", "kanehack claim", "codex_coupon_send", "idea_save", "kanehack report", "submission_preflight"];
  let at = -1;
  for (const s of order) {
    const i = md.indexOf(s, at + 1);
    assert.ok(i > at, `${s}: missing or out of order`);
    at = i;
  }
  assert.ok(md.includes(startCommands.windows));
  for (const t of ["11:00", "12:00", "16:00", "18:00"]) assert.ok(md.includes(t), t);
  assert.ok(md.includes("https://accounts.lambdatest.com/password/reset"));
  assert.ok(md.includes("https://kaneclihack.sh/start.md"));
});

test("it names only real event tools and kanehack commands", () => {
  const mcp = readFileSync("src/server/mcp.ts", "utf8");
  const tools = new Set([...mcp.slice(mcp.indexOf("export const MCP_TOOL_NAMES")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  const named = [...md.matchAll(/`((?:team|participant|event|idea|activation|codex|submission|help|kane|readiness|deck|demo|showcase|social|milestone|public)_[a-z_]+)`/g)].map((m) => m[1]);
  assert.ok(named.length > 8);
  for (const name of named) assert.ok(tools.has(name), `unknown event tool ${name}`);
  const kh = readFileSync("packages/kanehack/bin/kanehack.mjs", "utf8");
  const cmds = new Set((kh.match(/const commands = \{([^}]*)\}/)?.[1] ?? "").split(",").map((s) => s.trim().replace(/^"([^"]+)".*$/, "$1").replace(/:.*$/, "")));
  for (const [, c] of md.matchAll(/`kanehack ([a-z-]+)/g)) assert.ok(cmds.has(c), `unknown kanehack command ${c}`);
});

test("/start.md serves the same guide as markdown, for agents", async () => {
  const { GET } = await import("../../src/app/start.md/route.ts");
  const res = GET();
  assert.match(res.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(await res.text(), md);
});

test("the homepage start block and the navbar link to /start", () => {
  assert.match(readFileSync("src/components/home/StartCommand.tsx", "utf8"), /href="\/start"/);
  assert.match(readFileSync("src/components/Navbar.tsx", "utf8"), /href: "\/start"/);
  assert.match(readFileSync("src/app/start/page.tsx", "utf8"), /startGuide/);
});
