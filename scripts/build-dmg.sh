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
if [[ "${1:-}" == "--arch" ]]; then ARCH="${2:-arm64}"; fi

NODE_VERSION="24.14.0"
APP_NAME="octopus_DSH"
APP_BUNDLE="$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
BUILD_MODE="${DSH_DESKTOP_BUILD_MODE:-internal}"
ARTIFACT_DIR="${DSH_DESKTOP_ARTIFACT_DIR:-$REPO_ROOT/dist}"
RELEASE_VERSION="$(node -p "require('$REPO_ROOT/apps/cli/package.json').version")"
DMG_OUTPUT="$ARTIFACT_DIR/${APP_NAME}.dmg"
if [[ "$BUILD_MODE" == public ]]; then DMG_OUTPUT="$ARTIFACT_DIR/${APP_NAME}-${RELEASE_VERSION}-macos-${ARCH}.dmg"; fi
node --import tsx/esm "$REPO_ROOT/scripts/verify-desktop-release.ts" preflight "$BUILD_MODE" "macos-$ARCH"
SIGN_ARGS=(--sign - --timestamp=none)
if [[ "$BUILD_MODE" == public ]]; then SIGN_ARGS=(--sign "$DSH_MAC_SIGNING_IDENTITY" --options runtime --timestamp); fi

