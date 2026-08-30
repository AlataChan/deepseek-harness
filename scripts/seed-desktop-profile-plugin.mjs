#!/usr/bin/env node
/**
 * Fetch, validate, and install fork-owned desktop profile plugins.
 *
 * These packages are not official desktop-app layers. They land in
 * `$DSH_HOME/profiles/desktop` the same way `dsh plugin add` would: a copy
 * under the profile's `node_modules` plus a `dsh.profile.bundles` entry.
 * The DMG embeds the validated copies under Resources/profile-plugins/;
 * first launch copies them into the live profile.
 *
 * Usage:
 *   node scripts/seed-desktop-profile-plugin.mjs fetch --out <dir>
 *   node scripts/seed-desktop-profile-plugin.mjs validate --dir <plugin-dir>
 *   node scripts/seed-desktop-profile-plugin.mjs install --from <plugin-dir> --profile-dir <dir>
 *   node scripts/seed-desktop-profile-plugin.mjs seed --profile-dir <dir>
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PIN_PATH = join(SCRIPT_DIR, 'desktop-profile-plugins.json')

const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * @typedef {{ name: string, version: string, source?: 'npm' | 'workspace', path?: string }} PluginPin
 * @typedef {{ profile: string, shippedBundles: string[], plugins: PluginPin[] }} PinFile
 */

/** @returns {PinFile} */
export function readPinFile(path = PIN_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed?.profile !== 'desktop' || !Array.isArray(parsed.plugins) || !Array.isArray(parsed.shippedBundles)) {
    throw new Error(`seed: ${path} is not a desktop profile plugin pin file`)
  }
  for (const plugin of parsed.plugins) {
    if (typeof plugin?.name !== 'string' || typeof plugin?.version !== 'string') {
      throw new Error(`seed: ${path} has a plugin pin without name/version`)
    }
    if (plugin.source === 'workspace' && (typeof plugin.path !== 'string' || plugin.path === '')) {
      throw new Error(`seed: ${path} workspace pin ${plugin.name} is missing path`)
    }
  }
  return parsed
}

/**
 * Fail loud when a directory is not a loadable dsh.bundle + dsh.client package.
 * @param {string} dir
 * @param {PluginPin} [expected]
 */
export function validatePluginDir(dir, expected) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`seed: missing ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (expected !== undefined) {
    if (manifest.name !== expected.name) {
      throw new Error(`seed: expected package ${expected.name}, found ${JSON.stringify(manifest.name)}`)
    }
    if (manifest.version !== expected.version) {
      throw new Error(`seed: expected ${expected.name}@${expected.version}, found ${manifest.version}`)
    }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch === '') {
    throw new Error(`seed: ${manifest.name} declares no dsh.bundle.patch`)
  }
  if (!existsSync(join(dir, patch))) {
    throw new Error(`seed: ${manifest.name} dsh.bundle.patch ${patch} is missing`)
  }
  if (manifest.dsh?.client?.platform !== 'web') {
    throw new Error(`seed: ${manifest.name} is not a web dsh.client package`)
  }
  const clientExport = manifest.exports?.['./client']
  const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
  if (typeof clientPath !== 'string' || !existsSync(join(dir, clientPath))) {
    throw new Error(`seed: ${manifest.name} ./client export is missing on disk`)
  }
  const main = typeof manifest.main === 'string' ? manifest.main : 'lib/index.js'
  if (!existsSync(join(dir, main))) {
    throw new Error(`seed: ${manifest.name} main ${main} is missing`)
  }
  return manifest
}

/**
 * Merge one plugin into a desktop profile manifest.
 * First install appends the bundle; a later version replace does not
 * re-insert a bundle the user removed.
 * @param {object} manifest
 * @param {PluginPin} plugin
 * @param {{ firstInstall: boolean }} options
 */
export function mergeProfileManifest(manifest, plugin, options) {
  const next = structuredClone(manifest)
  next.private = true
  next.name ??= 'dsh-profile-desktop'
  next.dependencies = { ...next.dependencies, [plugin.name]: plugin.version }
  const bundles = [...(next.dsh?.profile?.bundles ?? [])]
  if (options.firstInstall && !bundles.includes(plugin.name)) bundles.push(plugin.name)
  next.dsh = { ...next.dsh, profile: { ...next.dsh?.profile, bundles } }
  return next
}

/**
 * @param {string} src
 * @param {string} profileDir
 * @param {string[]} shippedBundles
 */
export function installPluginIntoProfile(src, profileDir, shippedBundles) {
  const manifest = validatePluginDir(src)
  const plugin = { name: manifest.name, version: manifest.version }
  mkdirSync(profileDir, { recursive: true })
  const profileManifestPath = join(profileDir, 'package.json')
  const created = !existsSync(profileManifestPath)
  /** @type {object} */
  let profileManifest
  if (created) {
    profileManifest = {
      name: `dsh-profile-${basename(profileDir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...shippedBundles] } },
    }
  } else {
    profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
  }
  const dest = join(profileDir, 'node_modules', ...plugin.name.split('/'))
  const firstInstall = !existsSync(join(dest, 'package.json'))
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
    throw new Error(`seed: dest ${dest} is a symlink`)
  }
  rmSync(dest, { recursive: true, force: true })
  copyPackageTree(src, dest, { includeModules: shouldCopyProductionModules(src) })
  validatePluginDir(dest, plugin)
  const merged = mergeProfileManifest(profileManifest, plugin, { firstInstall: created || firstInstall })
  writeFileSync(profileManifestPath, `${JSON.stringify(merged, undefined, 2)}\n`)
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
  return { name: plugin.name, version: plugin.version, firstInstall: created || firstInstall, dest }
}

