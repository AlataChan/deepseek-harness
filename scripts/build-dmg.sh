#!/usr/bin/env bash
# Build a self-contained DMG for macOS distribution.
#
# The resulting .app contains:
#   Resources/resources/node          — Node.js binary (arm64 or x64)
#   Resources/resources/harness/      — @deepseek-ai/dsh package (with desktop-companion)
#   Resources/resources/presets/      — bundled presets (copied to ~/.dsh on first run)
#   Resources/resources/profile-plugins/ — fork-owned profile bundles (npm + workspace pins)
#   Resources/resources/bundled-skills/   — fork-owned skills seeded to ~/.dsh/skills on launch
#   Resources/resources/kb-runtime/     — relocatable octopus-kb PyInstaller onedir
#
# After opening the app, users only need to enter their API Key.
#
# Prerequisites: built Tauri app, pnpm, node, create-dmg (brew install create-dmg)
# Usage: bash scripts/build-dmg.sh [--arch arm64|x64]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-arm64}"
if [[ "$1" == "--arch" ]]; then ARCH="${2:-arm64}"; fi

NODE_VERSION="24.14.0"
APP_NAME="octopus_DSH"
APP_BUNDLE="$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DMG_OUTPUT="$REPO_ROOT/dist/${APP_NAME}.dmg"