info()  { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────

if [[ ! -d "$APP_BUNDLE" ]]; then
  fail "Tauri app bundle not found at $APP_BUNDLE — run 'pnpm tauri build' first"
fi

# Tauri can leave a Contents tree that has Resources and Info.plist but no
# MacOS executable. Embedding then spends minutes only to fail the readiness
# gate. Restore from the cargo release binary when that skeleton is hollow.
CARGO_BIN="$REPO_ROOT/apps/desktop/src-tauri/target/release/dsh-desktop"
MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
MACOS_BIN="$MACOS_DIR/dsh-desktop"
if [[ ! -x "$MACOS_BIN" ]]; then
  [[ -x "$CARGO_BIN" ]] \
    || fail "Tauri binary missing at $MACOS_BIN and $CARGO_BIN — run 'cd apps/desktop && cargo tauri build'"
  info "Restoring Contents/MacOS/dsh-desktop from cargo release binary"
  mkdir -p "$MACOS_DIR"
  cp "$CARGO_BIN" "$MACOS_BIN"
  chmod +x "$MACOS_BIN"
fi
[[ -x "$MACOS_BIN" ]] || fail "Contents/MacOS/dsh-desktop is not executable after restore"

RESOURCES="$APP_BUNDLE/Contents/Resources/resources"
mkdir -p "$RESOURCES"

# Runtime accepts nested or flat CLI; the readiness gate requires nested.
CLI_NESTED="$RESOURCES/installed-runtime-cli.js"
if [[ ! -f "$CLI_NESTED" ]]; then
  CLI_FLAT="$APP_BUNDLE/Contents/Resources/installed-runtime-cli.js"
  CLI_GENERATED="$REPO_ROOT/apps/desktop/src-tauri/resources/installed-runtime-cli.js"
  CLI_SOURCE="$REPO_ROOT/packages/boot/installed-runtime/lib/cli.js"
  if [[ -f "$CLI_FLAT" ]]; then
    cp "$CLI_FLAT" "$CLI_NESTED"
  elif [[ -f "$CLI_GENERATED" ]]; then
    cp "$CLI_GENERATED" "$CLI_NESTED"
  elif [[ -f "$CLI_SOURCE" ]]; then
    cp "$CLI_SOURCE" "$CLI_NESTED"
  else
    fail "installed-runtime-cli.js missing — build packages/boot/installed-runtime"
  fi
fi
[[ -f "$CLI_NESTED" ]] || fail "installed-runtime-cli.js missing at $CLI_NESTED"

ICON_SRC="$REPO_ROOT/apps/desktop/src-tauri/icons/icon.icns"
ICON_DST="$APP_BUNDLE/Contents/Resources/icon.icns"
[[ -f "$ICON_SRC" ]] || fail "icon.icns missing at $ICON_SRC"
info "Refreshing Contents/Resources/icon.icns"
cp "$ICON_SRC" "$ICON_DST"
[[ -f "$ICON_DST" ]] || fail "Contents/Resources/icon.icns missing after restore"

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
# Presets ship as composition rows (the agent-preset/agent-preset-registry
# packages); the pre-split standalone preset directory no longer exists.
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

info "Recording the seed revision..."
node "$REPO_ROOT/scripts/write-seed-rev.mjs" "$RESOURCES" \
  || fail "Failed to record the seed revision"
ok "Seed revision recorded"

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
info "Signing the $BUILD_MODE bundle after embedding..."
node "$REPO_ROOT/scripts/desktop-microphone.mjs" --apply "$APP_BUNDLE"
node --import tsx/esm "$REPO_ROOT/scripts/desktop-release-cli.ts" identity "$RESOURCES/build-info.json"
NODE_SIGN_ARGS=()
if [[ "$BUILD_MODE" == public ]]; then NODE_SIGN_ARGS=(--entitlements "$REPO_ROOT/scripts/desktop-node-entitlements.plist"); fi
codesign --force "${SIGN_ARGS[@]}" ${NODE_SIGN_ARGS[@]+"${NODE_SIGN_ARGS[@]}"} "$RESOURCES/node"
if [[ -x "$RESOURCES/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar" ]]; then
  codesign --force "${SIGN_ARGS[@]}" \
    "$RESOURCES/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar"
fi
while IFS= read -r lib; do
  [[ -z "$lib" ]] && continue
  codesign --force "${SIGN_ARGS[@]}" "$lib"
done < <(find "$RESOURCES/kb-runtime" \( -name '*.so' -o -name '*.dylib' \) -type f 2>/dev/null)
if [[ "$BUILD_MODE" == public ]]; then
  while IFS= read -r -d '' native_library; do
    codesign --force "${SIGN_ARGS[@]}" "$native_library"
  done < <(find "$RESOURCES" -type f \( -name '*.node' -o -name Python \) -print0)
fi
ROOT_SIGN_ARGS=(--deep)
if [[ "$BUILD_MODE" == public ]]; then ROOT_SIGN_ARGS=(); fi
codesign --force ${ROOT_SIGN_ARGS[@]+"${ROOT_SIGN_ARGS[@]}"} "${SIGN_ARGS[@]}" "$APP_BUNDLE"
if ! codesign --verify --deep "$APP_BUNDLE"; then
  fail "codesign --verify failed after embedding"
fi
ok "Bundle re-signed ($BUILD_MODE)"

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
node "$REPO_ROOT/scripts/stage-desktop-dmg.mjs" "$BUILD_MODE" "$APP_BUNDLE" "$STAGE"
DMG_HELPER_ARGS=()
if [[ "$BUILD_MODE" == internal ]]; then
  chmod +x "$STAGE/安装并打开.command"
  DMG_HELPER_ARGS=(--icon "安装并打开.command" 560 180)
fi

if command -v create-dmg &>/dev/null; then
  create-dmg \
    --volname "$APP_NAME" \
    --window-pos 200 120 \
    --window-size 720 440 \
    --icon-size 80 \
    --icon "$APP_NAME.app" 140 180 \
    --app-drop-link 360 180 \
    ${DMG_HELPER_ARGS[@]+"${DMG_HELPER_ARGS[@]}"} \
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
if [[ "$BUILD_MODE" == public ]]; then
  codesign --force --sign "$DSH_MAC_SIGNING_IDENTITY" --timestamp "$DMG_OUTPUT"
  xcrun notarytool submit "$DMG_OUTPUT" --keychain-profile "$DSH_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_OUTPUT"
  xcrun stapler validate "$DMG_OUTPUT"
fi
node --import tsx/esm "$REPO_ROOT/scripts/desktop-release-cli.ts" manifest "$DMG_OUTPUT" "$RESOURCES" "macos-$ARCH" "$BUILD_MODE" "$DMG_OUTPUT.release.json" "$APP_BUNDLE"
ok "Done! Distribute: $DMG_OUTPUT"
echo ""
echo "  微信发出后请附带这段话："
echo "  若提示「已损坏」，不是文件坏了。把 app 拖到应用程序，打开终端粘贴："
echo "  xattr -cr /Applications/octopus_DSH.app"
echo "  然后再从启动台打开。也可双击 DMG 里的「安装并打开.command」。"
echo ""
