// Checks on an uploaded evidence file before it is stored (T-KANE-04, the
// adversarial list): type and size, magic bytes, executables, and for zips
// the central directory: path traversal, symlinks, encryption, entry count
// and compression ratio (zip bombs). Pure: Buffer in, verdict out.
//
//   reject     → never stored (too big, wrong type for the kind, hash mismatch)
//   quarantine → stored under evidence-quarantine/, never served to anyone but
//                organizers, redaction_state = 'quarantined'
//   ok         → stored under evidence/, private, served only to the team,
//                judges and organizers through /api/v1/kane/evidence/{id}

export type EvidenceKind = "ndjson" | "screenshot" | "video" | "report" | "testmd" | "zip" | "log" | "other";
export const EVIDENCE_KINDS: EvidenceKind[] = ["ndjson", "screenshot", "video", "report", "testmd", "zip", "log", "other"];

/** Direct (multipart) uploads go through a function body: keep under Vercel's 4.5 MB. */
export const MAX_DIRECT_BYTES = 4 * 1024 * 1024;
/** Signed client uploads straight to Blob. */
export const MAX_SIGNED_BYTES = 50 * 1024 * 1024;

const ZIP_MAX_ENTRIES = 2000;
const ZIP_MAX_TOTAL = 200 * 1024 * 1024;
const ZIP_MAX_RATIO = 100;

/** Kane CLI seals each run as a zip with this extension. */
export const KANE_PACK_EXT = "evidence";

type Rule = { exts: string[]; types: string[]; magic?: (b: Buffer) => boolean; text?: boolean };

const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
const isMp4 = (b: Buffer) => b.subarray(4, 8).toString("latin1") === "ftyp";
const isWebm = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const isZip = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

const RULES: Record<EvidenceKind, Rule> = {
  ndjson: { exts: ["ndjson", "jsonl", "json"], types: ["application/x-ndjson", "application/json", "application/jsonl", "text/plain"], text: true },
  screenshot: { exts: ["png", "jpg", "jpeg", "webp"], types: ["image/png", "image/jpeg", "image/webp"], magic: (b) => isPng(b) || isJpeg(b) || isWebp(b) },
  video: { exts: ["mp4", "webm"], types: ["video/mp4", "video/webm"], magic: (b) => isMp4(b) || isWebm(b) },
  report: { exts: ["pdf", "json", "md", "html", "txt"], types: ["application/pdf", "application/json", "text/markdown", "text/html", "text/plain"] },
  testmd: { exts: ["md"], types: ["text/markdown", "text/plain"], text: true },
  zip: { exts: ["zip", KANE_PACK_EXT], types: ["application/zip", "application/x-zip-compressed"], magic: isZip },
  log: { exts: ["log", "txt"], types: ["text/plain"], text: true },
  other: { exts: ["txt", "json"], types: ["text/plain", "application/json"], text: true },
};

/** Every content type some evidence kind accepts: the signed-upload token allows only these. */
export const EVIDENCE_CONTENT_TYPES = [...new Set(Object.values(RULES).flatMap((r) => r.types))];

const EXEC_EXT = /\.(exe|dll|so|dylib|sh|bash|zsh|bat|cmd|ps1|psm1|vbs|js|mjs|jar|scr|msi|com|app|command|apk|ipa|pkg|deb|rpm)$/i;

export type EvidenceVerdict =
  | { verdict: "ok"; contentType: string; ext: string }
  | { verdict: "quarantine"; contentType: string; ext: string; reason: string }
  | { verdict: "reject"; reason: string };

export function extOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function looksExecutable(b: Buffer) {
  const h4 = b.subarray(0, 4).toString("hex");
  return (
    b.subarray(0, 2).toString("latin1") === "MZ" ||
    h4 === "7f454c46" || // ELF
    ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(h4) || // Mach-O / fat / class
    b.subarray(0, 2).toString("latin1") === "#!"
  );
}

