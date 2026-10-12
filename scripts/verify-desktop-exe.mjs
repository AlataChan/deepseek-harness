#!/usr/bin/env node
/**
 * Windows readiness checklist for the installed octopus_DSH EXE.
 *
 * Every check runs against the INSTALLED tree, not the source checkout, and
 * every check fails loud. `.github/workflows/desktop-windows.yml` runs this
 * after the silent install and before the artifact upload, so a broken
 * installer never reaches a user. It mirrors `scripts/verify-desktop-bundle.sh`
 * where the `.app` layout does not apply.
 *
 * The payload modes (KB frozen or slim, presets bundled or dropped) come from
 * the installer's `resources/build-info.json`, which `scripts/build-exe.mjs`
 * writes; a missing or unparsable manifest fails the gate.
 *
 * Usage: node scripts/verify-desktop-exe.mjs <install-dir>
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readlinkSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
if (argv.length !== 1) {
  console.error('usage: verify-desktop-exe.mjs <install-dir>')
  process.exit(2)
}
const APP = resolve(argv[0])
const RES = join(APP, 'resources')
const ASK_KNOWLEDGE_PIN = '@deepseek-ai/dsh-experimental-desktop-ask-knowledge'

let PASS = 0
let FAIL = 0
/** @param {string} message - one passing check. */
function ok(message) {
  console.log(`\u001b[1;32m  ✓ ${message}\u001b[0m`)
  PASS += 1
}
/** @param {string} message - one failing check. */
function bad(message) {
  console.log(`\u001b[1;31m  ✗ ${message}\u001b[0m`)
  FAIL += 1
}
/** @param {string} message - section heading. */
function head(message) {
  console.log(`\u001b[1;34m▶ ${message}\u001b[0m`)
}
/** @param {string} message - dimmed diagnostic block. */
function quote(message) {
  console.log(`\u001b[0;90m${message}\u001b[0m`)
}

head(`Checking ${APP}`)

// ── 1. Install skeleton ─────────────────────────────────────────────────────

const binaryCandidates = ['dsh-desktop.exe', 'octopus_DSH.exe']
const binary = binaryCandidates.map(name => join(APP, name)).find(path => existsSync(path))
if (binary !== undefined) {
  ok(`Tauri binary present: ${basename(binary)}`)
} else {
  bad(`Tauri binary missing (looked for ${binaryCandidates.join(', ')} under ${APP})`)
}

if (existsSync(join(RES, 'installed-runtime-cli.js'))) {
  ok('installed-runtime-cli.js bundled')
} else {
  bad('installed-runtime-cli.js missing under resources/')
}

// ── 1b. Build manifest ──────────────────────────────────────────────────────
//
// The manifest records the declared payload modes so an explicit opt-out is
// distinguishable from a staging failure. An installer built by this pipeline
// always carries it.

const buildInfoPath = join(RES, 'build-info.json')
/** @type {{ kb?: string, presets?: string, node?: string, runtimeVersion?: string } | undefined} */
let buildInfo
if (existsSync(buildInfoPath)) {
  try {
    buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'))
  } catch {
    // An unparsable manifest is reported below as a missing one.
    buildInfo = undefined
  }
}
if (buildInfo === undefined) {
  bad('resources/build-info.json missing or unparsable — an installer built by scripts/build-exe.mjs always carries it')
} else {
  ok(`build-info.json: node ${String(buildInfo.node)}, runtime ${String(buildInfo.runtimeVersion)}, kb ${String(buildInfo.kb)}, presets ${String(buildInfo.presets)}`)
}

// ── 2. Embedded Node ────────────────────────────────────────────────────────

const nodeExe = join(RES, 'node.exe')
if (existsSync(nodeExe)) {
  const version = spawnSync(nodeExe, ['--version'], { encoding: 'utf8' })
  const output = (version.stdout ?? '').trim()
  if (version.status === 0 && output !== '') {
    ok(`Embedded Node runs: ${output}`)
  } else {
    bad('Embedded node.exe exists but will not execute')
  }
} else {
  bad('Embedded node.exe missing at resources/node.exe')
}

/** @param {string} command - executable. @param {string[]} args - arguments. @param {object} [options] - spawn options. @returns captured stdout/stderr/status. */
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// ── 3. Embedded harness manifest ────────────────────────────────────────────

const harness = join(RES, 'harness')
if (existsSync(join(harness, 'package.json'))) {
  ok('Harness package.json present')
  const manifest = JSON.parse(readFileSync(join(harness, 'package.json'), 'utf8'))
  const declared = manifest?.dsh?.companions?.desktop
  if (typeof declared === 'string' && declared !== '') {
    ok(`dsh.companions.desktop declared: ${declared}`)
  } else {
    bad('dsh.companions.desktop NOT declared — the shell will reject this runtime')
  }
} else {
  bad('Harness package.json missing')
}

