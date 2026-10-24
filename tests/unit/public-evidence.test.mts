// Public evidence rules that need no database or bucket: what may be published, keys, checksums and the byte checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MAX_BINARY_BYTES,
  MAX_TEXT_BYTES,
  TEXT_CONTENT_TYPE,
  checkPublicFile,
  checksumBase64,
  dispositionName,
  incomingKey,
  inspectPublicBytes,
  publicKey,
} from "../../src/server/public-evidence-rules.ts";
import { requestUploadSchema } from "../../src/server/public-evidence-upload.ts";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32, 3)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32, 4)]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const file = (kind: string, filename: string, contentType: string, sizeBytes = 100) => checkPublicFile({ kind: kind as never, filename, contentType, sizeBytes });
const bytes = (kind: string, filename: string, b: Buffer | string) => inspectPublicBytes({ kind: kind as never, filename, bytes: Buffer.isBuffer(b) ? b : Buffer.from(b) });

test("each kind accepts its extensions and types, and text kinds are served as plain UTF-8", () => {
  const ok: [string, string, string, string][] = [
    ["screenshot", "home.png", "image/png", "image/png"],
    ["screenshot", "home.jpg", "image/jpeg", "image/jpeg"],
    ["screenshot", "home.webp", "image/webp", "image/webp"],
    ["video", "demo.mp4", "video/mp4", "video/mp4"],
    ["video", "demo.webm", "video/webm", "video/webm"],
    ["ndjson", "run.ndjson", "application/x-ndjson", TEXT_CONTENT_TYPE],
    ["ndjson", "run.jsonl", "text/plain; charset=utf-8", TEXT_CONTENT_TYPE],
    ["report", "summary.json", "application/json", TEXT_CONTENT_TYPE],
    ["report", "summary.md", "text/markdown", TEXT_CONTENT_TYPE],
    ["report", "summary.txt", "text/plain", TEXT_CONTENT_TYPE],
    ["testmd", "login_test.md", "text/markdown", TEXT_CONTENT_TYPE],
    ["log", "kane.log", "text/plain", TEXT_CONTENT_TYPE],
  ];
  for (const [kind, name, type, served] of ok) {
    const r = file(kind, name, type);
    assert.equal(r.ok, true, `${kind} ${name}`);
    if (r.ok) assert.equal(r.servedContentType, served, `${kind} ${name}`);
  }
});

test("packs, HAR, HTML, SVG, PDF and zips are refused for every kind", () => {
  for (const name of ["run.evidence", "network.har", "page.html", "page.htm", "logo.svg", "report.pdf", "pack.zip"]) {
    for (const kind of ["report", "log", "screenshot", "ndjson"]) {
      const r = file(kind, name, "text/plain");
      assert.equal(r.ok, false, `${kind} ${name}`);
      if (!r.ok) assert.match(r.reason, /never published/);
    }
  }
});

test("a wrong extension, declared type, size or a path in the name is refused", () => {
  assert.equal(file("screenshot", "home.gif", "image/gif").ok, false);
  assert.equal(file("ndjson", "run.json", "application/json").ok, false);
  assert.equal(file("screenshot", "home.png", "image/jpeg").ok, false);
  assert.equal(file("report", "summary.md", "application/octet-stream").ok, false);
  assert.equal(file("log", "../etc/kane.log", "text/plain").ok, false);
  assert.equal(file("log", "kane.log", "text/plain", MAX_TEXT_BYTES).ok, true);
  assert.equal(file("log", "kane.log", "text/plain", MAX_TEXT_BYTES + 1).ok, false);
  assert.equal(file("video", "demo.mp4", "video/mp4", MAX_BINARY_BYTES).ok, true);
  assert.equal(file("video", "demo.mp4", "video/mp4", MAX_BINARY_BYTES + 1).ok, false);
});

