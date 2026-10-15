#!/usr/bin/env bash
# Rasterize the octopus_DSH dock mark into the PNG / ICNS files Tauri bundles.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/octopus-dsh-icon.png"
SET="$ROOT/app.iconset"

if [[ ! -f "$SRC" ]]; then
  echo "render.sh: missing $SRC" >&2
  exit 1
fi

if ! command -v iconutil >/dev/null; then
  echo "render.sh: needs iconutil" >&2
  exit 1
fi

if ! command -v magick >/dev/null; then
  echo "render.sh: needs magick (ImageMagick) so PNG is RGBA" >&2
  exit 1
fi

magick "$SRC" -resize 1024x1024 -alpha set \
  \( -size 1024x1024 xc:none -fill white -draw 'roundrectangle 0,0 1023,1023 224,224' \) \
  -compose DstIn -composite PNG32:"$ROOT/icon.png"

# Windows bundles one multi-size ICO; NSIS and the taskbar pick their size from
# it. `iconutil` is macOS-only, so CI reads the committed file instead.
magick "$ROOT/icon.png" -define icon:auto-resize=256,128,64,48,32,16 "$ROOT/icon.ico"

rm -rf "$SET"
mkdir "$SET"

render_size() {
  local px="$1"
  local name="$2"
  magick "$ROOT/icon.png" -resize "${px}x${px}" -alpha set PNG32:"$SET/$name"
}

render_size 16 icon_16x16.png
render_size 32 icon_16x16@2x.png
render_size 32 icon_32x32.png
render_size 64 icon_32x32@2x.png
render_size 128 icon_128x128.png
render_size 256 icon_128x128@2x.png
render_size 256 icon_256x256.png
render_size 512 icon_256x256@2x.png
render_size 512 icon_512x512.png
render_size 1024 icon_512x512@2x.png

iconutil -c icns "$SET" -o "$ROOT/icon.icns"
rm -rf "$SET"

if [[ ! -s "$ROOT/icon.png" || ! -s "$ROOT/icon.icns" || ! -s "$ROOT/icon.ico" ]]; then
  echo "render.sh: raster output missing" >&2
  exit 1
fi

echo "wrote $ROOT/icon.png, $ROOT/icon.icns, and $ROOT/icon.ico"
