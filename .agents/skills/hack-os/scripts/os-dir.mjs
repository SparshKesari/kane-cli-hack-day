// Where the hack-os skill keeps its private notes: ~/.kanehack/os, or a folder in the temp
// directory when that one can't be written. Codex's default sandbox blocks writes outside the
// project (EPERM) but allows the temp directory, so the skill keeps working there.
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";

const who = () => {
  try {
    return userInfo().username.replace(/[^\w.-]/g, "") || "user";
  } catch {
    return "user";
  }
};
const STATE = process.env.KANEHACK_OS_STATE || join(homedir(), ".kanehack", "os", "state.json");
export const STATE_NAME = basename(STATE);
export const PRIMARY = dirname(STATE);
export const FALLBACK = process.env.KANEHACK_OS_FALLBACK || join(tmpdir(), `kanehack-os-${who()}`);
const BLOCKED = new Set(["EPERM", "EACCES", "EROFS"]);

/** The newest copy of `name` in either folder, parsed, or null. */
export function readNote(name) {
  let best = null;
  for (const dir of [PRIMARY, FALLBACK]) {
    const file = join(dir, name);
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      const at = statSync(file).mtimeMs;
      if (!best || at > best.at) best = { value, at };
    } catch {}
  }
  return best ? best.value : null;
}

function writeIn(dir, name, value) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, name);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return file;
}

/** Save `name` in ~/.kanehack/os, or in the temp folder when that is blocked. The path, or null. Never throws. */
export function writeNote(name, value) {
  try {
    return writeIn(PRIMARY, name, value);
  } catch (e) {
    if (!BLOCKED.has(e?.code)) return warn(name, e);
  }
  try {
    return writeIn(FALLBACK, name, value);
  } catch (e) {
    return warn(name, e);
  }
}

function warn(name, e) {
  process.stderr.write(JSON.stringify({ warning: `couldn't save ${name} (${e?.code ?? e}); carry on, it's only a private note` }) + "\n");
  return null;
}
