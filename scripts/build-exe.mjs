#!/usr/bin/env node
/**
 * Build the self-contained Windows NSIS installer for octopus_DSH.
 *
 * Windows counterpart of `scripts/build-dmg.sh`: same payload contract, staged
 * under `apps/desktop/src-tauri/resources/` so `tauri.windows.conf.json` can
 * copy it to the installer's `resources/` tree unchanged:
 *   resources/node.exe            — Node.js binary (x64)
 *   resources/harness/            — @deepseek-ai/dsh package (with desktop-companion)
 *   resources/profile-plugins/    — fork-owned profile bundles (npm + workspace pins)
 *   resources/bundled-skills/     — fork-owned skills seeded to ~/.dsh/skills on launch
 *   resources/presets/            — optional bundled presets; empty without --presets
 *   resources/kb-runtime/         — relocatable octopus-kb PyInstaller onedir
 *
 * The compile phase runs before payload assembly so a Rust error surfaces in
 * minutes, and `pnpm run build` must already have produced the workspace libs.
 *
 * Usage: node scripts/build-exe.mjs [--skip-kb] [--presets <dir|none>]
 *   --skip-kb        skip freezing the ask-knowledge sidecar (slim gate mode)
 *   --presets <dir>  copy each preset subdirectory of <dir> into the installer
 *   --presets none   explicit opt-out; prints a warning instead of an error
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Must equal NODE_VERSION in scripts/build-dmg.sh; a vitest spec enforces that. */
const NODE_VERSION = '24.14.0'
const APP_NAME = 'octopus_DSH'
/** Pinned Tauri CLI the bundle phase runs through `pnpm dlx`. */
const TAURI_CLI = '@tauri-apps/cli@2.11.4'
const TAURI_DIR = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri')
const RESOURCES = join(TAURI_DIR, 'resources')
const CACHE = join(REPO_ROOT, 'dist', '.cache')
const DEPS_CACHE = join(CACHE, 'harness-nm')
const KB_CACHE = join(CACHE, 'kb-runtime')
const NSIS_DIR = join(TAURI_DIR, 'target', 'release', 'bundle', 'nsis')
const INSTALLER_OUT = join(REPO_ROOT, 'dist', `${APP_NAME}_Setup.exe`)

/**
 * Report the start of one build phase.
 * @param {string} message - phase name.
 */
function info(message) {
  console.log(`\u001b[1;34m▶ ${message}\u001b[0m`)
}

/**
 * Report a completed phase.
 * @param {string} message - one line describing the completed phase.
 */
function ok(message) {
  console.log(`\u001b[1;32m✓ ${message}\u001b[0m`)
}

/**
 * Report a failure and end the build.
 * @param {string} message - what failed and which input to fix.
 * @returns {never}
 */
function fail(message) {
  console.error(`\u001b[1;31m✗ ${message}\u001b[0m`)
  process.exit(1)
}

/**
 * Run one build step with inherited stdio.
 * @param {string} command - executable or shell command.
 * @param {string[]} args - argument list.
 * @param {{ cwd?: string, shell?: boolean }} [options] - working directory and shell use.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: 'inherit',
    shell: options.shell ?? false,
  })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Whether a command answers `<command> --version`. @param {string} command - executable name. @returns true when runnable. */
