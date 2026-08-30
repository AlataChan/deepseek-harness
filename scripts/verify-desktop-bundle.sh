#!/usr/bin/env bash
# Readiness checklist for the self-contained desktop .app.
#
# Every check runs against the BUILT bundle, not the source tree, and every
# check fails loud. `build-dmg.sh` runs this before creating the DMG, so a
# broken bundle can never reach a user.
#
# Usage: bash scripts/verify-desktop-bundle.sh [path-to-.app]

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/octopus_DSH.app}"
RES="$APP/Contents/Resources/resources"

PASS=0
FAIL=0

ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$1"; FAIL=$((FAIL+1)); }
head_() { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }

head_ "Checking $APP"

# ── 1. Bundle skeleton ──────────────────────────────────────────────────────

[[ -x "$APP/Contents/MacOS/dsh-desktop" ]] \
  && ok "Tauri binary present and executable" \
  || bad "Tauri binary missing at Contents/MacOS/dsh-desktop"

[[ -f "$RES/installed-runtime-cli.js" ]] \
  && ok "installed-runtime-cli.js bundled" \
  || bad "installed-runtime-cli.js missing"

# ── 2. Embedded Node ────────────────────────────────────────────────────────

if [[ -x "$RES/node" ]]; then
  NODE_VER="$("$RES/node" --version 2>/dev/null || echo "")"
  if [[ -n "$NODE_VER" ]]; then
    ok "Embedded Node runs: $NODE_VER"
  else
    bad "Embedded Node exists but will not execute (wrong arch? quarantine?)"
  fi
else
  bad "Embedded Node missing at Resources/resources/node"
fi

# ── 3. Embedded harness manifest ────────────────────────────────────────────

HARNESS="$RES/harness"
if [[ -f "$HARNESS/package.json" ]]; then
  ok "Harness package.json present"
  DECLARED="$("$RES/node" -e "
    const p = require('$HARNESS/package.json');
    process.stdout.write(p.dsh?.companions?.desktop ?? '');
  " 2>/dev/null)"
  if [[ -n "$DECLARED" ]]; then
    ok "dsh.companions.desktop declared: $DECLARED"
  else
    bad "dsh.companions.desktop NOT declared — Tauri will reject this runtime"
  fi
else
  bad "Harness package.json missing"
fi

[[ -f "$HARNESS/lib/desktop-companion.js" ]] \
  && ok "desktop-companion.js present" \
  || bad "desktop-companion.js MISSING — this is the npm-publish gap"

[[ -d "$HARNESS/config/agent-presets/standard" ]] \
  && ok "shipped standard preset present" \
  || bad "shipped agent-presets missing from bundle"

# ── 4. Module graph resolves (the check that catches ERR_MODULE_NOT_FOUND) ───
#
# Running the companion bare must fail with its OWN startup diagnostic, not with
# a module-resolution error. Reaching its own error proves every import in the
# graph resolved inside the bundle.

head_ "Smoke-testing companion module graph"
COMPANION_OUT="$("$RES/node" "$HARNESS/lib/desktop-companion.js" --workspace-root "$HOME" 2>&1 | head -40 || true)"

if grep -q "ERR_MODULE_NOT_FOUND" <<<"$COMPANION_OUT"; then
  MISSING="$(grep -o "Cannot find package '[^']*'" <<<"$COMPANION_OUT" | head -1)"
  bad "Module graph BROKEN: $MISSING"
  printf '\033[0;90m%s\033[0m\n' "$(head -6 <<<"$COMPANION_OUT")"
elif grep -qE "Cannot find module|ERR_PACKAGE_PATH_NOT_EXPORTED" <<<"$COMPANION_OUT"; then
  bad "Module graph BROKEN (path/export failure)"
  printf '\033[0;90m%s\033[0m\n' "$(head -6 <<<"$COMPANION_OUT")"
elif grep -qE "stdio carrier|IPC channel|connected" <<<"$COMPANION_OUT"; then
  ok "Module graph resolves (companion reached its own IPC startup check)"
elif [[ -z "$COMPANION_OUT" ]]; then
  bad "Companion produced no output — cannot confirm the module graph"
else
  bad "Companion failed for an unexpected reason:"
  printf '\033[0;90m%s\033[0m\n' "$(head -8 <<<"$COMPANION_OUT")"
fi

# ── 5. Companion lifecycle (the check that catches "Broken pipe") ───────────
#
# Module resolution is not liveness: a companion can import everything, answer
# `control/ready`, and then exit, at which point the shell's next stdin write
# fails and the window reports "companion stdin write failed: Broken pipe".
# Only a real handshake plus a hold period observes that.

head_ "Driving a real companion handshake"
if LIFECYCLE_OUT="$("$RES/node" "$REPO_ROOT/scripts/smoke-companion-lifecycle.mjs" "$APP" 6000 2>&1)"; then
  ok "$(head -2 <<<"$LIFECYCLE_OUT" | tail -1)"
else
  bad "Companion lifecycle FAILED"
  printf '\033[0;90m%s\033[0m\n' "$(head -12 <<<"$LIFECYCLE_OUT")"
fi