/**
 * Download one pinned plugin from npm into `outDir/<name>`.
 * @param {PluginPin} plugin
 * @param {string} outDir
 * @param {{ cacheDir?: string }} [options]
 */
export function fetchPlugin(plugin, outDir, options = {}) {
  if (plugin.source === 'workspace') {
    return fetchWorkspacePlugin(plugin, outDir)
  }
  const cacheDir = options.cacheDir ?? join(SCRIPT_DIR, '..', 'dist', '.cache', 'profile-plugins')
  mkdirSync(cacheDir, { recursive: true })
  const spec = `${plugin.name}@${plugin.version}`
  const tarballName = `${plugin.name.replace(/^@/, '').replace('/', '-')}-${plugin.version}.tgz`
  const tarball = join(cacheDir, tarballName)
  if (!existsSync(tarball)) {
    execFileSync('npm', ['pack', spec, '--pack-destination', cacheDir], { stdio: 'inherit' })
  }
  if (!existsSync(tarball)) throw new Error(`seed: npm pack did not produce ${tarball}`)
  const extract = mkdtempSync(join(tmpdir(), 'dsh-seed-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', extract], { stdio: 'pipe' })
    const unpacked = join(extract, 'package')
    validatePluginDir(unpacked, plugin)
    const dest = join(outDir, ...plugin.name.split('/'))
    mkdirSync(outDir, { recursive: true })
    if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
      throw new Error(`seed: dest ${dest} is a symlink`)
    }
    rmSync(dest, { recursive: true, force: true })
    copyPackageTree(unpacked, dest)
    installProductionDependencies(dest)
    validatePluginDir(dest, plugin)
    return dest
  } finally {
    rmSync(extract, { recursive: true, force: true })
  }
}

/**
 * Copy a workspace pin from the built package tree (not `npm pack`).
 * @param {PluginPin} plugin
 * @param {string} outDir
 */
export function fetchWorkspacePlugin(plugin, outDir) {
  if (typeof plugin.path !== 'string' || plugin.path === '') {
    throw new Error(`seed: workspace pin ${plugin.name} is missing path`)
  }
  const src = resolve(SCRIPT_DIR, '..', plugin.path)
  validatePluginDir(src, plugin)
  const dest = join(outDir, ...plugin.name.split('/'))
  mkdirSync(outDir, { recursive: true })
  if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
    throw new Error(`seed: dest ${dest} is a symlink`)
  }
  rmSync(dest, { recursive: true, force: true })
  copyPackageTree(src, dest)
  validatePluginDir(dest, plugin)
  return dest
}

/**
 * Install an npm pin's production dependencies into the copied package.
 * Workspace pins skip this: they import Harness peers through the profile
 * module fallback. A community pin such as `@yejiming/dsh-data-agent` ships
 * `schemastery` / `zod` / ECharts as own dependencies; without them the
 * first-launch copy cannot load.
 * @param {string} dir
 */
