#!/bin/sh
# Regression tests for public/install.sh. POSIX sh (runs under dash, bash, zsh, busybox ash).
#
#   SITE=http://localhost:3399 SH_UNDER_TEST=dash sh tests/installer/installer.sh
#
# Keep WORK free of UUID-looking names: npm redacts them in `npm prefix -g` output.
# SITE serves public/ (the mock server or the real app). Every scenario gets a throwaway
# HOME under WORK (default: a new temp dir) and NPM_CONFIG_PREFIX inside it, so npm's
# "global" bin is a test folder, never the real one. Never touches your real HOME.
# Optional: SKIP_INTERACTIVE=1 (no pty driver), KEEP=1 (keep WORK), ONLY="name …".
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SITE="${SITE:?set SITE to a server that serves public/}"
SITE="${SITE%/}"
SHX="${SH_UNDER_TEST:-sh}"
WORK="${WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
VERSION="$(sed -n 's/^KANEHACK_VERSION="\(.*\)"/\1/p' "$REPO/public/install.sh")"
ORIG_PATH="$PATH"
N=0; FAILS=0
ESC="$(printf '\033')"

ok() { N=$((N + 1)); echo "ok $N - $1"; }
no() { N=$((N + 1)); FAILS=$((FAILS + 1)); echo "not ok $N - $1"; [ -n "${2:-}" ] && [ -f "$2" ] && sed 's/^/  # /' "$2" | tail -40; }
check() { if eval "$2"; then ok "$1"; else no "$1" "${3:-}"; fi; }
want() { case " ${ONLY:-$1} " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# fresh <name>: a new HOME with an npm prefix inside it. Sets H, LOG, NPMP and a PATH without any link dirs.
fresh() {
  H="$WORK/$1"; rm -rf "$H"; mkdir -p "$H"
  LOG="$WORK/$1.log"
  NPMP="$H/npm-global"
  PATH="$ORIG_PATH"
}
# run_install <args…>: curl | $SHX -s -- args, no TTY (stdout to a file), the way an agent runs it.
run_install() {
  # KANEHACK_NO_KANE: no real Kane CLI install in these scenarios (scenario "kane" fakes npm and npx).
  curl -fsSL "$SITE/install.sh" | env HOME="$H" NPM_CONFIG_PREFIX="$NPMP" PATH="$PATH" SHELL="${TSHELL-/bin/sh}" KANEHACK_NO_KANE="${NO_KANE_ENV-1}" "$SHX" -s -- "$@" >"$LOG" 2>&1
}
installed_version() { [ -x "$H/.kanehack/bin/kanehack" ] && HOME="$H" "$H/.kanehack/bin/kanehack" version 2>/dev/null; }
rc_file() { if [ "$(uname -s)" = Darwin ]; then echo "$H/.bash_profile"; else echo "$H/.bashrc"; fi; }

echo "# install.sh $VERSION under $SHX ($(command -v "$SHX")), site $SITE, $(uname -sm), work $WORK"

# 1. No TTY, no --yes: every question is a quiet no, and the summary prints the re-run command.
if want no-tty; then
  fresh no-tty
  run_install --site "$SITE"; RC=$?
  check "no-tty: exit 0" '[ "$RC" -eq 0 ]' "$LOG"
  check "no-tty: nothing installed" '[ ! -e "$H/.kanehack" ] && [ ! -e "$H/.agents" ]' "$LOG"
  check "no-tty: prints the exact non-interactive command" 'grep -qF "curl -fsSL $SITE/install.sh | sh -s -- --yes --site $SITE" "$LOG"' "$LOG"
  check "no-tty: no ANSI escapes" '! grep -q "$ESC" "$LOG"' "$LOG"
  check "no-tty: no prompt text or /dev/tty errors" '! grep -q "\[y/N\]" "$LOG" && ! grep -qi "dev/tty" "$LOG"' "$LOG"
fi

# 2. --yes with npm's global bin on PATH and writable: installs, links, plain `kanehack` next steps.
if want yes-link-npm; then
  fresh yes-link-npm
  mkdir -p "$NPMP/bin"
  PATH="$NPMP/bin:$ORIG_PATH"
  run_install --yes --site "$SITE"; RC=$?
  check "yes: exit 0" '[ "$RC" -eq 0 ]' "$LOG"
  check "yes: kanehack $VERSION installed (sha256 verified)" '[ "$(installed_version)" = "$VERSION" ] && grep -q "sha256 verified" "$LOG"' "$LOG"
  check "yes: the hack-os skill in ~/.agents/skills (where Codex reads it), marked with this version" '[ -f "$H/.agents/skills/hack-os/SKILL.md" ] && [ "$(cat "$H/.agents/skills/hack-os/.bundle-version")" = "$VERSION" ] && [ "$(ls -d "$H/.agents/skills"/hack-* | wc -l | tr -d " ")" = 2 ]' "$LOG"
  check "yes: the hack-gtm skill next to it" 'grep -q "^name: hack-gtm" "$H/.agents/skills/hack-gtm/SKILL.md"' "$LOG"
  check "yes: linked into npm's global bin" '[ -L "$NPMP/bin/kanehack" ] && grep -q "kanehack → $NPMP/bin/kanehack" "$LOG"' "$LOG"
  check "yes: \`kanehack\` resolves on PATH right away" '[ "$(HOME="$H" kanehack version)" = "$VERSION" ]' "$LOG"
  check "yes: the next step is \$hack-os in a Codex session" 'grep -q "^Next: start a Codex session and enter \$hack-os" "$LOG" && ! grep -q "Next, in this terminal" "$LOG"' "$LOG"
  check "yes: --site saved as kanehack's server" 'grep -q "\"api\": \"$SITE\"" "$H/.kanehack/config.json"' "$LOG"
  check "yes: no profile edited" '[ ! -e "$H/.zshrc" ] && [ ! -e "$H/.bashrc" ] && [ ! -e "$H/.bash_profile" ]' "$LOG"
  check "yes: no re-run hint (nothing skipped)" '! grep -q "no terminal to ask" "$LOG"' "$LOG"
  # 3. Idempotent re-run.
  cp "$LOG" "$WORK/first.log"
  run_install --yes --site "$SITE"; RC=$?
  check "re-run: exit 0, already installed, already a command, skills current" '[ "$RC" -eq 0 ] && grep -q "already installed" "$LOG" && grep -q "command .*kanehack →" "$LOG" && grep -q "hack_skills *$VERSION" "$LOG" && ! grep -q "y (--yes)" "$LOG"' "$LOG"
  check "re-run: the link is unchanged" '[ "$(readlink "$NPMP/bin/kanehack")" = "$H/.kanehack/bin/kanehack" ]' "$LOG"
  echo "$H" > "$WORK/installed-home"
fi

# 3b. A HOME with a space in it: every path stays one path.
if want space-home; then
  fresh "space home"
  mkdir -p "$NPMP/bin"
  PATH="$NPMP/bin:$ORIG_PATH"
  run_install --yes --site "$SITE"; RC=$?
  check "space in HOME: installed, skills, linked" '[ "$RC" -eq 0 ] && [ "$(installed_version)" = "$VERSION" ] && [ -f "$H/.agents/skills/hack-os/SKILL.md" ] && [ -L "$NPMP/bin/kanehack" ] && [ ! -e "$WORK/space" ]' "$LOG"
fi

# 4. ~/.local/bin on PATH (npm bin isn't): link there.
if want link-local; then
  fresh link-local
  mkdir -p "$H/.local/bin"
  PATH="$H/.local/bin:$ORIG_PATH"
  run_install --yes --no-skills --site "$SITE"; RC=$?
  check "link-local: linked into ~/.local/bin, skills skipped" '[ "$RC" -eq 0 ] && [ -L "$H/.local/bin/kanehack" ] && [ ! -e "$H/.agents/skills/hack-os" ] && grep -q "skipped (--no-skills)" "$LOG"' "$LOG"
fi

# 5. npm bin on PATH but read-only (root ignores modes, so not testable as root): fall back to the profile.
if want link-readonly; then
  if [ "$(id -u)" = 0 ]; then echo "# skip link-readonly: running as root, directory modes don't apply"
  else
    fresh link-readonly
    mkdir -p "$NPMP/bin"; chmod 555 "$NPMP/bin"
    PATH="$NPMP/bin:$ORIG_PATH"
    TSHELL=/bin/bash run_install --yes --no-skills --site "$SITE"; RC=$?
    chmod 755 "$NPMP/bin"
    RC_FILE="$(rc_file)"
    check "read-only npm bin: not linked, profile line added, next step is \$hack-os" '[ "$RC" -eq 0 ] && [ ! -e "$NPMP/bin/kanehack" ] && grep -q "No folder on your PATH is writable" "$LOG" && grep -q "kanehack/bin" "$RC_FILE" && grep -q "^Next: start a Codex session" "$LOG"' "$LOG"
  fi
fi

# 6. No link dir at all, SHELL=zsh: profile line in ~/.zshrc, once.
if want profile-zsh; then
  fresh profile-zsh
  TSHELL=/bin/zsh run_install --yes --no-skills --site "$SITE"; RC=$?
  check "zsh: line added to ~/.zshrc" '[ "$RC" -eq 0 ] && [ "$(grep -c "kanehack/bin" "$H/.zshrc")" = 1 ]' "$LOG"
  TSHELL=/bin/zsh run_install --yes --no-skills --site "$SITE"
  check "zsh: re-run doesn't add it twice" '[ "$(grep -c "kanehack/bin" "$H/.zshrc")" = 1 ] && grep -q "already adds kanehack" "$LOG"' "$LOG"
fi
if want profile-bash; then
  fresh profile-bash
  TSHELL=/bin/bash run_install --yes --no-skills --site "$SITE"; RC=$?
  RC_FILE="$(rc_file)"
  check "bash: line added to $(basename "$RC_FILE")" '[ "$RC" -eq 0 ] && [ "$(grep -c "kanehack/bin" "$RC_FILE")" = 1 ]' "$LOG"
fi
if want profile-fish; then
  fresh profile-fish
  TSHELL=/usr/bin/fish run_install --yes --no-skills --site "$SITE"; RC=$?
  check "fish: no profile edited, fish_add_path hint" '[ "$RC" -eq 0 ] && [ ! -e "$H/.config/fish" ] && [ ! -e "$H/.zshrc" ] && [ ! -e "$H/.bashrc" ] && grep -q "fish_add_path ~/.kanehack/bin" "$LOG"' "$LOG"
fi
if want no-shell; then
  fresh no-shell
  curl -fsSL "$SITE/install.sh" | env -u SHELL HOME="$H" NPM_CONFIG_PREFIX="$NPMP" PATH="$PATH" "$SHX" -s -- --yes --no-skills --site "$SITE" >"$LOG" 2>&1; RC=$?
  check "SHELL unset: no crash, installed" '[ "$RC" -eq 0 ] && [ "$(installed_version)" = "$VERSION" ]' "$LOG"
fi
if want no-path; then
  fresh no-path
  mkdir -p "$NPMP/bin"; PATH="$NPMP/bin:$ORIG_PATH"
  TSHELL=/bin/zsh run_install --yes --no-path --no-skills --site "$SITE"; RC=$?
  check "--no-path: installed, not linked, no profile" '[ "$RC" -eq 0 ] && [ "$(installed_version)" = "$VERSION" ] && [ ! -e "$NPMP/bin/kanehack" ] && [ ! -e "$H/.zshrc" ]' "$LOG"
fi

# 7. A different kanehack already on PATH: left alone.
if want conflict; then
  fresh conflict
  mkdir -p "$NPMP/bin" "$H/other"
  printf '#!/bin/sh\necho not-ours\n' > "$H/other/kanehack"; chmod +x "$H/other/kanehack"
  PATH="$H/other:$NPMP/bin:$ORIG_PATH"
  TSHELL=/bin/zsh run_install --yes --no-skills --site "$SITE"; RC=$?
  check "conflict: no profile line that would shadow it" '[ ! -e "$H/.zshrc" ]' "$LOG"
  check "conflict: other kanehack untouched, warned, no link" '[ "$RC" -eq 0 ] && [ "$(cat "$H/other/kanehack" | tail -1)" = "echo not-ours" ] && grep -q "another kanehack is on PATH" "$LOG" && [ ! -e "$NPMP/bin/kanehack" ]' "$LOG"
fi

# 8. Upgrade from 0.1.0 (installed the way installer 0.1.0 did).
if want upgrade; then
  fresh upgrade
  mkdir -p "$H/.kanehack/cli" "$H/.kanehack/bin"
  for s in onboard doctor team idea harness verify progress help demo showcase gtm submit; do mkdir -p "$H/.agents/skills/hack-$s"; echo "old" > "$H/.agents/skills/hack-$s/SKILL.md"; done
  echo "stale" > "$H/.agents/skills/hack-gtm/stale.md"
  echo "0.1.0" > "$H/.agents/skills/hack-onboard/.bundle-version"
  mkdir -p "$H/.agents/skills/hack-foo"; echo "mine" > "$H/.agents/skills/hack-foo/SKILL.md"
  HOME="$H" npm install --silent --no-audit --no-fund --prefix "$H/.kanehack/cli" "$REPO/public/kanehack-0.1.0.tgz" >/dev/null 2>&1
  ln -sf "$H/.kanehack/cli/node_modules/kanehack/bin/kanehack.mjs" "$H/.kanehack/bin/kanehack"
  BEFORE="$(installed_version)"
  run_install --yes --site "$SITE"; RC=$?
  check "upgrade: 0.1.0 → $VERSION, old skills replaced" '[ "$BEFORE" = 0.1.0 ] && [ "$RC" -eq 0 ] && [ "$(installed_version)" = "$VERSION" ] && grep -q "Upgrade the kanehack helper" "$LOG" && [ -f "$H/.agents/skills/hack-os/SKILL.md" ]' "$LOG"
  check "upgrade: the 12 bundled hack-* folders removed, your own hack-foo kept" '[ "$(ls -d "$H/.agents/skills"/hack-* | sed "s|.*/||" | tr "\n" " ")" = "hack-foo hack-gtm hack-os " ] && [ "$(cat "$H/.agents/skills/hack-foo/SKILL.md")" = mine ]' "$LOG"
  check "upgrade: hack-gtm is the new one, nothing left from the old copy" 'grep -q "^name: hack-gtm" "$H/.agents/skills/hack-gtm/SKILL.md" && [ ! -e "$H/.agents/skills/hack-gtm/stale.md" ]' "$LOG"
fi

# 8a. ~/.codex/skills is a link to ~/.agents/skills: the legacy cleanup must not delete the fresh hack-os.
if want same-dir; then
  fresh same-dir
  mkdir -p "$H/.agents/skills" "$H/.codex"
  ln -s "$H/.agents/skills" "$H/.codex/skills"
  run_install --yes --site "$SITE"; RC=$?
  check "same-dir: hack-os installed and still there" '[ "$RC" -eq 0 ] && [ -f "$H/.agents/skills/hack-os/SKILL.md" ]' "$LOG"
  run_install --yes --site "$SITE"; RC=$?
  check "same-dir: re-run keeps hack-os and hack-gtm" '[ "$RC" -eq 0 ] && [ -f "$H/.agents/skills/hack-os/SKILL.md" ] && [ -f "$H/.agents/skills/hack-gtm/SKILL.md" ]' "$LOG"
fi

# 8b'. Same linked folder, upgrading over the 0.1.x skills: the new hack-gtm must survive both cleanups.
if want same-dir-upgrade; then
  fresh same-dir-upgrade
  mkdir -p "$H/.agents/skills" "$H/.codex"
  ln -s "$H/.agents/skills" "$H/.codex/skills"
  for s in onboard doctor team idea harness verify progress help demo showcase gtm submit; do mkdir -p "$H/.agents/skills/hack-$s"; echo "old" > "$H/.agents/skills/hack-$s/SKILL.md"; done
  echo "0.1.0" > "$H/.agents/skills/hack-onboard/.bundle-version"
  run_install --yes --site "$SITE"; RC=$?
  check "same-dir-upgrade: hack-os and the new hack-gtm, nothing else" '[ "$RC" -eq 0 ] && [ "$(ls -d "$H/.agents/skills"/hack-* | sed "s|.*/||" | tr "\n" " ")" = "hack-gtm hack-os " ] && grep -q "^name: hack-gtm" "$H/.agents/skills/hack-gtm/SKILL.md"' "$LOG"
fi

# 8c. The person deleted hack-gtm: a re-run puts it back.
if want missing-gtm; then
  fresh missing-gtm
  run_install --yes --site "$SITE"; RC=$?
  rm -r "$H/.agents/skills/hack-gtm"
  run_install --yes --site "$SITE"; RC=$?
  check "missing-gtm: a re-run puts hack-gtm back" '[ "$RC" -eq 0 ] && [ -f "$H/.agents/skills/hack-gtm/SKILL.md" ]' "$LOG"
fi

# 8d. Installed from production's published 0.1.5 bundle (marked 0.1.5): a re-run brings this
# version's skills. Same version number = skipped, so a changed bundle always needs a new version.
if want from-published-015; then
  fresh from-published-015
  mkdir -p "$H/.agents/skills"
  tar -xzf "$REPO/public/hack-skills-0.1.5.tgz" -C "$H/.agents/skills"
  echo "0.1.5" > "$H/.agents/skills/hack-os/.bundle-version"
  run_install --yes --site "$SITE"; RC=$?
  check "from-published-015: a re-run replaces the 0.1.5 skills with this version's" '[ "$RC" -eq 0 ] && [ "$(cat "$H/.agents/skills/hack-os/.bundle-version")" = "$VERSION" ] && diff -r -q -x .bundle-version "$H/.agents/skills/hack-os" "$REPO/plugin/skills/hack-os" >/dev/null && diff -r -q "$H/.agents/skills/hack-gtm" "$REPO/plugin/skills/hack-gtm" >/dev/null' "$LOG"
fi

# 8b. Codex: an existing ~/.codex with its own config and the 0.1.2 skill copies. --yes connects it
# (no token in config.toml, backup made, other servers kept), removes the duplicate skills, and a
# re-run changes nothing. With CODEX_BIN_DIR (the real @openai/codex, kept off ORIG_PATH so the
# other scenarios don't see it) Codex itself must read the entry and list each skill once.
if want codex; then
  fresh codex
  mkdir -p "$NPMP/bin" "$H/.codex/skills/hack-onboard" "$H/.codex/skills/hack-verify" "$H/.codex/skills/my-own-skill"
  printf '[mcp_servers.other]\ncommand = "echo"\n' > "$H/.codex/config.toml"
  echo "0.1.2" > "$H/.codex/skills/hack-onboard/.bundle-version"
  echo "old" > "$H/.codex/skills/hack-onboard/SKILL.md"; echo "old" > "$H/.codex/skills/hack-verify/SKILL.md"; echo "mine" > "$H/.codex/skills/my-own-skill/SKILL.md"
  PATH="$NPMP/bin:${CODEX_BIN_DIR:+$CODEX_BIN_DIR:}$ORIG_PATH"
  run_install --yes --site "$SITE"; RC=$?
  CFG="$H/.codex/config.toml"
  check "codex: exit 0, asked and connected" '[ "$RC" -eq 0 ] && grep -q "Connect Codex to the event server" "$LOG" && grep -q "codex_mcp .*Codex → kane-hack-event" "$LOG"' "$LOG"
  check "codex: config.toml has kane-hack-event with the helper, the other server, no token" 'grep -q "^\[mcp_servers.kane-hack-event\]" "$CFG" && grep -qF "url = \"$SITE/mcp\"" "$CFG" && grep -q "http_headers_helper = .*mcp-headers" "$CFG" && grep -q "^\[mcp_servers.other\]" "$CFG" && ! grep -q "khk_" "$CFG"' "$LOG"
  check "codex: config.toml backed up first" '[ "$(ls "$H/.codex" | grep -c "config.toml.kanehack-.*\.bak")" = 1 ]' "$LOG"
  check "codex: hack-os and hack-gtm in ~/.agents/skills, the 0.1.2 copies in ~/.codex/skills removed, other skills kept" '[ "$(ls -d "$H/.agents/skills"/hack-* | wc -l | tr -d " ")" = 2 ] && [ ! -e "$H/.codex/skills/hack-onboard" ] && [ ! -e "$H/.codex/skills/hack-verify" ] && [ -f "$H/.codex/skills/my-own-skill/SKILL.md" ] && grep -q "removed the old copies" "$LOG"' "$LOG"
  check "codex: next steps mention \$hack-os" 'grep -qF "type \$hack-os" "$LOG"' "$LOG"
  if [ -n "${CODEX_BIN_DIR:-}" ]; then
    G="$(env HOME="$H" CODEX_HOME="$H/.codex" PATH="$PATH" node "$HERE/codex-probe.mjs" get)"
    check "codex: codex mcp get kane-hack-event reads it (url, helper)" 'printf "%s\n" "$G" | grep -qF "\"url\":\"$SITE/mcp\"" && printf "%s\n" "$G" | grep -q "\"http_headers_helper\":\"<redacted>\""' "$LOG"
    mkdir -p "$WORK/empty-cwd"
    K="$(cd "$WORK/empty-cwd" && env HOME="$H" CODEX_HOME="$H/.codex" PATH="$PATH" node "$HERE/codex-probe.mjs" skills)"
    check "codex: Codex lists hack-os and hack-gtm once each" 'printf "%s\n" "$K" | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const h=JSON.parse(s).hack;process.exit(Object.keys(h).length===2&&h[\"hack-os\"]===1&&h[\"hack-gtm\"]===1?0:1)})"' "$LOG"
  else echo "# skip codex binary checks: CODEX_BIN_DIR not set"; fi
  cp "$CFG" "$WORK/codex-before"
  run_install --yes --site "$SITE"; RC=$?
  check "codex re-run: already connected, no question, config unchanged, no new backup" '[ "$RC" -eq 0 ] && grep -q "already connected" "$LOG" && ! grep -q "y (--yes)" "$LOG" && cmp -s "$CFG" "$WORK/codex-before" && [ "$(ls "$H/.codex" | grep -c "\.bak")" = 1 ]' "$LOG"
fi
if want no-agents; then
  fresh no-agents
  mkdir -p "$H/.codex"; printf 'model = "x"\n' > "$H/.codex/config.toml"
  run_install --yes --no-agents --no-skills --site "$SITE"; RC=$?
  check "--no-agents: Codex config untouched, not asked" '[ "$RC" -eq 0 ] && [ "$(cat "$H/.codex/config.toml")" = "model = \"x\"" ] && ! grep -q "Connect Codex" "$LOG"' "$LOG"
fi

# 9. Tampered downloads: exit non-zero, install nothing. A second mock serves a corrupted copy.
if want tamper; then
  for which in kanehack skills; do
    T="$WORK/tampered-$which"; rm -rf "$T"; mkdir -p "$T"
    cp "$REPO/public/install.sh" "$REPO/public/kanehack-$VERSION.tgz" "$REPO/public/hack-skills-$VERSION.tgz" "$T/"
    if [ "$which" = kanehack ]; then F="$T/kanehack-$VERSION.tgz"; else F="$T/hack-skills-$VERSION.tgz"; fi
    printf 'x' >> "$F"
    PORT=$((3380 + ${#which}))
    node "$HERE/mock-server.mjs" --port "$PORT" --public "$T" >"$WORK/tamper-server.log" 2>&1 &
    MPID=$!
    i=0; while [ $i -lt 50 ] && ! grep -q listening "$WORK/tamper-server.log" 2>/dev/null; do sleep 0.2; i=$((i + 1)); done
    fresh "tamper-$which"
    mkdir -p "$NPMP/bin"; PATH="$NPMP/bin:$ORIG_PATH"
    curl -fsSL "http://localhost:$PORT/install.sh" | env HOME="$H" NPM_CONFIG_PREFIX="$NPMP" PATH="$PATH" "$SHX" -s -- --yes --site "http://localhost:$PORT" >"$LOG" 2>&1; RC=$?
    kill "$MPID" 2>/dev/null; wait "$MPID" 2>/dev/null
    check "tampered $which tarball: exit 1, checksum mismatch, nothing installed" '[ "$RC" -eq 1 ] && grep -q "checksum mismatch" "$LOG" && grep -q "Nothing was installed" "$LOG" && [ ! -e "$H/.kanehack/bin" ] && [ ! -e "$H/.agents/skills/hack-os" ] && [ ! -e "$NPMP/bin/kanehack" ]' "$LOG"
  done
fi

# 10. No node / npm on PATH.
if want no-node; then
  fresh no-node
  NB="$H/nonode-bin"; mkdir -p "$NB"
  for t in sh dash bash zsh busybox gzip curl uname sed grep cut mktemp tar rm mkdir ln cat head git readlink chmod timeout shasum sha256sum openssl env id tr wc ls perl; do
    p="$(command -v "$t" 2>/dev/null || true)"
    case "$p" in /*) ln -s "$p" "$NB/$t" ;; esac
  done
  # shasum is a perl script on macOS: it needs perl, which is fine; node and npm are left out.
  PATH="$NB"
  run_install --yes --site "$SITE"; RC=$?
  PATH="$ORIG_PATH"
  check "no node: exit 0, node ✗ with the fix, kanehack not installed" '[ "$RC" -eq 0 ] && grep -q "node .*missing" "$LOG" && grep -q "Install Node (with npm) first" "$LOG" && [ ! -e "$H/.kanehack/bin" ]' "$LOG"
fi

# 11. Interactive, under a real pseudo-terminal, answering each prompt after it appears.
# (CI is unset for these: with CI set the installer never asks, by design. TERM is set because
# bash sets an unset TERM to "dumb", and the installer rightly turns colors off for that.)
# Kane CLI: every --yes run installs or updates the release candidate and the official Kane skill;
# --no-kane and a run with no terminal leave them alone. npm (for kane-cli only) and npx are faked.
if want kane; then
  fresh kane
  REAL_NPM="$(command -v npm)"
  FAKE="$H/fakebin"; mkdir -p "$FAKE" "$NPMP/bin"
  cat > "$FAKE/npm" <<FAKENPM
#!/bin/sh
case " \$* " in
  *" @testmuai/kane-cli@rc "*) echo "npm \$*" >> "$H/kane.log"; printf '#!/bin/sh\ncase "\$1" in --version) echo "kane-cli 0.10.0-rc.1" ;; esac\nexit 0\n' > "$NPMP/bin/kane-cli"; chmod +x "$NPMP/bin/kane-cli"; exit 0 ;;
esac
exec "$REAL_NPM" "\$@"
FAKENPM
  cat > "$FAKE/npx" <<FAKENPX
#!/bin/sh
echo "npx \$*" >> "$H/kane.log"
case " \$* " in *" @testmuai/kane-cli-skill "*) mkdir -p "\$HOME/.agents/skills/kane-cli" && echo "# kane-cli" > "\$HOME/.agents/skills/kane-cli/SKILL.md" && echo 0.1.3 > "\$HOME/.agents/skills/kane-cli/VERSION" ;; esac
exit 0
FAKENPX
  chmod +x "$FAKE/npm" "$FAKE/npx"
  PATH="$FAKE:$NPMP/bin:$ORIG_PATH"
  NO_KANE_ENV=""
  run_install --yes --site "$SITE"; RC=$?
  check "kane: --yes runs npm install -g @testmuai/kane-cli@rc" '[ "$RC" -eq 0 ] && grep -q "^npm install -g --silent --no-audit --no-fund @testmuai/kane-cli@rc" "$H/kane.log"' "$LOG"
  check "kane: and installs the official Kane skill, unattended" 'grep -q "^npx --yes @testmuai/kane-cli-skill install" "$H/kane.log"' "$LOG"
  check "kane: the check shows the release candidate and the skill" 'grep -q "kane_cli *kane-cli 0.10.0-rc.1" "$LOG" && grep -q "kane_skill *0.1.3" "$LOG"' "$LOG"
  run_install --yes --site "$SITE"
  check "kane: every run updates it again" '[ "$(grep -c "kane-cli@rc" "$H/kane.log")" = 2 ]' "$LOG"
  rm -f "$H/kane.log"
  run_install --site "$SITE"
  check "kane: no terminal and no --yes: nothing installed" '[ ! -e "$H/kane.log" ]' "$LOG"
  run_install --yes --no-kane --site "$SITE"
  check "kane: --no-kane: nothing installed" '[ ! -e "$H/kane.log" ]' "$LOG"
  unset NO_KANE_ENV
fi

if want interactive; then
  if [ -n "${SKIP_INTERACTIVE:-}" ] || ! command -v python3 >/dev/null 2>&1; then echo "# skip interactive: no python3 for the pty driver"
  else
    fresh interactive-yes
    mkdir -p "$NPMP/bin"
    CMD="curl -fsSL '$SITE/install.sh' | env -u CI -u NO_COLOR TERM=xterm HOME='$H' NPM_CONFIG_PREFIX='$NPMP' PATH='$NPMP/bin:$ORIG_PATH' SHELL=/bin/sh KANEHACK_NO_KANE=1 $SHX -s -- --site '$SITE'"
    python3 "$HERE/interactive.py" "y,y,y" "$CMD" >"$LOG" 2>&1; RC=$?
    check "interactive yes,yes,yes: exit 0 after 3 prompts" '[ "$RC" -eq 0 ] && grep -q "prompts answered: 3" "$LOG"' "$LOG"
    check "interactive yes,yes,yes: installed, skills, linked" '[ "$(installed_version)" = "$VERSION" ] && [ -L "$NPMP/bin/kanehack" ] && [ -f "$H/.agents/skills/hack-os/SKILL.md" ]' "$LOG"
    check "interactive: colors on a terminal" 'grep -q "$ESC" "$LOG"' "$LOG"
    fresh interactive-no
    CMD="curl -fsSL '$SITE/install.sh' | env -u CI -u NO_COLOR TERM=xterm HOME='$H' NPM_CONFIG_PREFIX='$NPMP' PATH='$ORIG_PATH' SHELL=/bin/sh KANEHACK_NO_KANE=1 $SHX -s -- --site '$SITE'"
    python3 "$HERE/interactive.py" "n,n" "$CMD" >"$LOG" 2>&1; RC=$?
    check "interactive no,no: nothing installed, no re-run hint" '[ "$RC" -eq 0 ] && grep -q "prompts answered: 2" "$LOG" && [ ! -e "$H/.kanehack" ] && ! grep -q "no terminal to ask" "$LOG"' "$LOG"
  fi
fi

echo "1..$N"
echo "# $((N - FAILS))/$N passed (install.sh under $SHX)"
[ -n "${KEEP:-}" ] || [ -n "${KEEP_INSTALLED:-}" ] || rm -rf "$WORK"
[ "$FAILS" -eq 0 ]
