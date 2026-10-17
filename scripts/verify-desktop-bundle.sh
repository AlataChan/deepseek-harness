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
APP="$(cd "$(dirname -- "$APP")" && pwd)/$(basename -- "$APP")"
RES="$APP/Contents/Resources/resources"

PASS=0
FAIL=0

ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$1"; FAIL=$((FAIL+1)); }
head_() { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }

head_ "Checking $APP"

# ── 1. Bundle skeleton ──────────────────────────────────────────────────────

if [[ -x "$APP/Contents/MacOS/dsh-desktop" ]]; then
  ok "Tauri binary present and executable"
elif [[ -e "$APP/Contents/MacOS/dsh-desktop" ]]; then
  bad "Tauri binary exists at Contents/MacOS/dsh-desktop but is not executable"
else
  bad "Tauri binary missing at Contents/MacOS/dsh-desktop"
fi

if [[ -f "$RES/installed-runtime-cli.js" ]]; then
  ok "installed-runtime-cli.js bundled"
elif [[ -f "$APP/Contents/Resources/installed-runtime-cli.js" ]]; then
  bad "installed-runtime-cli.js is flat under Contents/Resources/ — expected Contents/Resources/resources/"
else
  bad "installed-runtime-cli.js missing"
fi

if [[ -f "$APP/Contents/Resources/icon.icns" ]]; then
  ok "icon.icns bundled"
else
  bad "icon.icns missing at Contents/Resources/icon.icns"
fi

if node "$REPO_ROOT/scripts/desktop-microphone.mjs" --check "$APP"; then
  ok "Microphone usage declaration present"
else
  bad "Microphone usage declaration missing or empty"
fi

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
    const { readFileSync } = require('node:fs');
    const p = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    process.stdout.write(p.dsh?.companions?.desktop ?? '');
  " "$HARNESS/package.json")"
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

[[ -d "$HARNESS/node_modules/@deepseek-ai/dsh-agent-preset" && -d "$HARNESS/node_modules/@deepseek-ai/dsh-agent-preset-registry" ]] \
  && ok "composition preset providers present" \
  || bad "composition preset providers missing from bundle"

# ── 4. Module graph resolves (the check that catches ERR_MODULE_NOT_FOUND) ───
#
# Running the companion bare must fail with its OWN startup diagnostic, not with
# a module-resolution error. Reaching its own error proves every import in the
# graph resolved inside the bundle.

head_ "Smoke-testing companion module graph"
SMOKE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/dsh-bundle-smoke.XXXXXX")"
# A live octopus_DSH holds ~/.dsh. The smoke must not inherit the builder's DSH_HOME.
COMPANION_OUT="$(HOME="$SMOKE_HOME" DSH_HOME="$SMOKE_HOME/.dsh" "$RES/node" "$HARNESS/lib/desktop-companion.js" --workspace-root "$SMOKE_HOME" < /dev/null 2>&1 | head -40 || true)"

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

# ── 5. Companion lifecycle with every pinned overlay installed ───────────
#
# Module resolution is not liveness: a companion can import everything, answer
# `control/ready`, and then exit, at which point the shell's next stdin write
# fails and the window reports "companion stdin write failed: Broken pipe".
# A clean DSH_HOME also hides overlay boot failures: the real app copies
# Resources/profile-plugins into ~/.dsh/profiles/desktop, then boots that
# profile. Seed the same overlays here or a pending inject (for example
# Cordis waiting on a service named "optional") passes this gate and then
# times out the user's handshake.

head_ "Driving a real companion handshake with pinned overlays"
SMOKE_PROFILE="$SMOKE_HOME/.dsh/profiles/desktop"
mkdir -p "$SMOKE_PROFILE"
PIN="$REPO_ROOT/scripts/desktop-profile-plugins.json"
while IFS= read -r dest; do
  [[ -z "$dest" ]] && continue
  plugin_dir="$RES/profile-plugins/$dest"
  if [[ -d "$plugin_dir" ]]; then
    if ! "$RES/node" "$REPO_ROOT/scripts/seed-desktop-profile-plugin.mjs" install \
      --from "$plugin_dir" --profile-dir "$SMOKE_PROFILE" >/dev/null; then
      bad "could not install $dest into the smoke desktop profile"
    fi
  fi
