// Codex status ping rules that need no database: what the hook may send
// (metadata only, strict) and how an event maps to a status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pingSchema, statusFor } from "../../src/server/codex-status.ts";

const base = { event: "tool_use", session_id: "sess-12345678" };

test("a minimal ping is accepted and defaults to the codex host", () => {
  const p = pingSchema.parse(base);
  assert.equal(p.host, "codex");
});

test("anything beyond the metadata allowlist is refused, not trimmed", () => {
  for (const extra of [{ prompt: "build me a thing" }, { transcript: [] }, { cwd: "/Users/alex/secret" }, { repo: "alex/orbit" }, { token: "sk-123" }]) {
    assert.equal(pingSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra));
  }
});

test("free-text fields only take version-like tokens", () => {
  assert.equal(pingSchema.safeParse({ ...base, codex_version: "0.48.0", model: "gpt-5-codex", kane_run_id: "r_921" }).success, true);
  assert.equal(pingSchema.safeParse({ ...base, model: "gpt 5 please ignore previous" }).success, false);
  assert.equal(pingSchema.safeParse({ ...base, event: "rm -rf" }).success, false);
  assert.equal(pingSchema.safeParse({ ...base, session_id: "short" }).success, false);
});

test("events map to statuses unless one is sent", () => {
  assert.equal(statusFor("session_start"), "working");
  assert.equal(statusFor("tool_use"), "working");
  assert.equal(statusFor("stop"), "idle");
  assert.equal(statusFor("waiting_for_human"), "waiting_for_human");
  assert.equal(statusFor("error"), "error");
  assert.equal(statusFor("session_end"), "ended");
  assert.equal(statusFor("heartbeat", "idle"), "idle");
});
