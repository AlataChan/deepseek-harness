#!/bin/bash
# Copy octopus_DSH to /Applications, clear Gatekeeper quarantine, then open.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/octopus_DSH.app"
DEST="/Applications/octopus_DSH.app"

alert() {
  osascript -e "display dialog \"$1\" buttons {\"好\"} default button 1 with title \"octopus_DSH\""
}

if [[ ! -d "$APP" ]]; then
  alert "找不到 octopus_DSH.app。请先双击打开 DMG，再运行这个安装脚本。"
  exit 1
fi

rm -rf "$DEST"
ditto "$APP" "$DEST"
xattr -cr "$DEST" || true
open "$DEST"
alert "已经装到「应用程序」。如果图标仍打不开，打开「终端」粘贴：xattr -cr /Applications/octopus_DSH.app"