function isCleanText(b: Buffer) {
  if (b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** Walk the zip central directory. Returns a quarantine reason, or null when it looks safe. */
export function inspectZip(b: Buffer): string | null {
  // End of central directory: last 22..65557 bytes.
  const from = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= from; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "zip has no central directory";
  const entries = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOffset = b.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) return "zip64 archives are not accepted";
  if (entries > ZIP_MAX_ENTRIES) return `zip has ${entries} entries (max ${ZIP_MAX_ENTRIES})`;
  if (cdOffset + cdSize > b.length) return "zip central directory is out of bounds";

  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return "zip central directory is corrupt";
    const flags = b.readUInt16LE(p + 8);
    const compressed = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const externalAttr = b.readUInt32LE(p + 38);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) return `encrypted entry: ${name.slice(0, 80)}`;
    if (compressed === 0xffffffff || size === 0xffffffff) return "zip64 entries are not accepted";
    const parts = name.split(/[\\/]/);
    if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || parts.includes("..")) return `path traversal in entry: ${name.slice(0, 80)}`;
    if (((externalAttr >>> 16) & 0o170000) === 0o120000) return `symlink entry: ${name.slice(0, 80)}`;
    if (EXEC_EXT.test(name)) return `executable entry: ${name.slice(0, 80)}`;
    if (/\.zip$/i.test(name)) return `nested archive: ${name.slice(0, 80)}`;
    if (compressed > 0 && size / compressed > ZIP_MAX_RATIO) return `compression ratio over ${ZIP_MAX_RATIO}:1 (zip bomb?) in ${name.slice(0, 80)}`;
    if (compressed === 0 && size > 0) return `entry with impossible sizes: ${name.slice(0, 80)}`;
    total += size;
    if (total > ZIP_MAX_TOTAL) return `zip expands past ${ZIP_MAX_TOTAL / 1024 / 1024} MB`;
  }
  return null;
}

/** Decide what to do with an upload. `claimedType` is the client's content-type, never trusted alone. */
export function inspectEvidence(input: { kind: EvidenceKind; name: string; claimedType: string | null; bytes: Buffer; maxBytes: number }): EvidenceVerdict {
  const { kind, name, bytes } = input;
  const rule = RULES[kind];
  const ext = extOf(name);
  if (bytes.length === 0) return { verdict: "reject", reason: "The file is empty." };
  if (bytes.length > input.maxBytes) return { verdict: "reject", reason: `The file is over ${Math.floor(input.maxBytes / 1024 / 1024)} MB.` };
  if (/[\\/]|\.\./.test(name) || name.length > 200) return { verdict: "reject", reason: "File names can't contain paths." };
  if (!rule.exts.includes(ext)) return { verdict: "reject", reason: `A ${kind} upload must be ${rule.exts.map((e) => "." + e).join(", ")}.` };
  const claimed = (input.claimedType ?? "").split(";")[0].trim().toLowerCase();
  // Our own content type comes from the kind + extension, not from the client.
  const contentType = rule.types.find((t) => t === claimed) ?? rule.types[0];

  if (looksExecutable(bytes)) return { verdict: "quarantine", contentType, ext, reason: "File starts like an executable or script." };
  if (rule.magic && !rule.magic(bytes)) return { verdict: "quarantine", contentType, ext, reason: `Contents don't match a .${ext} file.` };
  if (ext === "pdf" && !isPdf(bytes)) return { verdict: "quarantine", contentType, ext, reason: "Contents don't match a .pdf file." };
  if ((rule.text || ["json", "md", "html", "txt"].includes(ext)) && !isCleanText(bytes)) return { verdict: "quarantine", contentType, ext, reason: "Text evidence contains binary data." };
  if (kind === "zip") {
    const why = inspectZip(bytes);
    if (why) return { verdict: "quarantine", contentType, ext, reason: why };
  }
  return { verdict: "ok", contentType, ext };
}

/** A Kane `.evidence` pack is a zip, whatever kind the client sent. */
export function evidenceKindFor(kind: EvidenceKind, name: string): EvidenceKind {
  return extOf(name) === KANE_PACK_EXT ? "zip" : kind;
}

/** Whether the bytes carry the signature of this exact extension (an image or video type). */
export function magicMatches(ext: string, b: Buffer) {
  const check: Record<string, (b: Buffer) => boolean> = { png: isPng, jpg: isJpeg, jpeg: isJpeg, webp: isWebp, mp4: isMp4, webm: isWebm };
  return !!check[ext]?.(b);
}