function commandRuns(command) {
  return spawnSync(command, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0
}

/**
 * Download one file, replacing any partial result.
 * @param {string} url - source URL.
 * @param {string} destination - local file path.
 */
async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok || response.body === null) {
    fail(`download failed (HTTP ${String(response.status)}) from ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

/** @param {string} path - file to hash. @returns lowercase SHA-256 hex. */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
let skipKb = false
/** @type {string | undefined} preset source directory, `none`, or undefined. */
let presets
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--skip-kb') skipKb = true
  else if (argv[index] === '--presets') {
    presets = argv[index + 1]
    index += 1
    if (presets === undefined) fail('--presets needs a directory or "none"')
  } else fail(`unknown argument: ${argv[index]}`)
}

// ── Preflight ────────────────────────────────────────────────────────────────

info('Preflight')
if (process.platform !== 'win32') {
  fail('build-exe.mjs builds the Windows NSIS installer; run it on Windows (CI: .github/workflows/desktop-windows.yml)')
}
for (const tool of ['pnpm', 'cargo', 'rustc']) {
  if (!commandRuns(tool)) fail(`${tool} is required on PATH`)
}
const PYTHON = process.env.ASK_KNOWLEDGE_PYTHON ?? 'python'
if (!skipKb && !commandRuns(PYTHON)) {
  fail(`${PYTHON} is required to freeze the KB sidecar; set ASK_KNOWLEDGE_PYTHON or pass --skip-kb`)
}
for (const [label, path] of [
  ['apps/cli/lib/desktop-companion.js', join(REPO_ROOT, 'apps', 'cli', 'lib', 'desktop-companion.js')],
  ['packages/boot/installed-runtime/lib/cli.js', join(REPO_ROOT, 'packages', 'boot', 'installed-runtime', 'lib', 'cli.js')],
]) {
  if (!existsSync(path)) fail(`${label} missing — run 'pnpm run build' first`)
}
info(`Checking the Tauri CLI (pnpm dlx ${TAURI_CLI})...`)
const tauriProbe = spawnSync('pnpm', ['dlx', TAURI_CLI, '--version'], {
  cwd: TAURI_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (tauriProbe.status !== 0) {
  fail(`pnpm dlx ${TAURI_CLI} is not runnable — fallback: cargo install --locked tauri-cli@2.11.4, then run 'cargo tauri build --bundles nsis' in apps/desktop/src-tauri`)
}
ok('Preflight passed')

// ── 1. Compile the crate (fail fast, before payload assembly) ───────────────

info('Compiling dsh-desktop (release)')
// tauri-build embeds frontendDist at compile time, so the WebView assets must
// exist before cargo runs; `tauri build` reruns this idempotently later.
run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'build'], { shell: process.platform === 'win32' })
run('cargo', ['build', '--release', '--manifest-path', join(TAURI_DIR, 'Cargo.toml')])
ok('Crate compiled')

// ── 2. Download Node.js ─────────────────────────────────────────────────────

info(`Downloading Node.js v${NODE_VERSION} (win-x64)`)
const nodeZipName = `node-v${NODE_VERSION}-win-x64.zip`
const nodeExtractDir = join(CACHE, 'node-v' + NODE_VERSION + '-win-x64')
const nodeZip = join(CACHE, nodeZipName)
mkdirSync(CACHE, { recursive: true })
if (!existsSync(nodeZip)) {
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${nodeZipName}`, nodeZip)
}
const shasums = await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).text()
const expected = shasums
  .split('\n')
  .map(line => line.trim().split(/\s+/))
  .find(([, name]) => name === nodeZipName)?.[0]
if (expected === undefined) fail(`${nodeZipName} is not listed in SHASUMS256.txt for v${NODE_VERSION}`)
const actual = sha256(nodeZip)
if (actual !== expected.toLowerCase()) {
  fail(`SHA-256 mismatch for ${nodeZipName}: expected ${expected}, got ${actual}`)
}
info('Extracting node.exe...')
// bsdtar ships in System32 and reads zip; Node 24 has no built-in unzip.
const tar = process.platform === 'win32'
  ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar'
if (!existsSync(join(nodeExtractDir, 'node.exe'))) {
  run(tar, ['-xf', nodeZip, '-C', CACHE])
}
const nodeExe = join(nodeExtractDir, 'node.exe')
if (!existsSync(nodeExe)) fail(`node.exe missing after extracting ${nodeZip}`)
mkdirSync(RESOURCES, { recursive: true })
copyFileSync(nodeExe, join(RESOURCES, 'node.exe'))
ok(`Node ${NODE_VERSION} embedded (SHA-256 verified)`)

// ── 3. Build and stage the harness ──────────────────────────────────────────

info('Collecting runtime dependencies')
// `pnpm deploy` drops transitive dependencies of vendored `file:vendor/*`
// packages; collect-runtime-deps.mjs walks the graph with Node's resolver plus
// the workspace and pnpm-store indexes instead.
rmSync(DEPS_CACHE, { recursive: true, force: true })
run(process.execPath, [
  join(REPO_ROOT, 'scripts', 'collect-runtime-deps.mjs'),
  join(REPO_ROOT, 'apps', 'cli', 'package.json'),
  DEPS_CACHE,
])

info('Staging the harness payload')
const harness = join(RESOURCES, 'harness')
rmSync(harness, { recursive: true, force: true })
mkdirSync(harness, { recursive: true })
cpSync(join(REPO_ROOT, 'apps', 'cli', 'lib'), join(harness, 'lib'), { recursive: true })
cpSync(join(REPO_ROOT, 'apps', 'cli', 'config'), join(harness, 'config'), { recursive: true })
copyFileSync(join(REPO_ROOT, 'apps', 'cli', 'package.json'), join(harness, 'package.json'))
cpSync(DEPS_CACHE, join(harness, 'node_modules'), { recursive: true, dereference: true })
ok('Harness package + dependencies staged (self-contained)')

// ── 4. Seed profile plugins and bundled skills ──────────────────────────────

info('Fetching desktop profile plugins')
const pluginResources = join(RESOURCES, 'profile-plugins')
rmSync(pluginResources, { recursive: true, force: true })
run(process.execPath, [
  join(REPO_ROOT, 'scripts', 'seed-desktop-profile-plugin.mjs'),
  'fetch', '--out', pluginResources,
])
ok('Desktop profile plugins staged')

info('Preparing bundled skills')
const skillResources = join(RESOURCES, 'bundled-skills')
rmSync(skillResources, { recursive: true, force: true })
run(process.execPath, [
  join(REPO_ROOT, 'scripts', 'seed-desktop-bundled-skills.mjs'),
  '--out', skillResources,
])
ok('Bundled skills staged')