done < <(node --input-type=module -e '
import { readFileSync } from "node:fs"
const pin = JSON.parse(readFileSync(process.argv[1], "utf8"))
for (const plugin of pin.plugins) console.log(plugin.name)
' "$PIN")
if LIFECYCLE_OUT="$(HOME="$SMOKE_HOME" DSH_HOME="$SMOKE_HOME/.dsh" "$RES/node" "$REPO_ROOT/scripts/smoke-companion-lifecycle.mjs" "$APP" 6000 2>&1)"; then
  if grep -qE 'did not activate|waiting for service:' <<<"$LIFECYCLE_OUT"; then
    bad "Companion became ready but an overlay did not activate"
    printf '\033[0;90m%s\033[0m\n' "$(head -12 <<<"$LIFECYCLE_OUT")"
  else
    ok "$(head -2 <<<"$LIFECYCLE_OUT" | tail -1)"
  fi
else
  bad "Companion lifecycle FAILED with pinned overlays installed"
  printf '\033[0;90m%s\033[0m\n' "$(head -16 <<<"$LIFECYCLE_OUT")"
fi
rm -rf "$SMOKE_HOME"

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

KB_RUNTIME="$RES/kb-runtime"
if [[ -d "$KB_RUNTIME" ]]; then
  KB_ESCAPES="$(find "$KB_RUNTIME" -type l \( -lname "$REPO_ROOT/*" -o -lname '/*' \) -print 2>/dev/null | wc -l | tr -d ' ')"
  KB_BROKEN="$(find "$KB_RUNTIME" -type l ! -exec test -e {} \; -print 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$KB_ESCAPES" == "0" && "$KB_BROKEN" == "0" ]]; then
    ok "kb-runtime has no escaping or broken symlinks"
  else
    bad "kb-runtime has $KB_ESCAPES escaping and $KB_BROKEN broken symlinks"
  fi
else
  bad "kb-runtime directory missing"
fi

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

if grep -q 'dsh-context' "$PIN"; then
  bad "desktop-profile-plugins.json still names dsh-context — companion boot fails on that leftover"
else
  ok "desktop-profile-plugins.json does not name dsh-context"
fi

if grep -q 'dsh-client-app' "$PIN"; then
  bad "desktop-profile-plugins.json still names dsh-client-app — 0.1.2 base already owns storage"
else
  ok "desktop-profile-plugins.json does not name dsh-client-app"
fi

if awk '/const DESKTOP_SHIPPED_BUNDLES/,/];/' "$REPO_ROOT/apps/desktop/src-tauri/src/app.rs" | grep -q 'dsh-client-app'; then
  bad "DESKTOP_SHIPPED_BUNDLES still lists dsh-client-app — first launch would recreate the storage clash"
else
  ok "app.rs first-launch template does not seed dsh-client-app"
fi

if awk '/id: client-hmr/,/disabled:/' "$REPO_ROOT/packages/bundle/desktop-app/cordis.patch.yml" | grep -q 'disabled: true'; then
  ok "desktop-app disables client-hmr so the Tauri WebView can boot"
else
  bad "desktop-app still leaves client-hmr enabled — WebView reports The operation is insecure"
fi

# Fork-owned skills: Resources/bundled-skills → ~/.dsh/skills on launch.
head_ "Checking bundled skills"
SKILL_PIN="$REPO_ROOT/scripts/desktop-bundled-skills.json"
if [[ -f "$SKILL_PIN" ]]; then
  ok "desktop-bundled-skills.json present"
else
  bad "desktop-bundled-skills.json missing"
fi
if grep -q 'install_bundled_skills' "$REPO_ROOT/apps/desktop/src-tauri/src/app.rs"; then
  ok "app.rs seeds bundled skills on launch"
else
  bad "app.rs missing install_bundled_skills"
fi
if [[ -d "$RES/bundled-skills/wechat-article-extractor" \
   && -f "$RES/bundled-skills/wechat-article-extractor/SKILL.md" \
   && -f "$RES/bundled-skills/wechat-article-extractor/scripts/rate-limit.js" \
   && -d "$RES/bundled-skills/wechat-article-extractor/node_modules" ]]; then
  ok "bundled-skills/wechat-article-extractor present with deps"
else
  bad "bundled-skills/wechat-article-extractor incomplete — desktop users will not get WeChat extract"
fi
if [[ -d "$RES/bundled-skills/archify" \
   && -f "$RES/bundled-skills/archify/SKILL.md" \
   && -f "$RES/bundled-skills/archify/bin/archify.mjs" ]]; then
  ok "bundled-skills/archify present (post-hoc Team diagram skill)"
else
  bad "bundled-skills/archify incomplete — desktop users will not get Archify"
fi
if [[ -d "$RES/bundled-skills/conversation-media-creation" \
   && -f "$RES/bundled-skills/conversation-media-creation/SKILL.md" ]] \
   && grep -q '已请求系统打开文件' "$RES/bundled-skills/conversation-media-creation/SKILL.md"; then
  ok "bundled-skills/conversation-media-creation present with no-playback wording"
else
  bad "bundled-skills/conversation-media-creation incomplete — desktop users will not get the creation skill"
fi
if [[ -d "$RES/bundled-skills/term-glossary" \
   && -f "$RES/bundled-skills/term-glossary/SKILL.md" \
   && -f "$RES/bundled-skills/term-glossary/data/glossary.json" \
   && -f "$RES/bundled-skills/term-glossary/scripts/lookup.mjs" ]]; then
  ok "bundled-skills/term-glossary present (offline term hints)"
else
  bad "bundled-skills/term-glossary incomplete — desktop users will not get term hints"
fi

DIRTY_PROFILE=$(mktemp -d)
printf '%s\n' '{
  "dependencies": { "dsh-context": "0.36.0" },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-client-app",
    "@deepseek-ai/dsh-desktop-app",
    "dsh-context"
  ] } }
}' > "$DIRTY_PROFILE/package.json"
if node "$REPO_ROOT/scripts/seed-desktop-profile-plugin.mjs" heal --profile-dir "$DIRTY_PROFILE"; then
  HEALED=$(node --input-type=module -e '
import { readFileSync } from "node:fs"
const healed = JSON.parse(readFileSync(process.argv[1], "utf8"))
console.log(healed.dsh.profile.bundles.join(","))
' "$DIRTY_PROFILE/package.json")
else
  HEALED=""
  bad "seed heal CLI failed on a leftover 0.1.1 fixture"
fi
if [[ "$HEALED" == *"dsh-client-app"* || "$HEALED" == *"dsh-context"* ]]; then
  bad "healDesktopProfileManifest left dsh-client-app or dsh-context on a dirty fixture"
elif [[ "$HEALED" == *"dsh-web-app"* ]]; then
  ok "healDesktopProfileManifest rewrites a leftover 0.1.1 desktop profile"
else
  bad "healDesktopProfileManifest did not introduce dsh-web-app"
fi
rm -rf "$DIRTY_PROFILE"

ASK_DATA_SRC="$REPO_ROOT/packages/experimental/desktop-ask-data"
if [[ -f "$ASK_DATA_SRC/samples/sample-sales.xlsx" && -f "$ASK_DATA_SRC/samples/sample-sales.sqlite" ]]; then
  if [[ "$(basename "$ASK_DATA_SRC/samples/sample-sales.xlsx")" == "sample-sales.xlsx" ]]; then
    ok "ask-data sample-sales.xlsx and sample-sales.sqlite are present with ASCII names"
  else
    bad "ask-data sample filenames are not ASCII sample-sales.*"
  fi
else
  bad "ask-data samples/sample-sales.xlsx or .sqlite missing"
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
    if [[ "$dest" == "@deepseek-ai/dsh-experimental-desktop-ask-data" ]]; then
      if [[ -f "$plugin_dir/samples/sample-sales.xlsx" && -f "$plugin_dir/samples/sample-sales.sqlite" ]]; then
        ok "$dest includes sample-sales.xlsx and sample-sales.sqlite"
      else
        bad "$dest is missing sample-sales.xlsx or sample-sales.sqlite"
      fi
      if [[ -d "$plugin_dir/node_modules/exceljs" ]]; then
        ok "$dest includes exceljs for Host spreadsheet import"
      else
        bad "$dest is missing node_modules/exceljs — workspace pin must install third-party deps"
      fi
    fi
    if [[ "$dest" == "@deepseek-ai/dsh-experimental-desktop-hero-atmosphere" ]]; then
      if [[ -d "$plugin_dir/motion" ]]; then
        bad "$dest ships motion/ compile intermediates — seed must copy media/ only"
      else
        ok "$dest omits motion/ compile intermediates"
      fi
      if [[ -f "$plugin_dir/media/poster.jpg" && -f "$plugin_dir/media/k1.jpg" && -f "$plugin_dir/media/hero.mp4" ]]; then
        ok "$dest includes poster.jpg, k1.jpg, and hero.mp4"
      else
        bad "$dest is missing media/poster.jpg, media/k1.jpg, or media/hero.mp4 — the Hero plate has nothing to play"
      fi
      if [[ -f "$plugin_dir/lib/index.js" && -f "$plugin_dir/lib/client.js" ]]; then
        ok "$dest ships Host and Client faces"
      else
        bad "$dest missing lib/index.js or lib/client.js — run tsc -b then tsdown before packaging"
      fi
      if [[ -f "$plugin_dir/lib/client.js" ]] && grep -q 'require("url")' "$plugin_dir/lib/client.js"; then
        bad "$dest Client rewrites import.meta.url to Node require(url) — inline media as data URLs"
      elif [[ -f "$plugin_dir/lib/client.js" ]] && grep -q 'data:image/jpeg;base64,' "$plugin_dir/lib/client.js"; then
        ok "$dest Client inlines the poster as a data URL"
      else
        bad "$dest Client missing inlined poster data URL — the WebView cannot load package-relative media"
      fi
    fi
    if [[ "$dest" == "@deepseek-ai/dsh-experimental-desktop-media" ]]; then
      # Do not import this Host file here: seed drops workspace: peers, so a
      # bare `import()` fails even when Cordis can load the plugin in-profile.
      # Object-form `inject.optional` is a service name, not optional deps.
      if [[ ! -f "$plugin_dir/lib/index.js" ]]; then
        bad "$dest missing lib/index.js — run tsc -b && tsdown before packaging"
      elif grep -q 'const inject = {' "$plugin_dir/lib/index.js" \
        && grep -A6 'const inject = {' "$plugin_dir/lib/index.js" | grep -q 'optional:'; then
        bad "$dest Host inject uses object key optional — Cordis waits for that service and handshake dies. Run tsc -b && tsdown"
      elif grep -A8 'const inject = \[' "$plugin_dir/lib/index.js" | grep -q '"tools"' \
        && grep -A8 'const inject = \[' "$plugin_dir/lib/index.js" | grep -q '"sessions"'; then
        ok "$dest Host inject is a Cordis service-name array"
      else
        bad "$dest Host inject is missing the tools/sessions array — run tsc -b && tsdown"
      fi
    fi
    if [[ "$dest" == "@deepseek-ai/dsh-experimental-commerce-mode" ]]; then
      if [[ -f "$plugin_dir/preset/commerce/agent.cordis.yml" && -f "$plugin_dir/preset/commerce/preset.yml" ]]; then
        ok "$dest ships the packaged commerce preset"
      else
        bad "$dest is missing preset/commerce — the commerce preset cannot install on first run"
      fi
      if [[ -f "$plugin_dir/samples/orders.csv" && -f "$plugin_dir/samples/products.csv" && -f "$plugin_dir/samples/inventory.csv" ]]; then
        ok "$dest ships the fictional commerce sample tables"
      else
        bad "$dest is missing samples/*.csv — the sample import has nothing to load"
      fi
      if [[ -f "$plugin_dir/NOTICE" ]]; then
        ok "$dest carries its adapted-skill NOTICE"
      else
        bad "$dest is missing NOTICE — adapted skill text must ship its attribution"
      fi
    fi
  else
    bad "profile-plugins/$dest missing — overlay will not install on first run"
  fi
done < <(node --input-type=module -e '
import { readFileSync } from "node:fs"
const pin = JSON.parse(readFileSync(process.argv[1], "utf8"))
for (const plugin of pin.plugins) console.log(plugin.name)
' "$PIN")

DANGLING="$(find "$RES/profile-plugins" -type l ! -exec test -e {} \; -print 2>/dev/null | head -8 || true)"
if [[ -n "$DANGLING" ]]; then
  bad "profile-plugins contain dangling symlinks — first launch copy fails and drops package.json"
  printf '\033[0;90m%s\033[0m\n' "$DANGLING"
else
  ok "profile-plugins have no dangling npm bin stubs"
fi

# Default workspaceRoot is $HOME. Handshake must wait for sessionController,
# or the first session/control open kills the companion and the window
# reconnects forever. Official desktop-app does not take this inject.
assert_connection_waits_for_session_controller() {
  local patch="$1"
  local label="$2"
  if [[ -f "$patch" ]] \
    && grep -A8 'id: connection-desktop' "$patch" | grep -q 'sessionController'
  then
    ok "$label connection-desktop injects sessionController"
  else
    bad "$label connection-desktop does not inject sessionController — session/control at handshake exits the companion"
  fi
}
assert_connection_waits_for_session_controller \
  "$REPO_ROOT/packages/experimental/desktop-files/cordis.patch.yml" \
  "source desktop-files patch"
if [[ -f "$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-files/cordis.patch.yml" ]]; then
  assert_connection_waits_for_session_controller \
    "$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-files/cordis.patch.yml" \
    "bundled desktop-files patch"
fi

# Agent Team Host packages are inserted by the client-ui-agent-team patch but
# are not copied into profile-plugins (workspace: deps are dropped). They must
# resolve from the harness collect closure or companion boot fails entirely.
if [[ -d "$RES/profile-plugins/@deepseek-ai/dsh-experimental-client-ui-agent-team" ]]; then
  for pkg in \
    "@deepseek-ai/dsh-experimental-agent-team" \
    "@deepseek-ai/dsh-experimental-tool-agent-team"
  do
    if [[ -f "$HARNESS/node_modules/$pkg/package.json" ]]; then
      ok "harness includes $pkg for Agent Team Host insert"
    else
      bad "harness missing $pkg — move it to apps/cli dependencies so collect-runtime-deps embeds it"
    fi
  done
fi

# desktop-media Host packages are workspace: deps dropped from the seed.
# They must resolve from the harness collect closure or companion load fails.
if [[ -d "$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-media" ]]; then
  for pkg in \
    "@deepseek-ai/dsh-brand" \
    "@deepseek-ai/dsh-credentials" \
    "@deepseek-ai/dsh-native-command"
  do
    if [[ -f "$HARNESS/node_modules/$pkg/package.json" ]]; then
      ok "harness includes $pkg for desktop-media Host"
    else
      bad "harness missing $pkg — move it to apps/cli dependencies so collect-runtime-deps embeds it"
    fi
  done
fi

# session.listEntries lives on the generated Session Remote face. A stale
# session-controller client makes every file-tree listing look unreadable.
head_ "Checking session-controller client knows listEntries"
SESSION_CLIENT="$HARNESS/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.remote-client.js"
if [[ -f "$SESSION_CLIENT" ]] && grep -q 'listEntries' "$SESSION_CLIENT"; then
  ok "bundled session-controller remote face includes listEntries"
else
  bad "bundled session-controller remote face missing listEntries — rebuild that Host face before packaging"
fi
if [[ -f "$SESSION_CLIENT" ]] && grep -q 'commitAskData' "$SESSION_CLIENT"; then
  ok "bundled session-controller remote face includes commitAskData"
else
  bad "bundled session-controller remote face missing commitAskData — rebuild that Host face before packaging"
fi
if [[ -f "$SESSION_CLIENT" ]] && grep -q 'askKnowledgeRetrieve' "$SESSION_CLIENT"; then
  ok "bundled session-controller remote face includes askKnowledgeRetrieve"
else
  bad "bundled session-controller remote face missing askKnowledgeRetrieve — rebuild that Host face before packaging"
fi
if [[ -f "$SESSION_CLIENT" ]] && grep -q 'askKnowledgeListDocuments' "$SESSION_CLIENT"; then
  ok "bundled session-controller remote face includes askKnowledgeListDocuments"
else
  bad "bundled session-controller remote face missing askKnowledgeListDocuments — rebuild that Host face before packaging"
fi
if [[ -f "$SESSION_CLIENT" ]] && grep -q 'listMediaWorks' "$SESSION_CLIENT"; then
  ok "bundled session-controller remote face includes listMediaWorks"
else
  bad "bundled session-controller remote face missing listMediaWorks — rebuild that Host face before packaging"
fi

MEDIA_CLIENT="$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-media/lib/client.js"
if [[ -f "$MEDIA_CLIENT" ]] \
  && grep -q '做视频' "$MEDIA_CLIENT" \
  && grep -q '做配音' "$MEDIA_CLIENT" \
  && grep -q '还没有作品，在会话中选择' "$MEDIA_CLIENT" \
  && grep -q '不要把它加成上面的对话模型' "$MEDIA_CLIENT" \
  && grep -q 'conversation.hero.capabilities.item' "$MEDIA_CLIENT" \
  && grep -q '克隆声音' "$MEDIA_CLIENT"; then
  ok "bundled desktop-media Client has Chinese shortcuts, Works empty state, and the 专业能力 menu rows"
else
  bad "bundled desktop-media Client missing Chinese creation, the 专业能力 menu rows, or MiniMax key copy — run tsdown before packaging"
fi
if [[ -f "$MEDIA_CLIENT" ]] \
  && ! grep -q 'require("module")' "$MEDIA_CLIENT"; then
  ok "bundled desktop-media Client does not require Node module"
else
  bad "bundled desktop-media Client requires Node module — a Host-only dep leaked into lib/client.js"
fi
# A panel painted with a token the theme never defines resolves to no
# background at all, so the Works sheet and the clone dialog leaked the
# desktop backdrop through. The surface tokens below are the theme-owned ones.
if [[ -f "$MEDIA_CLIENT" ]] \
  && ! grep -q 'dsw-alias-bg-primary' "$MEDIA_CLIENT" \
  && grep -q 'dsw-alias-bg-layer-2' "$MEDIA_CLIENT"; then
  ok "bundled desktop-media Client paints panels with existing surface tokens"
else
  bad "bundled desktop-media Client uses a missing theme token (--dsw-alias-bg-primary) — run tsdown before packaging"
fi
if [[ -n "$(find "$RES" \( -name ffmpeg -o -name ffprobe \) -type f 2>/dev/null | head -1)" ]]; then
  bad "bundle contains ffmpeg/ffprobe — V1 must not embed the media runtime"
else
  ok "bundle does not embed ffmpeg or ffprobe"
fi

# desktop-speech-transcribe turns a recording into a transcript through the
# speech seam. The Host face must carry the tool and the Chinese preparation
# guidance; the dual face and an asset-free payload are seed requirements.
TRANSCRIBE_PLUGIN="$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-speech-transcribe"
TRANSCRIBE_HOST="$TRANSCRIBE_PLUGIN/lib/index.js"
TRANSCRIBE_CLIENT="$TRANSCRIBE_PLUGIN/lib/client.js"
if [[ -d "$TRANSCRIBE_PLUGIN" ]]; then
  ok "profile-plugins includes desktop-speech-transcribe"
else
  bad "profile-plugins missing desktop-speech-transcribe — the 录音转纪要 entry will not install on first run"
fi
if [[ -f "$TRANSCRIBE_HOST" ]] && grep -q 'speech_transcribe' "$TRANSCRIBE_HOST"; then
  ok "bundled desktop-speech-transcribe Host registers speech_transcribe"
else
  bad "bundled desktop-speech-transcribe Host missing speech_transcribe — run tsc -b then tsdown before packaging"
fi
if [[ -f "$TRANSCRIBE_HOST" ]] \
  && grep -q '下载并准备' "$TRANSCRIBE_HOST" \
  && grep -q '语音输入' "$TRANSCRIBE_HOST"; then
  ok "bundled desktop-speech-transcribe Host returns the 插件→语音输入 下载并准备 guidance"
else
  bad "bundled desktop-speech-transcribe Host missing the Chinese provider guidance — run tsc -b then tsdown before packaging"
fi
if [[ -f "$TRANSCRIBE_CLIENT" ]] && grep -q '录音转文字' "$TRANSCRIBE_CLIENT"; then
  ok "bundled desktop-speech-transcribe Client ships the 录音转文字 hero row"
else
  bad "bundled desktop-speech-transcribe Client missing 录音转文字 — run tsc -b then tsdown before packaging"
fi
TRANSCRIBE_ASSETS="$(find "$TRANSCRIBE_PLUGIN" -type f \( -name '*.wav' -o -name '*.m4a' -o -name '*.mp3' -o -name '*.onnx' -o -name '*.model' -o -name '*.bin' \) 2>/dev/null | head -1 || true)"
if [[ -z "$TRANSCRIBE_ASSETS" ]]; then
  ok "bundled desktop-speech-transcribe carries no model or audio assets"
else
  bad "bundled desktop-speech-transcribe bundles a model or audio asset: $TRANSCRIBE_ASSETS"
fi

# Host beginIngest reads ACCEPTED_INGEST_EXTENSIONS from the profile plugin
# bundle. tsdown Host face is compiled from lib/types; a client-only rebuild
# leaves .pdf rejected with "extension .pdf is not accepted".
ASK_K_HOST="$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-ask-knowledge/lib/index.js"
ASK_K_CLIENT="$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-ask-knowledge/lib/client.js"
if [[ -f "$ASK_K_HOST" ]] \
  && grep -A12 'ACCEPTED_INGEST_EXTENSIONS' "$ASK_K_HOST" | grep -q '".pdf"' \
  && grep -A12 'ACCEPTED_INGEST_EXTENSIONS' "$ASK_K_HOST" | grep -q '".xlsx"' \
  && grep -A12 'ACCEPTED_INGEST_EXTENSIONS' "$ASK_K_HOST" | grep -q '".docx"'; then
  ok "bundled ask-knowledge Host accepts .pdf, .xlsx, and .docx"
else
  bad "bundled ask-knowledge Host missing .pdf/.xlsx/.docx — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q '整理这份文档超过了等待时间' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client maps finish timeout copy"
else
  bad "bundled ask-knowledge Client missing finish timeout copy — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && ! grep -q 'require("module")' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client does not require Node module"
else
  bad "bundled ask-knowledge Client requires Node module — a Host-only dep leaked into lib/client.js"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q '.docx' "$ASK_K_CLIENT" \
  && grep -q '这种文件还不能入库。请用 .md、.txt、.html、.pdf、.docx' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client ingest list includes .docx"
else
  bad "bundled ask-knowledge Client missing ingest .docx — picker and Host lists must stay aligned"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q '添加文档' "$ASK_K_CLIENT" \
  && grep -q '点库名挂到这个会话' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client can add a document to an existing library"
else
  bad "bundled ask-knowledge Client missing 添加文档 — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q 'askKnowledgeListDocuments' "$ASK_K_CLIENT" \
  && grep -q '挂载所选文档' "$ASK_K_CLIENT" \
  && grep -q '挂载整个库' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client can list library documents and hang a selection"
else
  bad "bundled ask-knowledge Client missing the document picker — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q 'conversation.input.dock' "$ASK_K_CLIENT" \
  && grep -q '已选：' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client shows the hung library in the composer dock"
else
  bad "bundled ask-knowledge Client missing the composer dock entry — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] && grep -q 'conversation.hero.capabilities.item' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client contributes the 问知识 row to the 专业能力 menu"
else
  bad "bundled ask-knowledge Client missing the 专业能力 menu row — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -Fq 'get("remote.askKnowledge")' "$ASK_K_CLIENT" \
  && grep -q 'docs.loading' "$ASK_K_CLIENT" \
  && grep -q '批准预算' "$ASK_K_CLIENT"; then
  ok "bundled knowledge settings resolve document remotes safely and expose budget approval"
else
  bad "bundled knowledge settings lack scoped document loading or budget approval — rebuild Client bundles"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q 'textAvailable' "$ASK_K_CLIENT" \
  && grep -q 'aria-busy' "$ASK_K_CLIENT" \
  && grep -q 'docs.approvedEstimate' "$ASK_K_CLIENT" \
  && grep -q 'startDocumentAction' "$ASK_K_CLIENT" \
  && grep -q 'documentList' "$ASK_K_CLIENT" \
  && grep -q 'docs.migrationWarning' "$ASK_K_CLIENT"; then
  ok "bundled knowledge buttons track readiness, approved budgets and background admission"
else
  bad "bundled knowledge document actions are stale — rebuild Client bundles"
fi
ASK_DATA_CLIENT="$RES/profile-plugins/@deepseek-ai/dsh-experimental-desktop-ask-data/lib/client.js"
if [[ -f "$ASK_DATA_CLIENT" ]] \
  && grep -q '专业能力' "$ASK_DATA_CLIENT" \
  && grep -q '问数据' "$ASK_DATA_CLIENT" \
  && grep -q 'conversation.hero.capabilities.item' "$ASK_DATA_CLIENT"; then
  ok "bundled ask-data Client ships the 专业能力 menu with the 问数据 rename"
else
  bad "bundled ask-data Client missing the 专业能力 menu or the 问数据 rename — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_CLIENT" ]] \
  && grep -q '点删除，从名单去掉' "$ASK_K_CLIENT" \
  && grep -q '没能从名单移除' "$ASK_K_CLIENT"; then
  ok "bundled ask-knowledge Client can delete a catalog row"
else
  bad "bundled ask-knowledge Client missing 删除 — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_HOST" ]] \
  && grep -q 'Review the complete document estimate and approve its budget first' "$ASK_K_HOST"; then
  ok "bundled ask-knowledge Host requires complete-document budget approval"
else
  bad "bundled ask-knowledge Host missing the extraction approval guard — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_HOST" ]] \
  && grep -q 'record-conversion' "$ASK_K_HOST"; then
  ok "bundled ask-knowledge Host records conversion failures durably"
else
  bad "bundled ask-knowledge Host missing durable conversion failure handling — run tsc -b then tsdown before packaging"
fi
if [[ -f "$ASK_K_HOST" ]] && grep -q 'ask_knowledge_session_document' "$ASK_K_HOST" && grep -q 'wikiAttempt' "$ASK_K_HOST"; then
  ok "bundled ask-knowledge Host includes official session-document tools and logged wiki receipts"
else
  bad "bundled ask-knowledge Host predates complete session-document and wiki-receipt support"
fi
# Vite minifies 180_000 to 18e4. The WebView is baked from apps/desktop/dist
# at `cargo tauri build`; a stale connection-process lib/types emit leaves
# the default 30s unary and drops finishAskKnowledgeIngest.
DIST_JS="$(ls -t "$REPO_ROOT/apps/desktop/dist/assets"/index-*.js 2>/dev/null | head -1 || true)"
DESKTOP_BIN="$APP/Contents/MacOS/dsh-desktop"
if [[ -n "$DIST_JS" && -x "$DESKTOP_BIN" && "$DESKTOP_BIN" -nt "$DIST_JS" ]] \
  && grep -q 'session/finishAskKnowledgeIngest' "$DIST_JS" \
  && grep -qE '18e4|180000|180_000' "$DIST_JS"; then
  ok "desktop WebView waits 180s for finishAskKnowledgeIngest"
else
  bad "desktop WebView missing 180s finishAskKnowledgeIngest deadline — tsc connection-process client, then cargo tauri build"
fi

# Persistence refuses a log whose event type is absent from this build's
# KNOWN_SESSION_EVENT_TYPES. A reused harness-nm cache can keep an older
# dsh-session that does not know ask-knowledge/bound, so attach writes the
# event and resume then refuses the same session.
head_ "Checking bundled session event vocabulary"
SESSION_VOCAB="$HARNESS/node_modules/@deepseek-ai/dsh-session/lib/index.js"
SESSION_VOCAB_TYPES="$HARNESS/node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js"
vocab_has() {
  local needle="$1"
  { [[ -f "$SESSION_VOCAB" ]] && grep -q -F "$needle" "$SESSION_VOCAB"; } \
    || { [[ -f "$SESSION_VOCAB_TYPES" ]] && grep -q -F "$needle" "$SESSION_VOCAB_TYPES"; }
}
if vocab_has 'ask-knowledge/bound' && vocab_has 'ask-knowledge/unbound'; then
  ok "bundled dsh-session knows ask-knowledge/bound and ask-knowledge/unbound"
else
  bad "bundled dsh-session missing ask-knowledge bind events — refresh workspace packages before packaging"
fi

head_ "Checking persistent assistants and teams runtime (Stage C)"
ASSISTANT_REGISTRY_HOST="$HARNESS/node_modules/@deepseek-ai/dsh-experimental-assistant-registry/lib/index.js"
if [[ -f "$ASSISTANT_REGISTRY_HOST" ]] \
  && grep -q 'GroupRoundScheduler' "$ASSISTANT_REGISTRY_HOST" \
  && grep -q 'ReviewPredictionManager' "$ASSISTANT_REGISTRY_HOST" \
  && grep -q 'DispatchOwnershipManager' "$ASSISTANT_REGISTRY_HOST" \
  && grep -q 'DurableReadCursorManager' "$ASSISTANT_REGISTRY_HOST"; then
  ok "bundled assistant-registry Host provides Stage C round scheduler, prediction manager, ownership manager, and cursors"
else
  bad "bundled assistant-registry Host missing Stage C classes — run pnpm run build before packaging"
fi

ASSISTANT_CLIENT="$RES/profile-plugins/@deepseek-ai/dsh-experimental-client-ui-assistants/lib/client.js"
if [[ -f "$ASSISTANT_CLIENT" ]] \
  && grep -q 'ComposerPrediction' "$ASSISTANT_CLIENT" \
  && grep -q 'AssistantPredictionDock' "$ASSISTANT_CLIENT" \
  && grep -q 'predictionLabel' "$ASSISTANT_CLIENT"; then
  ok "bundled client-ui-assistants Client provides ComposerPrediction, AssistantPredictionDock, and locale copy"
else
  bad "bundled client-ui-assistants Client missing Stage C ComposerPrediction — run pnpm run build before packaging"
fi

if [[ -f "$ASSISTANT_CLIENT" ]] \
  && grep -q 'data-avatar' "$ASSISTANT_CLIENT" \
  && grep -q 'avatarInitials' "$ASSISTANT_CLIENT"; then
  ok "bundled assistants Client includes local avatars and their selection controls"
else
  bad "bundled assistants Client missing avatar controls — rebuild Client bundles"
fi

if [[ -f "$ASSISTANT_CLIENT" ]] \
  && grep -q 'sea-whale' "$ASSISTANT_CLIENT" \
  && grep -q 'sea-seal-apricot' "$ASSISTANT_CLIENT" \
  && grep -q 'bot-sprout' "$ASSISTANT_CLIENT" \
  && grep -q 'bot-coral' "$ASSISTANT_CLIENT" \
  && grep -q 'avatarSeaside' "$ASSISTANT_CLIENT" \
  && grep -q 'avatarRobots' "$ASSISTANT_CLIENT" \
  && grep -q 'data-character' "$ASSISTANT_CLIENT"; then
  ok "bundled assistants avatars include default Seaside Friends and optional Soft Robots"
else
  bad "bundled assistants Client missing character avatar series — rebuild Client bundles"
fi

if "$RES/node" "$REPO_ROOT/scripts/verify-assistant-brand-assets.mjs" "$APP"; then
  ok "approved whale brand and five generated portraits match the packaged Client plugins"
else
  bad "packaged brand or generated portraits are stale or missing"
fi

if [[ -f "$ASSISTANT_CLIENT" ]] \
  && grep -Eq '\.[[:alnum:]_-]+_modalContent\{[^}]*max-height:100%' "$ASSISTANT_CLIENT" \
  && grep -Eq '\.[[:alnum:]_-]+_modalContent\{[^}]*overflow-y:auto' "$ASSISTANT_CLIENT"; then
  ok "bundled assistant and team forms retain viewport bounds and internal scrolling"
else
  bad "bundled assistant forms lack viewport scroll bounds — rebuild Client bundles"
fi

if [[ -f "$ASSISTANT_CLIENT" ]] \
  && grep -q 'team-discussion' "$ASSISTANT_CLIENT" \
  && grep -q 'standing-team-dock' "$ASSISTANT_CLIENT" \
  && grep -q 'discussionCancel' "$ASSISTANT_CLIENT"; then
  ok "bundled assistants Client includes standing-team roster and cancellable discussion controls"
else
  bad "bundled assistants Client missing standing-team workflows — rebuild Client bundles"
fi

if [[ -f "$ASSISTANT_CLIENT" ]] \
  && grep -q 'assistants.workspace-choice' "$ASSISTANT_CLIENT" \
  && grep -q 'assistants.selector' "$ASSISTANT_CLIENT" \
  && grep -q 'selector-current-name' "$ASSISTANT_CLIENT" \
  && grep -q 'selector-avatar-shelf' "$ASSISTANT_CLIENT" \
  && grep -q 'Assistant binding does not match the selected Session' "$ASSISTANT_CLIENT"; then
  ok "bundled assistants bind workspace sessions before navigation and display confirmed identity"
else
  bad "bundled assistants lack workspace binding or visible identity — rebuild Client bundles"
fi

if [[ -f "$ASSISTANT_REGISTRY_HOST" ]] \
  && grep -q 'getTeamActivity' "$ASSISTANT_REGISTRY_HOST" \
  && grep -q 'repairEmptyTeamRoster' "$ASSISTANT_REGISTRY_HOST"; then
  ok "bundled assistants Host includes read-only activity and explicit legacy roster repair"
else
  bad "bundled assistants Host missing team workflow repairs — rebuild Host bundles"
fi

# ── 7c. Ask-knowledge sidecar runtime ────────────────────────────────────────

head_ "Checking kb-runtime sidecar"
SIDECAR="$RES/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar"
if [[ -x "$SIDECAR" ]]; then
  ok "octopus-kb-sidecar executable present"
else
  bad "octopus-kb-sidecar missing under Resources/resources/kb-runtime"
fi
if [[ -f "$RES/kb-runtime/prompts/propose.md" ]] \
  && grep -q 'at most 800 characters' "$RES/kb-runtime/prompts/propose.md" \
  && grep -q 'role (same as type' "$RES/kb-runtime/prompts/propose.md"; then
  ok "kb-runtime/prompts/propose.md asks for a short create_page body with role"
else
  bad "kb-runtime/prompts/propose.md missing short-summary or role rule — rebuild kb-runtime"
fi
[[ -d "$RES/kb-runtime/schemas" ]] \
  && ok "kb-runtime/schemas present" \
  || bad "kb-runtime/schemas missing"
[[ -f "$RES/kb-runtime/LICENSE" && -f "$RES/kb-runtime/SOURCE.txt" ]] \
  && ok "kb-runtime LICENSE and SOURCE.txt present" \
  || bad "kb-runtime LICENSE or SOURCE.txt missing"

if [[ -x "$SIDECAR" ]]; then
  SELFTEST="$(printf '%s\n' '{"command":"self-test"}' | env -i \
    PATH="/usr/bin:/bin" \
    OCTOPUS_KB_ROOT="$RES/kb-runtime" \
    HOME="$TMPDIR" \
    "$SIDECAR" 2>/dev/null || true)"
  if printf '%s' "$SELFTEST" | grep -q '"ok": true' \
    && printf '%s' "$SELFTEST" | grep -q '"proposalSchema": true' \
    && printf '%s' "$SELFTEST" | grep -q '"applyRules": true' \
    && printf '%s' "$SELFTEST" | grep -q '"rulesSchema": true' \
    && printf '%s' "$SELFTEST" | grep -q '"pageMetaFill": true' \
    && printf '%s' "$SELFTEST" | grep -q '"retrieveFold": true' \
    && printf '%s' "$SELFTEST" | grep -q '"convertFile": true' \
    && printf '%s' "$SELFTEST" | grep -q '"pypdf": true' \
    && printf '%s' "$SELFTEST" | grep -q '"documentPdf": true' \
    && printf '%s' "$SELFTEST" | grep -q '"sqliteRuntime": true'; then
    ok "bundled sidecar self-test passed in place"
  else
    bad "bundled sidecar self-test failed in place — must load proposal.json and builtins.yaml via the frozen package"
    printf '\033[0;90m%s\033[0m\n' "$SELFTEST"
  fi
  if printf '%s' "$SELFTEST" | grep -q '"pdf": true' \
    && printf '%s' "$SELFTEST" | grep -q '"xlsx": true'; then
    ok "bundled sidecar reports pdf and xlsx converters"
  else
    bad "bundled sidecar missing pdf/xlsx extras — rebuild kb-runtime without REUSE_KB_RUNTIME"
    printf '\033[0;90m%s\033[0m\n' "$SELFTEST"
  fi
  MAGIKA_MODEL="$RES/kb-runtime/octopus-kb-sidecar/_internal/magika/models/standard_v3_3/model.onnx"
  if [[ -f "$MAGIKA_MODEL" ]]; then
    ok "bundled sidecar includes magika model for markitdown PDF"
  else
    bad "bundled sidecar missing magika model — PDF ingest will fail"
  fi
  RELOC="$(mktemp -d)"
  ditto "$RES/kb-runtime" "$RELOC/kb-runtime"
  RELOC_OUT="$(printf '%s\n' '{"command":"self-test"}' | env -i \
    PATH="/usr/bin:/bin" \
    OCTOPUS_KB_ROOT="$RELOC/kb-runtime" \
    HOME="$TMPDIR" \
    "$RELOC/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar" 2>/dev/null || true)"
  if printf '%s' "$RELOC_OUT" | grep -q '"ok": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"proposalSchema": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"applyRules": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"rulesSchema": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"pageMetaFill": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"retrieveFold": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"convertFile": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"pypdf": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"documentPdf": true' \
    && printf '%s' "$RELOC_OUT" | grep -q '"sqliteRuntime": true'; then
    ok "sidecar self-test passed after relocating kb-runtime"
  else
    bad "sidecar self-test failed after relocating kb-runtime — runtime is not relocatable"
    printf '\033[0;90m%s\033[0m\n' "$RELOC_OUT"
  fi
  APPLY_DIR="$(mktemp -d)"
  printf '%s\n' '{"id":"gate","operations":[]}' > "$APPLY_DIR/p.json"
  APPLY_OUT="$(printf '%s\n' "{\"command\":\"validate-apply\",\"vault\":\"$APPLY_DIR\",\"proposal\":\"$APPLY_DIR/p.json\"}" | env -i \
    PATH="/usr/bin:/bin" \
    OCTOPUS_KB_ROOT="$RES/kb-runtime" \
    HOME="$TMPDIR" \
    "$SIDECAR" 2>/dev/null || true)"
  if printf '%s' "$APPLY_OUT" | grep -q 'No such file or directory'; then
    bad "frozen sidecar apply cannot open proposal.json or builtins.yaml"
    printf '\033[0;90m%s\033[0m\n' "$APPLY_OUT"
  else
    ok "frozen sidecar apply reaches proposal validation"
  fi
  rm -rf "$RELOC" "$APPLY_DIR"
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

# Public operations must pass against installed code before packaging.
head_ "Checking installed Ask Knowledge operations"
if node "$REPO_ROOT/scripts/verify-ask-knowledge-installed-flows.mjs" "$APP"; then
  ok "Installed Ask Knowledge source, worker and approved Host flows"
else
  bad "Installed Ask Knowledge acceptance failed"
fi

# Prediction streams must leave the serial desktop carrier available while waiting.
head_ "Checking installed composer predictions"
if node "$REPO_ROOT/scripts/verify-composer-predictions-installed-flows.mjs" "$APP"; then
  ok "Installed prediction delay, responsive settings, cancellation and cold restart"
else
  bad "Installed composer prediction acceptance failed"
fi

# ── Result ──────────────────────────────────────────────────────────────────

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  printf '\033[1;32m✓ READY: %s checks passed. Safe to package.\033[0m\n' "$PASS"
  exit 0
fi
printf '\033[1;31m✗ NOT READY: %s failed, %s passed. Do not distribute.\033[0m\n' "$FAIL" "$PASS"
exit 1