if (existsSync(join(harness, 'lib', 'desktop-companion.js'))) {
  ok('desktop-companion.js present')
} else {
  bad('desktop-companion.js MISSING — this is the npm-publish gap')
}

const presetProviders = [
  join(harness, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'),
  join(harness, 'node_modules', '@deepseek-ai', 'dsh-agent-preset-registry'),
]
if (presetProviders.every(path => existsSync(path))) {
  ok('composition preset providers present')
} else {
  bad('composition preset providers missing from bundle')
}

// ── 4. Module graph resolves (the check that catches ERR_MODULE_NOT_FOUND) ──

head('Smoke-testing companion module graph')
const SMOKE_HOME = mkdtempSync(join(tmpdir(), 'dsh-exe-smoke-'))
const smokeEnv = {
  ...process.env,
  HOME: SMOKE_HOME,
  USERPROFILE: SMOKE_HOME,
  DSH_HOME: join(SMOKE_HOME, '.dsh'),
}
const companionRun = capture(nodeExe, [join(harness, 'lib', 'desktop-companion.js'), '--workspace-root', SMOKE_HOME], {
  env: smokeEnv,
})
// The companion reports a pre-gateway startup failure on stderr; the macOS
// gate merges both streams with 2>&1 and this check must see the same text.
const companionOut = `${companionRun.stdout}\n${companionRun.stderr}`

if (companionOut.includes('ERR_MODULE_NOT_FOUND')) {
  const missing = /Cannot find package '[^']*'/.exec(companionOut)?.[0] ?? ''
  bad(`Module graph BROKEN: ${missing}`)
  quote(companionOut.split('\n').slice(0, 6).join('\n'))
} else if (/Cannot find module|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(companionOut)) {
  bad('Module graph BROKEN (path/export failure)')
  quote(companionOut.split('\n').slice(0, 6).join('\n'))
} else if (/stdio carrier|IPC channel|connected/.test(companionOut)) {
  ok('Module graph resolves (companion reached its own IPC startup check)')
} else if (companionOut.trim() === '') {
  bad('Companion produced no output — cannot confirm the module graph')
} else {
  bad('Companion failed for an unexpected reason:')
  quote(companionOut.split('\n').slice(0, 8).join('\n'))
}

// ── 5. Companion lifecycle with every pinned overlay installed ──────────────

head('Driving a real companion handshake with pinned overlays')
const pinPath = join(REPO_ROOT, 'scripts', 'desktop-profile-plugins.json')
const pinnedNames = JSON.parse(readFileSync(pinPath, 'utf8')).plugins.map(plugin => plugin.name)
const smokeProfile = join(SMOKE_HOME, '.dsh', 'profiles', 'desktop')
mkdirSync(smokeProfile, { recursive: true })
for (const name of pinnedNames) {
  if (buildInfo?.kb === 'skipped' && name === ASK_KNOWLEDGE_PIN) continue
  const pluginDir = join(RES, 'profile-plugins', name)
  if (!existsSync(pluginDir)) continue
  const install = capture(nodeExe, [
    join(REPO_ROOT, 'scripts', 'seed-desktop-profile-plugin.mjs'),
    'install', '--from', pluginDir, '--profile-dir', smokeProfile,
  ])
  if (install.status !== 0) bad(`could not install ${name} into the smoke desktop profile`)
}
const lifecycle = capture(nodeExe, [join(REPO_ROOT, 'scripts', 'smoke-companion-lifecycle.mjs'), APP, '6000'], {
  env: smokeEnv,
})
if (lifecycle.status === 0) {
  if (/did not activate|waiting for service:/.test(lifecycle.stdout)) {
    bad('Companion became ready but an overlay did not activate')
    quote(lifecycle.stdout.split('\n').slice(0, 12).join('\n'))
  } else {
    ok(lifecycle.stdout.split('\n')[1] ?? lifecycle.stdout.trim())
  }
} else {
  bad('Companion lifecycle FAILED with pinned overlays installed')
  quote(`${lifecycle.stdout}\n${lifecycle.stderr}`.split('\n').slice(0, 16).join('\n'))
}
head('Driving installed runtime through the Rust shell')
const rustHarness = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'target', 'debug', 'carrier-harness.exe')
const rustLaunch = capture(nodeExe, [join(REPO_ROOT, 'scripts', 'smoke-desktop-rust-launch.mjs'), APP, rustHarness], {
  env: smokeEnv,
  timeout: 45_000,
})
if (rustLaunch.status === 0) {
  ok(rustLaunch.stdout.trim())
} else {
  bad('Installed runtime failed through the Rust shell')
  quote(`${rustLaunch.stdout}\n${rustLaunch.stderr}`)
}
rmSync(SMOKE_HOME, { recursive: true, force: true })