// ── 5. Freeze the KB sidecar (PyInstaller cannot cross-compile) ─────────────

if (skipKb) {
  info('Skipping the KB sidecar (--skip-kb); the slim gate excludes ask-knowledge')
  // Keep the config resource entry resolvable so the same installer layout
  // stays valid in slim mode.
  mkdirSync(join(RESOURCES, 'kb-runtime'), { recursive: true })
} else {
  info('Freezing and staging kb-runtime')
  run(process.execPath, [join(REPO_ROOT, 'scripts', 'build-kb-sidecar.mjs')])
  const kbResources = join(RESOURCES, 'kb-runtime')
  rmSync(kbResources, { recursive: true, force: true })
  cpSync(KB_CACHE, kbResources, { recursive: true, dereference: true })
  const sidecar = join(kbResources, 'octopus-kb-sidecar', 'octopus-kb-sidecar.exe')
  if (!existsSync(sidecar)) fail('kb-runtime missing octopus-kb-sidecar.exe after embed')
  ok('kb-runtime staged')
}

// ── 6. Bundle presets ───────────────────────────────────────────────────────

info('Staging presets')
const presetResources = join(RESOURCES, 'presets')
rmSync(presetResources, { recursive: true, force: true })
mkdirSync(presetResources, { recursive: true })
if (presets === undefined || presets === 'none') {
  // v1 ships without presets: the env-ngo preset source lives outside this
  // repository, and the empty directory keeps the config entry stable.
  console.warn('⚠ No bundled presets in this installer (pass --presets <dir> to include them)')
} else {
  const source = resolve(presets)
  if (!existsSync(source)) fail(`presets directory not found: ${source}`)
  const entries = readdirSync(source, { withFileTypes: true }).filter(entry => entry.isDirectory())
  if (entries.length === 0) fail(`no preset subdirectories in ${source}`)
  for (const entry of entries) {
    cpSync(join(source, entry.name), join(presetResources, entry.name), { recursive: true })
    ok(`preset staged: ${entry.name}`)
  }
}

// ── 7. Verify the staged resource tree ──────────────────────────────────────

info('Checking the resource payload')
const cliDest = join(RESOURCES, 'installed-runtime-cli.js')
if (!existsSync(cliDest)) {
  // build.rs regenerates this from the built package; the copy is the same
  // fallback build-dmg.sh applies when the skeleton is hollow.
  const cliSource = join(REPO_ROOT, 'packages', 'boot', 'installed-runtime', 'lib', 'cli.js')
  if (!existsSync(cliSource)) fail('installed-runtime-cli.js missing — build packages/boot/installed-runtime')
  copyFileSync(cliSource, cliDest)
}
const required = [
  ['installed-runtime-cli.js', cliDest],
  ['node.exe', join(RESOURCES, 'node.exe')],
  ['harness/package.json', join(harness, 'package.json')],
  ['harness/lib/desktop-companion.js', join(harness, 'lib', 'desktop-companion.js')],
  ['profile-plugins/', pluginResources],
  ['bundled-skills/', skillResources],
  ['presets/', presetResources],
]
if (!skipKb) required.push(['kb-runtime/', join(RESOURCES, 'kb-runtime')])
for (const [label, path] of required) {
  if (!existsSync(path)) fail(`staged payload missing ${label}`)
}
ok('Resource payload complete')

// ── 8. Bundle the installer ─────────────────────────────────────────────────

info('Bundling the NSIS installer')
const bundle = spawnSync('pnpm', ['dlx', TAURI_CLI, 'build', '--bundles', 'nsis'], {
  cwd: TAURI_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (bundle.status !== 0) {
  fail(`pnpm dlx ${TAURI_CLI} build failed — fallback: cargo install --locked tauri-cli@2.11.4, then run 'cargo tauri build --bundles nsis' in apps/desktop/src-tauri`)
}
if (!existsSync(NSIS_DIR)) fail(`NSIS produced no bundle directory at ${NSIS_DIR}`)
const installers = readdirSync(NSIS_DIR).filter(name => name.endsWith('-setup.exe'))
if (installers.length === 0) fail(`NSIS produced no *-setup.exe in ${NSIS_DIR}`)
const newest = installers
  .map(name => ({ name, mtime: statSync(join(NSIS_DIR, name)).mtimeMs }))
  .sort((left, right) => right.mtime - left.mtime)[0]
mkdirSync(dirname(INSTALLER_OUT), { recursive: true })
copyFileSync(join(NSIS_DIR, newest.name), INSTALLER_OUT)

console.log('')
ok(`Done! Distribute: ${INSTALLER_OUT}`)
console.log('')
console.log('  Unsigned installer: SmartScreen may show 「Windows protected your PC」.')
console.log('  Users pick 「更多信息 → 仍要运行」 once.')
