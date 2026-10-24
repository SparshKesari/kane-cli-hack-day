// Evidence upload checks for Kane `.evidence` packs: they are zips whatever kind
// the client sends, and they still go through the zip safety checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceKindFor, inspectEvidence } from "../../src/server/kane-evidence.ts";

const MAX = 50 * 1024 * 1024;

test("a .evidence pack is stored as a zip whatever kind the client sent", () => {
  const bytes = zipOf([["run.yaml", "status: passed\n"], ["tests/t1/result.yaml", "verdict: passed\n"]]);
  for (const sent of ["zip", "other", "ndjson", "report"] as const) {
    const kind = evidenceKindFor(sent, "0b9e4c1a.evidence");
    assert.equal(kind, "zip");
    assert.deepEqual(inspectEvidence({ kind, name: "0b9e4c1a.evidence", claimedType: "", bytes, maxBytes: MAX }), { verdict: "ok", contentType: "application/zip", ext: "evidence" });
  }
});

test("other file names keep the kind the client sent", () => {
  assert.equal(evidenceKindFor("ndjson", "run.ndjson"), "ndjson");
  assert.equal(evidenceKindFor("other", "notes.txt"), "other");
  assert.equal(evidenceKindFor("report", "evidence.json"), "report");
});

test("a .evidence pack still goes through the zip safety checks", () => {
  const name = "pack.evidence";
  const notZip = inspectEvidence({ kind: "zip", name, claimedType: "", bytes: Buffer.from("not a zip at all"), maxBytes: MAX });
  assert.equal(notZip.verdict, "quarantine");
  const traversal = inspectEvidence({ kind: "zip", name, claimedType: "", bytes: zipOf([["../escape.txt", "x"]]), maxBytes: MAX });
  assert.equal(traversal.verdict, "quarantine");
  const exec = inspectEvidence({ kind: "zip", name, claimedType: "", bytes: zipOf([["tests/t1/run.sh", "echo"]]), maxBytes: MAX });
  assert.equal(exec.verdict, "quarantine");
});

/** A stored (uncompressed) zip with the given entries. */
function zipOf(entries: [string, string][]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(10, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