info()  { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────

if [[ ! -d "$APP_BUNDLE" ]]; then
  fail "Tauri app bundle not found at $APP_BUNDLE — run 'pnpm tauri build' first"
fi

RESOURCES="$APP_BUNDLE/Contents/Resources/resources"
mkdir -p "$RESOURCES"

# ── 1. Download Node.js ─────────────────────────────────────────────────────

NODE_PLATFORM="darwin"
NODE_ARCH="$ARCH"
NODE_TARBALL="node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
NODE_CACHE="$REPO_ROOT/dist/.cache/${NODE_TARBALL}"

if [[ ! -f "$NODE_CACHE" ]]; then
  info "Downloading Node.js v${NODE_VERSION} (${NODE_ARCH})..."
  mkdir -p "$(dirname "$NODE_CACHE")"
  curl -fSL "$NODE_URL" -o "$NODE_CACHE"
fi

info "Extracting Node binary..."
NODE_EXTRACTED="$REPO_ROOT/dist/.cache/node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}"
if [[ ! -d "$NODE_EXTRACTED" ]]; then
  tar -xzf "$NODE_CACHE" -C "$REPO_ROOT/dist/.cache/"
fi
cp "$NODE_EXTRACTED/bin/node" "$RESOURCES/node"
chmod +x "$RESOURCES/node"
ok "Node binary embedded"

# ── 2. Build and pack harness ───────────────────────────────────────────────

# NOTE: 'pnpm run build' must have been run before this script.
# The script uses the cached deploy from dist/.cache/harness-deploy/ if available.

info "Assembling harness package for embedding..."

# `pnpm deploy` cannot be used here: it drops transitive dependencies of the
# vendored `file:vendor/*` packages, which fails at boot with
# ERR_MODULE_NOT_FOUND. collect-runtime-deps.mjs walks the graph with Node's own
# resolver plus the workspace and pnpm-store indexes instead.
CLI_DIR="$REPO_ROOT/apps/cli"
if [[ ! -f "$CLI_DIR/lib/desktop-companion.js" ]]; then
  fail "desktop-companion.js missing — run 'pnpm run build' first"
fi

DEPS_CACHE="$REPO_ROOT/dist/.cache/harness-nm"
if [[ "${REUSE_DEPS:-0}" != "1" || ! -f "$DEPS_CACHE/.collect-manifest.json" ]]; then
  info "Collecting runtime dependencies..."
  rm -rf "$DEPS_CACHE"
  node "$REPO_ROOT/scripts/collect-runtime-deps.mjs" "$CLI_DIR/package.json" "$DEPS_CACHE"
else
  info "Reusing third-party dep cache; refreshing workspace packages..."
  node "$REPO_ROOT/scripts/collect-runtime-deps.mjs" --refresh-workspace \
    "$CLI_DIR/package.json" "$DEPS_CACHE" \
    || fail "Failed to refresh workspace packages in $DEPS_CACHE"
fi

rm -rf "$RESOURCES/harness"
mkdir -p "$RESOURCES/harness"
cp -R "$CLI_DIR/lib" "$RESOURCES/harness/lib"
cp -R "$CLI_DIR/config" "$RESOURCES/harness/config"
cp "$CLI_DIR/package.json" "$RESOURCES/harness/package.json"
cp -R "$DEPS_CACHE" "$RESOURCES/harness/node_modules"
SHIPPED_PRESETS="$REPO_ROOT/packages/preset/agent-presets/presets"
if [[ ! -d "$SHIPPED_PRESETS/standard" ]]; then
  fail "shipped standard preset missing at $SHIPPED_PRESETS/standard"
fi
mkdir -p "$RESOURCES/harness/config/agent-presets"
cp -R "$SHIPPED_PRESETS/." "$RESOURCES/harness/config/agent-presets/"
ok "Harness package + dependencies embedded (self-contained)"

# ── 3. Bundle presets ───────────────────────────────────────────────────────

info "Bundling presets..."
PRESET_RESOURCES="$RESOURCES/presets"
rm -rf "$PRESET_RESOURCES"
mkdir -p "$PRESET_RESOURCES"

# Copy the env-ngo preset if available
ENV_NGO_SRC="$HOME/Documents/4.0 Sanyuan/2.4 环境公益\"新\"力量/course/dsh-env-ngo/presets/env-ngo-project-assistant"
if [[ -d "$ENV_NGO_SRC" ]]; then
  cp -R "$ENV_NGO_SRC" "$PRESET_RESOURCES/env-ngo-project-assistant"
  ok "公益项目助手 preset bundled"
else
  info "env-ngo preset not found at source, skipping"
fi

info "Fetching desktop profile plugins..."
PLUGIN_RESOURCES="$RESOURCES/profile-plugins"
rm -rf "$PLUGIN_RESOURCES"
node "$REPO_ROOT/scripts/seed-desktop-profile-plugin.mjs" fetch --out "$PLUGIN_RESOURCES" \
  || fail "Failed to fetch desktop profile plugins"
ok "Desktop profile plugins embedded"

info "Preparing bundled skills..."
SKILL_RESOURCES="$RESOURCES/bundled-skills"
rm -rf "$SKILL_RESOURCES"
node "$REPO_ROOT/scripts/seed-desktop-bundled-skills.mjs" --out "$SKILL_RESOURCES" \
  || fail "Failed to prepare bundled skills"
ok "Bundled skills embedded"

# ── 3b. Embed relocatable Python sidecar ────────────────────────────────────

info "Freezing and embedding kb-runtime..."
if [[ "${REUSE_KB_RUNTIME:-0}" == "1" && -x "$REPO_ROOT/dist/.cache/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar" ]]; then
  info "Reusing dist/.cache/kb-runtime (REUSE_KB_RUNTIME=1)"
else
  bash "$REPO_ROOT/scripts/build-kb-sidecar.sh" || fail "Failed to freeze octopus-kb-sidecar"
fi
rm -rf "$RESOURCES/kb-runtime"
ditto "$REPO_ROOT/dist/.cache/kb-runtime" "$RESOURCES/kb-runtime"
[[ -x "$RESOURCES/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar" ]] \
  || fail "kb-runtime missing octopus-kb-sidecar after embed"
ok "kb-runtime embedded"

# Embedding files after `tauri build` invalidates the bundle signature.
# Resign here so Gatekeeper does not report a stale signature as “已损坏”.
# Ad-hoc signing is not Apple notarization; the DMG still ships an installer
# that clears quarantine on the user's machine.
info "Ad-hoc signing the bundle after embedding..."
codesign --force --sign - --timestamp=none "$RESOURCES/node"
if [[ -x "$RESOURCES/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar" ]]; then
  codesign --force --sign - --timestamp=none \
    "$RESOURCES/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar"
fi
while IFS= read -r lib; do
  [[ -z "$lib" ]] && continue
  codesign --force --sign - --timestamp=none "$lib" || true
done < <(find "$RESOURCES/kb-runtime" \( -name '*.so' -o -name '*.dylib' \) -type f 2>/dev/null)
codesign --force --deep --sign - --timestamp=none "$APP_BUNDLE"
if ! codesign --verify --deep "$APP_BUNDLE"; then
  fail "codesign --verify failed after embedding"
fi
ok "Bundle re-signed (adhoc)"

# ── 4. Readiness gate ───────────────────────────────────────────────────────
#
# The bundle is smoke-tested before it can become a DMG: a companion that
# cannot resolve its own module graph, or a symlink into this build machine,
# fails here rather than on a user's laptop.

info "Running readiness checklist..."
if ! bash "$REPO_ROOT/scripts/verify-desktop-bundle.sh" "$APP_BUNDLE"; then
  fail "Readiness checklist failed — no DMG produced"
fi

# ── 5. Create DMG ───────────────────────────────────────────────────────────

info "Creating DMG..."
mkdir -p "$(dirname "$DMG_OUTPUT")"
rm -f "$DMG_OUTPUT"

STAGE="$REPO_ROOT/dist/.cache/dmg-root"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP_BUNDLE" "$STAGE/${APP_NAME}.app"
cp "$REPO_ROOT/scripts/dmg-payload/安装说明.txt" "$STAGE/安装说明.txt"
cp "$REPO_ROOT/scripts/dmg-payload/安装并打开.command" "$STAGE/安装并打开.command"
chmod +x "$STAGE/安装并打开.command"

if command -v create-dmg &>/dev/null; then
  create-dmg \
    --volname "$APP_NAME" \
    --window-pos 200 120 \
    --window-size 720 440 \
    --icon-size 80 \
    --icon "$APP_NAME.app" 140 180 \
    --app-drop-link 360 180 \
    --icon "安装并打开.command" 560 180 \
    "$DMG_OUTPUT" \
    "$STAGE" || true
  # create-dmg exits 2 when signing is skipped; the DMG is still usable
  if [[ -f "$DMG_OUTPUT" ]]; then
    ok "DMG created at $DMG_OUTPUT"
  else
    hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG_OUTPUT"
    ok "DMG created at $DMG_OUTPUT (hdiutil fallback)"
  fi
else
  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG_OUTPUT"
  ok "DMG created at $DMG_OUTPUT"
fi

echo ""
ok "Done! Distribute: $DMG_OUTPUT"
echo ""
echo "  微信发出后请附带这段话："
echo "  若提示「已损坏」，不是文件坏了。把 app 拖到应用程序，打开终端粘贴："
echo "  xattr -cr /Applications/octopus_DSH.app"
echo "  然后再从启动台打开。也可双击 DMG 里的「安装并打开.command」。"
echo ""
