#!/usr/bin/env bash
# Render the showcase video with Remotion.
# Usage: render.sh <launch/video dir> [--vertical]
# Expects <dir>/storyboard.json plus steps/, assets/, audio/ next to it (as written by
# evidence_to_storyboard.py and tts.py). Output: <dir>/showcase.mp4 (or showcase-vertical.mp4).
set -euo pipefail

SRC_DIR="${1:?usage: render.sh <launch/video dir> [--vertical]}"
VERTICAL="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SRC_DIR" && pwd)"

cd "$HERE"
rm -rf public && mkdir -p public out
cp "$SRC_DIR/storyboard.json" public/
for d in steps assets audio; do
  [ -d "$SRC_DIR/$d" ] && cp -R "$SRC_DIR/$d" public/
done

if [ ! -d node_modules ]; then
  echo "installing remotion (first run only)..."
  npm install --no-audit --no-fund
fi

if [ "$VERTICAL" = "--vertical" ]; then
  npx remotion render src/index.ts ShowcaseVertical out/showcase-vertical.mp4 --codec h264
  cp out/showcase-vertical.mp4 "$SRC_DIR/showcase-vertical.mp4"
  echo "wrote $SRC_DIR/showcase-vertical.mp4"
else
  npx remotion render src/index.ts Showcase out/showcase.mp4 --codec h264
  cp out/showcase.mp4 "$SRC_DIR/showcase.mp4"
  echo "wrote $SRC_DIR/showcase.mp4"
fi
