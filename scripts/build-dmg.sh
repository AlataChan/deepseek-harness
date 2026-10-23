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
# Internal builds may use modified source and record it; public builds require clean source.
# Every mode requires a completed root build at the same HEAD with matching Client artifacts.
#
# Prerequisites: built Tauri app, pnpm, node, create-dmg (brew install create-dmg)
# Public mode requires preparation/readiness before credential import; signing never runs bundled code.
# Usage: bash scripts/build-dmg.sh [--arch arm64|x64] [--prepare-only|--sign-prepared]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH=arm64
PHASE=complete
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="${2:?Missing architecture}"; shift 2 ;;
    --prepare-only) PHASE=prepare; shift ;;
    --sign-prepared) PHASE=sign; shift ;;
    arm64|x64) ARCH="$1"; shift ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done
[[ "$ARCH" == arm64 || "$ARCH" == x64 ]] || exit 1

NODE_VERSION="24.14.0"
APP_NAME="octopus_DSH"
APP_BUNDLE="$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
BUILD_MODE="${DSH_DESKTOP_BUILD_MODE:-internal}"
if [[ "$BUILD_MODE" == public && "$PHASE" == complete ]]; then
  printf 'Public builds require --prepare-only before importing credentials, then --sign-prepared.\n' >&2
  exit 1
fi
ARTIFACT_DIR="${DSH_DESKTOP_ARTIFACT_DIR:-$REPO_ROOT/dist}"
RELEASE_VERSION="$(node -p "require('$REPO_ROOT/apps/cli/package.json').version")"
DMG_OUTPUT="$ARTIFACT_DIR/${APP_NAME}.dmg"
if [[ "$BUILD_MODE" == public ]]; then DMG_OUTPUT="$ARTIFACT_DIR/${APP_NAME}-${RELEASE_VERSION}-macos-${ARCH}.dmg"; fi
node --import tsx/esm "$REPO_ROOT/scripts/verify-desktop-release.ts" config-preflight "$BUILD_MODE" "macos-$ARCH"
if [[ "$PHASE" != prepare ]]; then
  node --import tsx/esm "$REPO_ROOT/scripts/verify-desktop-release.ts" preflight "$BUILD_MODE" "macos-$ARCH"
fi
SIGN_ARGS=(--sign - --timestamp=none)
if [[ "$BUILD_MODE" == public ]]; then SIGN_ARGS=(--sign "$DSH_MAC_SIGNING_IDENTITY" --options runtime --timestamp); fi

info()  { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────

if [[ ! -d "$APP_BUNDLE" ]]; then
  fail "Tauri app bundle not found at $APP_BUNDLE — run 'pnpm tauri build' first"
fi

RESOURCES="$APP_BUNDLE/Contents/Resources/resources"
if [[ "$PHASE" != sign ]]; then
# Failed preparation must not leave an earlier successful seal reusable.
rm -f "${APP_BUNDLE}.prepared.json"
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

# Embedding invalidates the prior signature. Preparation uses ad-hoc signing
# for readiness; public signing follows verified preparation.
fi
info "Validating the $BUILD_MODE application before signing..."
node "$REPO_ROOT/scripts/desktop-microphone.mjs" --apply "$APP_BUNDLE"
node --import tsx/esm "$REPO_ROOT/scripts/desktop-release-cli.ts" identity "$RESOURCES/build-info.json" "$BUILD_MODE"
if [[ "$PHASE" == sign ]]; then
  node --import tsx/esm "$REPO_ROOT/scripts/desktop-macos-preparation.ts" verify "$APP_BUNDLE" "$ARCH" "$BUILD_MODE"
else
  # The readiness check executes bundled code before a Developer ID key is imported.
  node --import tsx/esm "$REPO_ROOT/scripts/sign-desktop-macos.ts" --prepare "$APP_BUNDLE"
  /usr/bin/codesign --force --deep --sign - --timestamp=none "$APP_BUNDLE"
  /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
  node --import tsx/esm "$REPO_ROOT/scripts/desktop-macos-preparation.ts" refresh "$APP_BUNDLE"
  /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
  info "Running readiness checklist before sealing prepared bytes..."
  if ! bash "$REPO_ROOT/scripts/verify-desktop-bundle.sh" "$APP_BUNDLE"; then
    fail "Readiness checklist failed — no prepared application or DMG produced"
  fi
  if [[ "$PHASE" == prepare ]]; then
    node --import tsx/esm "$REPO_ROOT/scripts/desktop-macos-preparation.ts" record "$APP_BUNDLE" "$ARCH" "$BUILD_MODE"
    ok "Readiness-verified application prepared; import signing credentials before --sign-prepared"
    exit 0
  fi
fi
if [[ "$BUILD_MODE" == public ]]; then
  node --import tsx/esm "$REPO_ROOT/scripts/sign-desktop-macos.ts" "$APP_BUNDLE" \
    "$DSH_MAC_SIGNING_IDENTITY" "$DSH_MAC_TEAM_ID" "$REPO_ROOT/scripts/desktop-node-entitlements.plist"
  /usr/bin/codesign --force --entitlements "$REPO_ROOT/scripts/desktop-app-entitlements.plist" "${SIGN_ARGS[@]}" "$APP_BUNDLE"
fi
if ! /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"; then
  fail "codesign --verify failed after embedding"
fi
ok "Bundle signature verified ($BUILD_MODE)"

# Prepared public inputs already passed readiness before the signing key was imported.
# The workflow repeats mounted checks only after removing the signing keychain.

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
  /usr/bin/codesign --force --sign "$DSH_MAC_SIGNING_IDENTITY" --timestamp "$DMG_OUTPUT"
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