test("object keys, the S3 checksum header and the download name", () => {
  const h = sha(PNG);
  assert.equal(incomingKey(12, h, "png"), `incoming/p12/${h}.png`);
  assert.equal(publicKey(12, h, "png"), `public/p12/${h}.png`);
  assert.equal(checksumBase64(h), createHash("sha256").update(PNG).digest("base64"));
  assert.equal(dispositionName('my "shot" 1.png'), "my__shot__1.png");
});

test("binary bytes must match their exact extension", () => {
  assert.equal(bytes("screenshot", "a.png", PNG).ok, true);
  assert.equal(bytes("screenshot", "a.jpg", JPEG).ok, true);
  assert.equal(bytes("screenshot", "a.jpg", PNG).ok, false);
  assert.equal(bytes("video", "a.webm", WEBM).ok, true);
  assert.equal(bytes("video", "a.mp4", MP4).ok, true);
  assert.equal(bytes("video", "a.mp4", WEBM).ok, false);
  assert.equal(bytes("screenshot", "a.png", Buffer.from("MZ not an image")).ok, false);
});

test("text must be clean UTF-8 and not a script", () => {
  assert.equal(bytes("log", "kane.log", "step 1 passed\nstep 2 passed\n").ok, true);
  assert.equal(bytes("log", "kane.log", Buffer.from([0x61, 0x00, 0x62])).ok, false);
  assert.equal(bytes("report", "summary.txt", "#!/bin/sh\nrm -rf /\n").ok, false);
});

test("a credential in NDJSON, a log or a JSON report is rejected with where it is", () => {
  const ndjson = ['{"type":"run_start","objective":"login"}', '{"type":"step","password":"hunter2"}', '{"type":"run_end","status":"passed"}'].join("\n");
  const r1 = bytes("ndjson", "run.ndjson", ndjson);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.deepEqual(r1.fields, ["line 2: password"]);
  const r2 = bytes("log", "kane.log", `ok\nusing ghp_${"a".repeat(36)} for checkout\n`);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.deepEqual(r2.fields, ["line 2"]);
  const r3 = bytes("report", "summary.json", JSON.stringify({ run: { config: { api_key: "abc123" } } }, null, 2));
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.ok(r3.fields?.includes("run.config.api_key"));
  assert.equal(bytes("testmd", "login_test.md", `# Login\nAuthorization: Bearer ${"x".repeat(24)}\n`).ok, false);
});

test("redacted values and token counts pass the credential scan", () => {
  const ndjson = ['{"type":"step","api_key":"[REDACTED]","authorization":"[REDACTED]"}', '{"type":"run_end","tokens_used":42,"cookie":"***"}'].join("\n");
  assert.equal(bytes("ndjson", "run.ndjson", ndjson).ok, true);
  assert.equal(bytes("report", "summary.md", "# Result\nThe login step passed with the test password field filled.\n").ok, true);
});

test("a HAR saved as a .json report is refused", () => {
  const r = bytes("report", "summary.json", JSON.stringify({ log: { version: "1.2", entries: [] } }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /HAR/);
});

test("the request schema needs approval, one run reference and a full sha256", () => {
  const base = { kind: "screenshot", filename: "a.png", content_type: "image/png", size_bytes: 10, sha256: "A".repeat(64), participant_approved: true, idempotency_key: "key-12345678" };
  const p = requestUploadSchema.parse({ ...base, run_id: "KR-7" });
  assert.equal(p.run_id, 7);
  assert.equal(p.sha256, "a".repeat(64));
  assert.equal(requestUploadSchema.safeParse({ ...base, participant_approved: false }).success, false);
  assert.equal(requestUploadSchema.safeParse({ ...base, participant_approved: undefined }).success, false);
  assert.equal(requestUploadSchema.safeParse({ ...base, run_id: 7, kane_execution_id: "exec-1" }).success, false);
  assert.equal(requestUploadSchema.safeParse({ ...base, sha256: "abc" }).success, false);
  assert.equal(requestUploadSchema.safeParse({ ...base, idempotency_key: undefined }).success, false);
  assert.equal(requestUploadSchema.safeParse({ ...base, kind: "zip" }).success, false);
});