// ── 6. No leaked developer paths ────────────────────────────────────────────
//
// A symlink or absolute path into the build machine's checkout works here and
// breaks on every other machine.

/**
 * Every symlink below `root`, depth-limited like the `.app` gate.
 * @param {string} root - directory to scan.
 * @param {number} maxDepth - directory levels to descend.
 * @returns symlink paths.
 */
function findLinks(root, maxDepth) {
  /** @type {string[]} */
  const found = []
  /** @param {string} dir - directory. @param {number} depth - remaining levels. */
  function walk(dir, depth) {
    if (depth < 0 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) found.push(path)
      else if (entry.isDirectory()) walk(path, depth - 1)
    }
  }
  walk(root, maxDepth)
  return found
}

/** @param {string} link - symlink path. @returns whether the link resolves to nothing. */
function isBroken(link) {
  return !existsSync(link)
}

/**
 * Every file below `root` whose basename is in `names`.
 * @param {string} root - directory to scan.
 * @param {ReadonlySet<string>} names - basenames to match.
 * @returns matching file paths.
 */
function findNamedFiles(root, names) {
  /** @type {string[]} */
  const found = []
  /** @param {string} dir - directory to scan. */
  function walk(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(path)
      else if (names.has(entry.name)) found.push(path)
    }
  }
  walk(root)
  return found
}

/** @param {string} link - symlink path. @returns whether the link's absolute target leaves the install tree. */
function escapesInstall(link) {
  const target = readlinkSync(link)
  if (!isAbsolute(target)) return false
  const rel = relative(APP, target)
  return rel.startsWith('..') || isAbsolute(rel)
}

head('Checking for developer-machine leaks')
const nodeModulesLinks = findLinks(join(harness, 'node_modules'), 3)
const brokenLinks = nodeModulesLinks.filter(isBroken)
const escapingLinks = nodeModulesLinks.filter(link => !isBroken(link) && escapesInstall(link))
if (brokenLinks.length > 0) {
  bad(`${brokenLinks.length} broken symlink(s) in bundled node_modules (point outside the install)`)
} else if (escapingLinks.length > 0) {
  bad(`${escapingLinks.length} symlink(s) point outside the install tree — will break on a user machine`)
} else if (nodeModulesLinks.length > 0) {
  ok(`${nodeModulesLinks.length} symlink(s) present but all resolve inside the install`)
} else {
  ok('No symlinks in bundled node_modules')
}

const pluginLinks = findLinks(join(RES, 'profile-plugins'), 32)
const danglingPlugins = pluginLinks.filter(isBroken)
if (danglingPlugins.length > 0) {
  bad('profile-plugins contain dangling symlinks — first launch copy fails and drops package.json')
  quote(danglingPlugins.slice(0, 8).join('\n'))
} else {
  ok('profile-plugins have no dangling npm bin stubs')
}

// ── 7. Bundled plugins and skills ───────────────────────────────────────────

head('Checking bundled desktop profile plugins')
for (const name of pinnedNames) {
  const pluginDir = join(RES, 'profile-plugins', name)
  if (!existsSync(pluginDir)) {
    bad(`profile-plugins/${name} missing — overlay will not install on first run`)
    continue
  }
  const validation = capture(nodeExe, [
    join(REPO_ROOT, 'scripts', 'seed-desktop-profile-plugin.mjs'),
    'validate', '--dir', pluginDir,
  ])
  if (validation.status === 0) {
    ok(`${name} is a loadable dsh.bundle + dsh.client package`)
  } else {
    bad(`${name} failed seed validation`)
  }
}

