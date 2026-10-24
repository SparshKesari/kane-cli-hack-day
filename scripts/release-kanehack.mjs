#!/usr/bin/env node
// Build the installer tarballs and pin their sha256 in both installers.
//
//   node scripts/release-kanehack.mjs [--rebuild]
//
// - public/kanehack-<v>.tgz      npm pack of packages/kanehack (v = its package.json version)
// - public/hack-skills-<v>.tgz   plugin/skills/hack-*/ (must match .agents/skills), a reproducible tarball
// - KANEHACK_VERSION / KANEHACK_SHA256 / SKILLS_SHA256 in public/install.sh and public/install.ps1
//
// A published tarball is never replaced: if public/kanehack-<v>.tgz exists the script stops,
// unless --rebuild (only for a version that has not been deployed yet). Bump the version instead.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const rebuild = process.argv.includes("--rebuild");
const pkgDir = join(root, "packages/kanehack");
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
const bin = readFileSync(join(pkgDir, "bin/kanehack.mjs"), "utf8");
if (!bin.includes(`const VERSION = "${version}"`)) throw new Error(`bin/kanehack.mjs VERSION doesn't match package.json ${version}`);

const khTgz = join(root, `public/kanehack-${version}.tgz`);
const skTgz = join(root, `public/hack-skills-${version}.tgz`);
for (const f of [khTgz, skTgz]) if (existsSync(f) && !rebuild) throw new Error(`${relative(root, f)} exists. Never replace a published tarball: bump the version (or --rebuild if ${version} was never deployed).`);

// 1. kanehack: npm pack (npm normalises mtimes, so this is reproducible).
const packed = execFileSync("npm", ["pack", "--silent", "--pack-destination", join(root, "public")], { cwd: pkgDir, encoding: "utf8", shell: process.platform === "win32" }).trim().split("\n").pop();
if (join(root, "public", packed) !== khTgz) renameSync(join(root, "public", packed), khTgz);

// 2. skills: plugin/skills and the .agents/skills mirror must be identical.
const list = (dir) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => statSync(join(dir, p)).isFile())
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.startsWith("hack-") && !p.split("/").some((s) => s.startsWith(".")))
    .sort();
const a = join(root, "plugin/skills");
const b = join(root, ".agents/skills");
const files = list(a);
const mirror = list(b);
if (JSON.stringify(files) !== JSON.stringify(mirror) || files.some((f) => !readFileSync(join(a, f)).equals(readFileSync(join(b, f))))) throw new Error("plugin/skills and .agents/skills differ: sync them first.");
const skills = [...new Set(files.map((f) => f.split("/")[0]))];
if (skills.join() !== "hack-os") throw new Error(`expected only the hack-os skill, found ${skills.join(", ")}`);

// A minimal ustar writer: fixed mtime/owner/mode, so the same files give the same bytes everywhere.
const MTIME = 499162500; // 1985-10-26, like npm pack
function header(name, size, type) {
  const h = Buffer.alloc(512);
  const put = (s, off, len) => h.write(s, off, len, "utf8");
  const oct = (n, len) => n.toString(8).padStart(len - 1, "0") + "\0";
  put(name, 0, 100);
  put(oct(type === "5" ? 0o755 : 0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(MTIME, 12), 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const x of h) sum += x;
  put(oct(sum, 7) + " ", 148, 8);
  return h;
}
const parts = [];
for (const s of skills) {
  parts.push(header(`${s}/`, 0, "5"));
  for (const f of files.filter((x) => x.startsWith(`${s}/`))) {
    const data = readFileSync(join(a, f));
    parts.push(header(f, data.length, "0"), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
}
parts.push(Buffer.alloc(1024));
writeFileSync(skTgz, gzipSync(Buffer.concat(parts), { level: 9 }));

// 3. Pin.
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const khSha = sha(khTgz);
const skSha = sha(skTgz);
const sh = join(root, "public/install.sh");
const ps = join(root, "public/install.ps1");
const edit = (file, pairs) => {
  let s = readFileSync(file, "utf8");
  for (const [re, val] of pairs) {
    if (!re.test(s)) throw new Error(`${relative(root, file)}: no match for ${re}`);
    s = s.replace(re, val);
  }
  writeFileSync(file, s);
};
edit(sh, [
  [/^KANEHACK_VERSION="[^"]*"/m, `KANEHACK_VERSION="${version}"`],
  [/^KANEHACK_SHA256="[^"]*"/m, `KANEHACK_SHA256="${khSha}"`],
  [/^SKILLS_SHA256="[^"]*"/m, `SKILLS_SHA256="${skSha}"`],
  [/^# Version: .*/m, `# Version: ${version}`],
]);
edit(ps, [
  [/^\$KanehackVersion = "[^"]*"/m, `$KanehackVersion = "${version}"`],
  [/^\$KanehackSha256 = "[^"]*"/m, `$KanehackSha256 = "${khSha}"`],
  [/^\$SkillsSha256 = "[^"]*"/m, `$SkillsSha256 = "${skSha}"`],
  [/^# Version: .*/m, `# Version: ${version}`],
]);
rmSync(join(pkgDir, "kanehack-" + version + ".tgz"), { force: true });
console.log(`kanehack ${version}\n  ${relative(root, khTgz)}  ${khSha}\n  ${relative(root, skTgz)}  ${skSha} (${skills.length} skills, ${files.length} files)\n  pinned in public/install.sh and public/install.ps1`);
