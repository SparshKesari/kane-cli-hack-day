import { createHash } from "node:crypto";
import { extOf, inspectEvidence, magicMatches } from "./kane-evidence";
import { findCredentialLike } from "./kane-ndjson";
import type { PublicEvidenceKind } from "./public-evidence";

// Pure rules for what may be published as public evidence (docs/api/PUBLIC_EVIDENCE.md).

export const MAX_BINARY_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_TEAM_OBJECTS = 200;
export const MAX_TEAM_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_URL_TTL_SEC = 600;
export const INCOMING_PREFIX = "incoming/";
export const PUBLIC_PREFIX = "public/";
export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
export const PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const REFUSED_EXTS = ["zip", "evidence", "har", "html", "htm", "xhtml", "svg", "svgz", "pdf"];

const MAX_HITS = 10;
const MARKDOWN_TYPES = ["text/markdown", "text/x-markdown", "text/plain"];
const NDJSON_TYPES = ["application/x-ndjson", "application/ndjson", "application/jsonl", "application/json", "text/plain"];
const TEXT_KINDS: PublicEvidenceKind[] = ["ndjson", "report", "testmd", "log"];
const REDACTED = /\[redacted\]|<redacted>|^\s*\*{3,}\s*$/i;

/** Per kind: each allowed extension and the content types a client may declare for it (the first is the canonical one). */
const RULES: Record<PublicEvidenceKind, Record<string, string[]>> = {
  screenshot: { png: ["image/png"], jpg: ["image/jpeg", "image/jpg"], webp: ["image/webp"] },
  video: { mp4: ["video/mp4"], webm: ["video/webm"] },
  ndjson: { ndjson: NDJSON_TYPES, jsonl: NDJSON_TYPES },
  report: { json: ["application/json", "text/plain"], md: MARKDOWN_TYPES, txt: ["text/plain"] },
  testmd: { md: MARKDOWN_TYPES },
  log: { log: ["text/plain"], txt: ["text/plain"] },
};

export const isTextKind = (kind: PublicEvidenceKind) => TEXT_KINDS.includes(kind);
export const maxBytesFor = (kind: PublicEvidenceKind) => (isTextKind(kind) ? MAX_TEXT_BYTES : MAX_BINARY_BYTES);

/** The type an object is served with: text kinds are always plain UTF-8 text, never rendered. */
export const servedContentType = (kind: PublicEvidenceKind, ext: string) => (isTextKind(kind) ? TEXT_CONTENT_TYPE : RULES[kind][ext][0]);

export const incomingKey = (projectId: number, sha256: string, ext: string) => `${INCOMING_PREFIX}p${projectId}/${sha256}.${ext}`;
export const publicKey = (projectId: number, sha256: string, ext: string) => `${PUBLIC_PREFIX}p${projectId}/${sha256}.${ext}`;

/** The x-amz-checksum-sha256 header value: base64 of the raw digest, from its hex form. */
export const checksumBase64 = (sha256Hex: string) => Buffer.from(sha256Hex, "hex").toString("base64");

export const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A filename safe for Content-Disposition. */
export const dispositionName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "evidence";

/** Check a declared file before any upload: kind, extension, content type and size. */
export function checkPublicFile(input: { kind: PublicEvidenceKind; filename: string; contentType: string; sizeBytes: number }): PublicFileCheck {
  const { kind, filename } = input;
  const ext = extOf(filename);
  if (/[\\/]|\.\./.test(filename) || filename.length > 200) return { ok: false, reason: "File names can't contain paths." };
  if (REFUSED_EXTS.includes(ext)) {
    return {
      ok: false,
      reason: `.${ext} files are never published. Kane evidence packs and HAR files hold network logs with cookies and auth headers, and HTML, SVG and PDF can run script. Keep them in private evidence (POST /api/v1/kane/evidence).`,
    };
  }
  const allowed = RULES[kind];
  if (!allowed[ext]) return { ok: false, reason: `A public ${kind} must be ${Object.keys(allowed).map((e) => "." + e).join(", ")}.` };
  const declared = input.contentType.split(";")[0].trim().toLowerCase();
  if (!allowed[ext].includes(declared)) return { ok: false, reason: `A .${ext} ${kind} must be sent as ${allowed[ext].join(" or ")}.` };
  const max = maxBytesFor(kind);
  if (input.sizeBytes > max) return { ok: false, reason: `A public ${kind} can be at most ${max / 1024 / 1024} MB.` };
  return { ok: true, ext, uploadContentType: declared, servedContentType: servedContentType(kind, ext), maxBytes: max };
}

/** Check uploaded bytes before they are published. A failure is final for these bytes. */
export function inspectPublicBytes(input: { kind: PublicEvidenceKind; filename: string; bytes: Buffer }): PublicBytesCheck {
  const { kind, filename, bytes } = input;
  const ext = extOf(filename);
  const v = inspectEvidence({ kind, name: filename, claimedType: null, bytes, maxBytes: maxBytesFor(kind) });
  if (v.verdict !== "ok") return { ok: false, reason: v.reason };
  if (!isTextKind(kind)) return magicMatches(ext, bytes) ? { ok: true } : { ok: false, reason: `Contents don't match a .${ext} file.` };
  const text = bytes.toString("utf8");
  if (ext === "json" && isHar(text)) return { ok: false, reason: "This is a HAR network log. HAR files hold cookies and auth headers and are never published." };
  const hits = credentialHits(text, kind === "ndjson" ? "lines" : ext === "json" ? "document" : "none");
  if (hits.length) {
    return {
      ok: false,
      reason: `This file has something that looks like a credential (${hits.join(", ")}). Remove it or replace the value with [REDACTED], then upload the new file.`,
      fields: hits,
    };
  }
  return { ok: true };
}

/** Where the existing credential scanner finds secrets in a text file: value shapes on every line, plus secret-named fields in JSON. */
export function credentialHits(text: string, json: "lines" | "document" | "none"): string[] {
  const hits = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && hits.size < MAX_HITS; i++) {
    if (!lines[i].trim()) continue;
    if (findCredentialLike(lines[i]).length) hits.add(`line ${i + 1}`);
    if (json !== "lines") continue;
    const ev = parseJson(lines[i]);
    if (ev && typeof ev === "object") for (const p of findCredentialLike(neutralizeRedacted(ev))) hits.add(`line ${i + 1}: ${p}`);
  }
  if (json === "document") {
    const doc = parseJson(text);
    if (doc && typeof doc === "object") for (const p of findCredentialLike(neutralizeRedacted(doc))) hits.add(p);
  }
  return [...hits].slice(0, MAX_HITS);
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Values a participant already redacted ("[REDACTED]", "***") are not secrets. */
function neutralizeRedacted(v: unknown): unknown {
  if (typeof v === "string") return REDACTED.test(v) ? "" : v;
  if (Array.isArray(v)) return v.map(neutralizeRedacted);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, neutralizeRedacted(x)]));
  return v;
}

function isHar(text: string) {
  const doc = parseJson(text) as { log?: { entries?: unknown } } | null;
  return !!doc && typeof doc === "object" && Array.isArray(doc.log?.entries);
}

export type PublicFileCheck = { ok: true; ext: string; uploadContentType: string; servedContentType: string; maxBytes: number } | { ok: false; reason: string };

export type PublicBytesCheck = { ok: true } | { ok: false; reason: string; fields?: string[] };