head('Checking bundled skills')
const skillPin = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'desktop-bundled-skills.json'), 'utf8'))
for (const skill of skillPin.skills) {
  const skillDir = join(RES, 'bundled-skills', skill.name)
  if (!existsSync(join(skillDir, 'SKILL.md'))) {
    bad(`bundled-skills/${skill.name} incomplete — desktop users will not get it`)
  } else {
    ok(`bundled-skills/${skill.name} present`)
  }
}
if (existsSync(join(RES, 'bundled-skills', 'wechat-article-extractor'))) {
  const wechat = join(RES, 'bundled-skills', 'wechat-article-extractor')
  if (existsSync(join(wechat, 'scripts', 'rate-limit.js')) && existsSync(join(wechat, 'node_modules'))) {
    ok('wechat-article-extractor present with deps')
  } else {
    bad('wechat-article-extractor incomplete — desktop users will not get WeChat extract')
  }
}
if (existsSync(join(RES, 'bundled-skills', 'archify'))) {
  if (existsSync(join(RES, 'bundled-skills', 'archify', 'bin', 'archify.mjs'))) {
    ok('bundled-skills/archify present (post-hoc Team diagram skill)')
  } else {
    bad('bundled-skills/archify incomplete — desktop users will not get Archify')
  }
}

// ── 7b. Payload invariants mirrored from verify-desktop-bundle.sh ───────────

head('Checking bundled payload invariants')
const mediaBinaries = findNamedFiles(RES, new Set(['ffmpeg', 'ffprobe']))
if (mediaBinaries.length > 0) {
  bad('bundle contains ffmpeg/ffprobe — V1 must not embed the media runtime')
} else {
  ok('bundle does not embed ffmpeg or ffprobe')
}

head('Checking session-controller client knows listEntries')
const sessionClient = join(harness, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'typert.remote-client.js')
const sessionClientText = existsSync(sessionClient) ? readFileSync(sessionClient, 'utf8') : ''
for (const symbol of ['listEntries', 'commitAskData', 'askKnowledgeRetrieve', 'listMediaWorks']) {
  if (sessionClientText.includes(symbol)) {
    ok(`bundled session-controller remote face includes ${symbol}`)
  } else {
    bad(`bundled session-controller remote face missing ${symbol} — rebuild that Host face before packaging`)
  }
}

head('Checking bundled session event vocabulary')
const vocabFiles = [
  join(harness, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'),
  join(harness, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'types', 'known-event-types.js'),
]
/** @param {string} needle - event type to find. @returns whether any vocabulary file contains it. */
function vocabHas(needle) {
  return vocabFiles.some(file => existsSync(file) && readFileSync(file, 'utf8').includes(needle))
}
if (vocabHas('ask-knowledge/bound') && vocabHas('ask-knowledge/unbound')) {
  ok('bundled dsh-session knows ask-knowledge/bound and ask-knowledge/unbound')
} else {
  bad('bundled dsh-session missing ask-knowledge bind events — refresh workspace packages before packaging')
}

// The first-launch templates live in the source checkout, which the packaging
// workflow checks out before running this gate.
head('Checking first-launch templates')
const appRsPath = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'src', 'app.rs')
if (existsSync(appRsPath)) {
  const appRs = readFileSync(appRsPath, 'utf8')
  const shippedBlock = /const DESKTOP_SHIPPED_BUNDLES[\s\S]*?\];/.exec(appRs)?.[0] ?? ''
  if (shippedBlock.includes('dsh-client-app')) {
    bad('DESKTOP_SHIPPED_BUNDLES still lists dsh-client-app — first launch would recreate the storage clash')
  } else {
    ok('app.rs first-launch template does not seed dsh-client-app')
  }
  if (appRs.includes('install_bundled_skills')) {
    ok('app.rs seeds bundled skills on launch')
  } else {
    bad('app.rs missing install_bundled_skills')
  }
} else {
  bad(`missing ${appRsPath} — cannot check the first-launch templates`)
}

// ── 8. Ask-knowledge sidecar runtime ────────────────────────────────────────
//
// The build manifest decides: `kb: skipped` is an explicit slim installer
// whose pass criteria exclude the sidecar; `kb: frozen` requires the checks.