function installProductionDependencies(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const deps = manifest.dependencies
  if (deps === undefined || Object.keys(deps).length === 0) return
  // A production dep that is also listed under `devDependencies` is dropped
  // by `npm install --omit=dev` (data-agent does this with `schemastery`).
  // Strip the unused faces for the install only; restore the published
  // manifest afterward so validate still sees the original package.json.
  const installManifest = { ...manifest }
  delete installManifest.devDependencies
  delete installManifest.peerDependencies
  delete installManifest.peerDependenciesMeta
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(installManifest, undefined, 2)}\n`)
  try {
    execFileSync('npm', [
      'install',
      '--ignore-scripts',
      '--legacy-peer-deps',
    ], { cwd: dir, stdio: 'inherit' })
  } finally {
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
  const leakedPeers = join(dir, 'node_modules', '@deepseek-ai')
  if (existsSync(leakedPeers)) {
    throw new Error(`seed: ${manifest.name} installed @deepseek-ai peers into its own node_modules`)
  }
}

/**
 * Keep a fetched npm pin's production `node_modules`. Skip pnpm/workspace
 * graphs (symlink or `.pnpm`) so a workspace pin cannot embed the repo store.
 * @param {string} src
 */
function shouldCopyProductionModules(src) {
  const modules = join(src, 'node_modules')
  if (!existsSync(modules) || lstatSync(modules).isSymbolicLink()) return false
  return !existsSync(join(modules, '.pnpm'))
}

/**
 * Copy a package tree. `includeModules` keeps a fetched npm pin's production
 * install; workspace copies still skip `node_modules`.
 * @param {string} src
 * @param {string} dest
 * @param {{ includeModules?: boolean }} [options]
 */
function copyPackageTree(src, dest, options = {}) {
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, {
    recursive: true,
    filter: (from) => {
      const relative = from.startsWith(src) ? from.slice(src.length) : from
      if (options.includeModules === true) return true
      return !relative.split(sep).includes('node_modules')
    },
  })
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function takeFlag(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('-')) fail(`seed: ${name} needs a path`)
  args.splice(index, 2)
  return value
}

function main(argv) {
  const args = [...argv]
  const command = args.shift()
  const pin = readPinFile()
  if (command === 'fetch') {
    const out = takeFlag(args, '--out')
    if (out === undefined) fail('usage: seed-desktop-profile-plugin.mjs fetch --out <dir>')
    for (const plugin of pin.plugins) {
      const dest = fetchPlugin(plugin, resolve(out))
      console.log(`seed: fetched ${plugin.name}@${plugin.version} -> ${dest}`)
    }
    return
  }
  if (command === 'validate') {
    const dir = takeFlag(args, '--dir')
    if (dir === undefined) fail('usage: seed-desktop-profile-plugin.mjs validate --dir <plugin-dir>')
    const resolved = resolve(dir)
    const listed = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf8'))
    const expected = pin.plugins.find(plugin => plugin.name === listed.name)
    const manifest = validatePluginDir(resolved, expected)
    console.log(`seed: ${manifest.name}@${manifest.version} is a loadable desktop profile plugin`)
    return
  }
  if (command === 'install') {
    const from = takeFlag(args, '--from')
    const profileDir = takeFlag(args, '--profile-dir')
    if (from === undefined || profileDir === undefined) {
      fail('usage: seed-desktop-profile-plugin.mjs install --from <plugin-dir> --profile-dir <dir>')
    }
    const result = installPluginIntoProfile(resolve(from), resolve(profileDir), pin.shippedBundles)
    console.log(`seed: ${result.firstInstall ? 'installed' : 'refreshed'} ${result.name}@${result.version} -> ${result.dest}`)
    return
  }
  if (command === 'seed') {
    const profileDir = takeFlag(args, '--profile-dir')
    if (profileDir === undefined) fail('usage: seed-desktop-profile-plugin.mjs seed --profile-dir <dir>')
    const out = join(SCRIPT_DIR, '..', 'dist', '.cache', 'profile-plugins', 'unpacked')
    for (const plugin of pin.plugins) {
      const from = fetchPlugin(plugin, out)
      const result = installPluginIntoProfile(from, resolve(profileDir), pin.shippedBundles)
      console.log(`seed: ${result.firstInstall ? 'installed' : 'refreshed'} ${result.name}@${result.version}`)
    }
    return
  }
  fail('usage: seed-desktop-profile-plugin.mjs fetch|validate|install|seed ...')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