# ── 6. No leaked developer paths ────────────────────────────────────────────
#
# A symlink or absolute path into the build machine's checkout works here and
# breaks on every other machine, which is exactly the class of failure the
# earlier builds shipped.

head_ "Checking for developer-machine leaks"
LEAKED_LINKS="$(find "$HARNESS/node_modules" -maxdepth 3 -type l 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$LEAKED_LINKS" == "0" ]]; then
  ok "No symlinks in bundled node_modules"
else
  BROKEN="$(find "$HARNESS/node_modules" -maxdepth 3 -type l ! -exec test -e {} \; -print 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$BROKEN" == "0" ]]; then
    ok "$LEAKED_LINKS symlinks present but all resolve inside the bundle"
  else
    bad "$BROKEN broken symlinks in bundled node_modules (point outside the .app)"
  fi
fi

ESCAPES="$(find "$HARNESS/node_modules" -maxdepth 3 -type l -lname "$REPO_ROOT/*" 2>/dev/null | wc -l | tr -d ' ')"
[[ "$ESCAPES" == "0" ]] \
  && ok "No symlink points back into the source checkout" \
  || bad "$ESCAPES symlink(s) point into $REPO_ROOT — will break on a user machine"

# ── 7. Bundled presets ──────────────────────────────────────────────────────

if [[ -d "$RES/presets" ]]; then
  COUNT="$(find "$RES/presets" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
  if [[ "$COUNT" -gt 0 ]]; then
    ok "$COUNT bundled preset(s) for first-run install"
    for preset in "$RES/presets"/*/; do
      NAME="$(basename "$preset")"
      [[ -f "$preset/preset.yml" && -f "$preset/agent.cordis.yml" ]] \
        && ok "  $NAME: preset.yml + agent.cordis.yml present" \
        || bad "  $NAME: incomplete (missing preset.yml or agent.cordis.yml)"
    done
  else
    bad "presets/ exists but is empty"
  fi
else
  bad "No bundled presets — first run will not install 公益项目助手"
fi

# ── 7b. Fork-owned desktop profile plugins ───────────────────────────────────
#
# The official desktop profile template does not include community or
# experimental overlay bundles. octopus_DSH seeds every pin from
# Resources/profile-plugins/ into ~/.dsh/profiles/desktop on first launch.
# A missing or incomplete copy means that overlay never appears for a new user.

head_ "Checking bundled desktop profile plugins"
PIN="$REPO_ROOT/scripts/desktop-profile-plugins.json"
if [[ -f "$PIN" ]]; then
  ok "desktop-profile-plugins.json present"
else
  bad "desktop-profile-plugins.json missing"
fi

while IFS= read -r dest; do
  [[ -z "$dest" ]] && continue
  plugin_dir="$RES/profile-plugins/$dest"
  if [[ -d "$plugin_dir" ]]; then
    if "$RES/node" "$REPO_ROOT/scripts/seed-desktop-profile-plugin.mjs" validate --dir "$plugin_dir"; then
      ok "$dest is a loadable dsh.bundle + dsh.client package"
    else
      bad "$dest failed seed validation"
    fi
  else
    bad "profile-plugins/$dest missing — overlay will not install on first run"
  fi
done < <(node --input-type=module -e '
import { readFileSync } from "node:fs"
const pin = JSON.parse(readFileSync(process.argv[1], "utf8"))
for (const plugin of pin.plugins) console.log(plugin.name)
' "$PIN")

# session.listEntries lives on the generated Session Remote face. A stale
# session-controller client makes every file-tree listing look unreadable.
head_ "Checking session-controller client knows listEntries"
SESSION_CLIENT="$HARNESS/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.remote-client.js"
if [[ -f "$SESSION_CLIENT" ]] && grep -q 'listEntries' "$SESSION_CLIENT"; then
  ok "bundled session-controller remote face includes listEntries"
else
  bad "bundled session-controller remote face missing listEntries — rebuild that Host face before packaging"
fi

# ── 8. Code signature must be intact after embedding Node / harness ─────────
#
# WeChat and browsers attach com.apple.quarantine. An unsigned or stale
# signature (resources added after the last codesign) is what macOS reports
# as “已损坏”. Developer ID + notarization is the real Gatekeeper pass;
# this check only refuses a broken signature.

head_ "Checking code signature"
if codesign --verify --deep "$APP" 2>/dev/null; then
  SIGN_INFO="$(codesign -dv "$APP" 2>&1 || true)"
  if grep -q "Signature=adhoc\|flags=.*adhoc" <<<"$SIGN_INFO"; then
    ok "Signature is intact (adhoc). Downloaded copies still need xattr -cr or the DMG installer"
  else
    ok "Signature is intact"
  fi
else
  bad "Code signature missing or stale — Gatekeeper will say the app is damaged after a WeChat/browser download"
fi

# ── Result ──────────────────────────────────────────────────────────────────

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  printf '\033[1;32m✓ READY: %s checks passed. Safe to package.\033[0m\n' "$PASS"
  exit 0
fi
printf '\033[1;31m✗ NOT READY: %s failed, %s passed. Do not distribute.\033[0m\n' "$FAIL" "$PASS"
exit 1