if (buildInfo?.kb === 'skipped') {
  head('Skipping kb-runtime checks (build-info: kb skipped — slim installer)')
} else {
  head('Checking kb-runtime sidecar')
  const kbRuntime = join(RES, 'kb-runtime')
  const sidecar = join(kbRuntime, 'octopus-kb-sidecar', 'octopus-kb-sidecar.exe')
  if (existsSync(sidecar)) {
    ok('octopus-kb-sidecar executable present')
  } else {
    bad('octopus-kb-sidecar missing under resources/kb-runtime')
  }

  /**
   * Run the frozen sidecar's self-test over stdin.
   * @param {string} executable - sidecar binary.
   * @param {string} root - `OCTOPUS_KB_ROOT` for the run.
   * @returns stdout of the run, or '' when it failed.
   */
  function sidecarSelfTest(executable, root) {
    // A frozen onedir loads its own libraries; only the KB root is
    // overridden. SystemRoot and TEMP stay because Windows needs them to
    // start any process at all.
    const env = process.platform === 'win32'
      ? {
          PATH: process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          TEMP: tmpdir(),
          TMP: tmpdir(),
          OCTOPUS_KB_ROOT: root,
        }
      : { PATH: '/usr/bin:/bin', HOME: tmpdir(), OCTOPUS_KB_ROOT: root }
    return capture(executable, [], { input: '{"command":"self-test"}\n', env, timeout: 300_000 }).stdout
  }

  /** Eight self-test flags, in the order both build scripts check them. */
  const SELF_TEST_KEYS = ['pdf', 'xlsx', 'proposalSchema', 'applyRules', 'rulesSchema', 'pageMetaFill', 'retrieveFold', 'convertFile']
  /** @param {string} output - sidecar stdout. @returns whether every flag answered true. */
  const selfTestPassed = output => SELF_TEST_KEYS.every(key => output.includes(`"${key}": true`))

  if (existsSync(join(kbRuntime, 'prompts', 'propose.md')) && existsSync(join(kbRuntime, 'schemas'))) {
    ok('kb-runtime prompts and schemas present')
  } else {
    bad('kb-runtime/prompts or schemas missing')
  }
  if (existsSync(join(kbRuntime, 'LICENSE')) && existsSync(join(kbRuntime, 'SOURCE.txt'))) {
    ok('kb-runtime LICENSE and SOURCE.txt present')
  } else {
    bad('kb-runtime LICENSE or SOURCE.txt missing')
  }

  if (existsSync(sidecar)) {
    const selfTest = sidecarSelfTest(sidecar, kbRuntime)
    if (selfTest.includes('"ok": true') && selfTestPassed(selfTest)) {
      ok('bundled sidecar self-test passed in place')
    } else {
      bad('bundled sidecar self-test failed in place — must load proposal.json and builtins.yaml via the frozen package')
      quote(selfTest)
    }
    if (existsSync(join(kbRuntime, 'octopus-kb-sidecar', '_internal', 'magika', 'models', 'standard_v3_3', 'model.onnx'))) {
      ok('bundled sidecar includes magika model for markitdown PDF')
    } else {
      bad('bundled sidecar missing magika model — PDF ingest will fail')
    }

    const relocation = mkdtempSync(join(tmpdir(), 'dsh-exe-reloc-'))
    cpSync(kbRuntime, join(relocation, 'kb-runtime'), { recursive: true, dereference: true })
    const relocatedOut = sidecarSelfTest(join(relocation, 'kb-runtime', 'octopus-kb-sidecar', 'octopus-kb-sidecar.exe'), join(relocation, 'kb-runtime'))
    if (relocatedOut.includes('"ok": true') && selfTestPassed(relocatedOut)) {
      ok('sidecar self-test passed after relocating kb-runtime')
    } else {
      bad('sidecar self-test failed after relocating kb-runtime — runtime is not relocatable')
      quote(relocatedOut)
    }
    rmSync(relocation, { recursive: true, force: true })
  }
}

// ── 9. Bundled presets ──────────────────────────────────────────────────────
//
// `presets: none` in the build manifest is an explicit opt-out: the staged
// directory stays empty. `presets: bundled` requires preset content.

if (buildInfo?.presets === 'none') {
  head('No bundled presets (build-info: presets none — explicit opt-out)')
} else {
  head('Checking bundled presets')
  const presetsDir = join(RES, 'presets')
  const presetDirs = existsSync(presetsDir)
    ? readdirSync(presetsDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : []
  if (presetDirs.length === 0) {
    bad('resources/presets is empty but build-info.json declares presets bundled — the preset staging phase did not complete')
  } else {
    ok(`${presetDirs.length} bundled preset(s) for first-run install`)
    for (const preset of presetDirs) {
      const complete = existsSync(join(presetsDir, preset.name, 'preset.yml'))
        && existsSync(join(presetsDir, preset.name, 'agent.cordis.yml'))
      if (complete) ok(`  ${preset.name}: preset.yml + agent.cordis.yml present`)
      else bad(`  ${preset.name}: incomplete (missing preset.yml or agent.cordis.yml)`)
    }
  }
}

// ── Result ──────────────────────────────────────────────────────────────────

console.log('')
if (FAIL === 0) {
  console.log(`\u001b[1;32m✓ READY: ${PASS} checks passed. Safe to distribute.\u001b[0m`)
  process.exit(0)
}
console.log(`\u001b[1;31m✗ NOT READY: ${FAIL} failed, ${PASS} passed. Do not distribute.\u001b[0m`)
process.exit(1)
