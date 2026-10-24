#!/bin/sh
# Render the showcase video with Remotion.
# Usage: render.sh <launch/video dir> [destination] [--vertical]
# Expects <dir>/storyboard.json plus steps/, assets/, audio/ next to it (as written by
# evidence_to_storyboard.py and tts.py). Output: <dir>/showcase.mp4 (or showcase-vertical.mp4).
# The working project defaults to ./launch/remotion; the installed skill is read-only.
set -eu

SRC_DIR="${1:?usage: render.sh <launch/video dir> [destination] [--vertical]}"
shift
DEST_DIR="./launch/remotion"
DEST_SET=""
VERTICAL=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --vertical) VERTICAL="--vertical" ;;
    --dest)
      if [ "$#" -lt 2 ] || [ -n "$DEST_SET" ]; then
        echo "usage: render.sh <launch/video dir> [destination | --dest destination] [--vertical]" >&2
        exit 2
      fi
      DEST_DIR="$2"
      DEST_SET="yes"
      shift
      ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *)
      if [ -n "$DEST_SET" ]; then
        echo "provide only one Remotion destination" >&2
        exit 2
      fi
      DEST_DIR="$1"
      DEST_SET="yes"
      ;;
  esac
  shift
done
HERE="$(cd "$(dirname "$0")" && pwd -P)"
SRC_DIR="$(cd "$SRC_DIR" && pwd -P)"

# Resolve before any writes, including symlinks and nonexistent destinations.
DEST_DIR="$(python3 -B - "$HERE" "$SRC_DIR" "$DEST_DIR" <<'PY'
import json
import sys
from pathlib import Path

skill, source, dest = (Path(p).resolve() for p in sys.argv[1:])
skill_root = skill.parent.parent  # hack-gtm, including its other installed files
if dest == skill_root or skill_root in dest.parents or dest in skill_root.parents:
    sys.exit("Remotion destination must be outside the installed skill")
if source == skill_root or skill_root in source.parents:
    sys.exit("Video input/output directory must be outside the installed skill")
if any((source / name).is_symlink() for name in ("showcase.mp4", "showcase-vertical.mp4")):
    sys.exit("Video output files must not be symlinks")
if dest == source or dest in source.parents or source in dest.parents:
    sys.exit("Remotion destination must be separate from the video input directory")
if dest.exists() and any(dest.iterdir()):
    try:
        project = json.loads((dest / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit("Remotion destination must be empty or an existing hack-gtm-showcase working copy")
    if project.get("name") != "hack-gtm-showcase":
        sys.exit("Remotion destination contains a different project")
print(dest.as_posix())
PY
)"

# A drafted placeholder must never reach the video. Check before installing anything.
python3 -B - "$HERE/.." "$SRC_DIR/storyboard.json" <<'PY'
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from evidence_to_storyboard import refuse_placeholders

refuse_placeholders(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")))
PY

mkdir -p "$DEST_DIR"
cd "$DEST_DIR"
# Replace only generated files inside this project's working copy. Unlink files
# first so existing symlinks cannot redirect a copy into the installed skill.
for d in node_modules package-lock.json .npm-cache .cache; do
  if [ -L "$d" ]; then
    echo "Remotion dependency/cache paths must be inside the destination" >&2
    exit 2
  fi
done
export npm_config_cache="$DEST_DIR/.npm-cache"
export XDG_CACHE_HOME="$DEST_DIR/.cache"
rm -f package.json tsconfig.json
rm -rf src public out
mkdir -p public out
# Keep dependencies, the copied storyboard and screenshots, and renders out of the person's repo.
printf 'node_modules/\npublic/\nout/\n.npm-cache/\n.cache/\n' > .gitignore
cp "$HERE/package.json" "$HERE/tsconfig.json" .
cp -R "$HERE/src" ./src
python3 -B - "$HERE/.." "$SRC_DIR/storyboard.json" ./public/storyboard.json <<'PY'
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from evidence_to_storyboard import redact_data

source, dest = (Path(p) for p in sys.argv[2:])
storyboard = redact_data(json.loads(source.read_text(encoding="utf-8")))
dest.write_text(json.dumps(storyboard, indent=2), encoding="utf-8")
PY
for d in steps assets audio; do
  if [ -d "$SRC_DIR/$d" ]; then
    cp -R "$SRC_DIR/$d" ./public/
  fi
done

if [ ! -d node_modules ]; then
  echo "installing remotion (first run only)..."
  npm install --no-audit --no-fund
fi

if [ "$VERTICAL" = "--vertical" ]; then
  npm exec -- remotion render src/index.ts ShowcaseVertical out/showcase-vertical.mp4 --codec h264
  cp ./out/showcase-vertical.mp4 "$SRC_DIR/showcase-vertical.mp4"
  echo "wrote $SRC_DIR/showcase-vertical.mp4"
else
  npm exec -- remotion render src/index.ts Showcase out/showcase.mp4 --codec h264
  cp ./out/showcase.mp4 "$SRC_DIR/showcase.mp4"
  echo "wrote $SRC_DIR/showcase.mp4"
fi
