#!/usr/bin/env node
/**
 * Collect a flat, self-contained `node_modules` for the desktop companion.
 *
 * `pnpm deploy` cannot be used: it drops transitive dependencies of the
 * vendored `file:vendor/*` packages, which fails at runtime with
 * ERR_MODULE_NOT_FOUND. This walks the dependency graph with Node's own
 * resolver instead, so a package reachable at runtime is a package that gets
 * copied.
 *
 * The output is FLAT (`node_modules/<name>/`) rather than nested: the workspace
 * pins one version per package, so flattening cannot shadow a second copy, and
 * a flat farm removes every relative-symlink hazard of pnpm's virtual store.
 *
 * Usage: node scripts/collect-runtime-deps.mjs <anchor-package.json> <out-node_modules>
 */

import { createRequire } from 'node:module'
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const refreshWorkspace = process.argv.includes('--refresh-workspace')
const [anchorArg, outArg] = process.argv.slice(2).filter(arg => arg !== '--refresh-workspace')
if (anchorArg === undefined || outArg === undefined) {
  console.error('usage: collect-runtime-deps.mjs [--refresh-workspace] <anchor-package.json> <out-node_modules>')
  process.exit(1)
}

const anchor = resolve(anchorArg)
const outDir = resolve(outArg)

/**
 * Top-level entries no package needs at runtime, whatever its origin.
 *
 * Matched only against a package's OWN top level: a nested `tests` directory
 * can be published fixture data, and `@opentelemetry/*` publishes its runtime
 * under `build/src/`.
 */
const SKIP_TOP_LEVEL = new Set(['node_modules', 'tests', 'test', '.turbo', 'coverage'])

/**
 * Additionally dropped from a WORKSPACE package's top level.
 *
 * A workspace package publishes compiled `lib/`, so its `src/` is TypeScript
 * the runtime never reads. A third-party package's `src/` may be the code it
 * actually imports — `koffi` loads `src/koffi/index.js` — so the same name
 * cannot be skipped for both.
 */
const SKIP_WORKSPACE_ONLY = new Set(['src'])

/**
 * Every workspace package by name.
 *
 * Node's resolver alone is insufficient: a workspace package that pnpm never
 * hoisted (the vendored `cordis-plugin-group` is one) is declared as a
 * dependency yet resolvable from no `node_modules` on disk. The workspace is
 * the authority on where those packages live, so it backs the resolver.
 * @param root - the workspace root holding `pnpm-workspace.yaml`.
 * @returns package name to package directory.
 */
function workspaceIndex(root) {
  const index = new Map()
  const workspaceFile = join(root, 'pnpm-workspace.yaml')
  if (!existsSync(workspaceFile)) return index
  // Read the `packages:` globs without a YAML dependency: each entry is a
  // single-line `  - <glob>` item, which is the only form this file uses.
  const globs = readFileSync(workspaceFile, 'utf8')
    .split('\n')
    .map(line => /^\s+-\s+['"]?([^'"#]+?)['"]?\s*$/.exec(line)?.[1])
    .filter(entry => entry !== undefined && !entry.startsWith('!'))
  for (const pattern of globs) {
    for (const dir of globSync(pattern, { cwd: root })) {
      const manifestPath = join(root, dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const { name } = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof name === 'string' && !index.has(name)) index.set(name, join(root, dir))
    }
  }
  return index
}

const workspaceRoot = (() => {
  let dir = dirname(anchor)
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirname(anchor)
})()

const workspacePackages = workspaceIndex(workspaceRoot)

/**
 * Index pnpm's virtual store by package name.
 *
 * A third resolution source is required because pnpm does not place every
 * installed package where its dependent can resolve it: a platform-specific
 * optional binary (`@img/sharp-darwin-arm64`) and an optional provider
 * (`@earendil-works/pi-ai`) both sit in the store while resolving from their
 * parent fails. Reading the store directly is what distinguishes "installed but
 * unreachable" from "not installed", and only the latter may be skipped.
 * @param root - the workspace root holding `node_modules/.pnpm`.
 * @returns package name to package directory, first version encountered.
 */
function storeIndex(root) {
  const index = new Map()
  const store = join(root, 'node_modules', '.pnpm')
  if (!existsSync(store)) return index
  for (const manifestPath of globSync('*/node_modules/*/package.json', { cwd: store })
    .concat(globSync('*/node_modules/@*/*/package.json', { cwd: store }))) {
    const absolute = join(store, manifestPath)
    let name
    try {
      ({ name } = JSON.parse(readFileSync(absolute, 'utf8')))
    } catch {
      // A store entry mid-write or with an unreadable manifest contributes
      // nothing; the two indexes above still cover the ordinary case.
      continue
    }
    if (typeof name === 'string' && !index.has(name)) index.set(name, dirname(absolute))
  }
  return index
}

const storePackages = storeIndex(workspaceRoot)

/**
 * Resolve one package's directory from a requiring package's manifest path.
 * @param fromManifest - absolute path of the requiring package.json.
 * @param name - the package name to resolve.
 * @returns the resolved package directory, or undefined when unresolvable.
 */
function packageDir(fromManifest, name) {
  const require_ = createRequire(fromManifest)
  try {
    return dirname(require_.resolve(`${name}/package.json`))
  } catch {
    // A package without an exported `./package.json` still resolves through its
    // main entry; walk up from there to the directory holding the manifest.
    try {
      let dir = dirname(require_.resolve(name))
      for (let depth = 0; depth < 10; depth += 1) {
        if (existsSync(join(dir, 'package.json'))) return dir
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    } catch {
      // Falls through to the workspace and store indexes below.
    }
    return workspacePackages.get(name) ?? storePackages.get(name)
  }
}

/** @type {Map<string, string>} package name to its resolved source directory. */
const resolved = new Map()
/** @type {string[]} */
const unresolved = []

/**
 * Every dependency name one manifest can reach at runtime.
 *
 * `optionalDependencies` participate because that is where native modules put
 * their per-platform binaries (`sharp` reaches its `@img/sharp-darwin-arm64`
 * that way); omitting them loads the JS wrapper without its addon and the
 * plugin fails at boot rather than at collect time.
 * @param manifest - a parsed package.json.
 * @returns dependency names in declaration order.
 */
function runtimeDeps(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
}

const anchorManifest = JSON.parse(readFileSync(anchor, 'utf8'))
/** @type {{ manifest: string, deps: string[] }[]} */
const queue = [{ manifest: anchor, deps: runtimeDeps(anchorManifest) }]

while (queue.length > 0) {
  const { manifest, deps } = queue.shift()
  for (const name of deps) {
    if (resolved.has(name)) continue
    const dir = packageDir(manifest, name)
    if (dir === undefined) {
      unresolved.push(`${name} (from ${manifest})`)
      continue
    }
    resolved.set(name, dir)
    const childManifestPath = join(dir, 'package.json')
    const child = JSON.parse(readFileSync(childManifestPath, 'utf8'))
    queue.push({ manifest: childManifestPath, deps: runtimeDeps(child) })
  }
}

/**
 * Copy one resolved package into the flat farm.
 * @param name - package name, used as the destination folder.
 * @param source - resolved source directory.
 */
function copyPackage(name, source) {
  const target = join(outDir, name)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  const prefix = `${source}/`
  const fromWorkspace = workspacePackages.get(name) === source
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (path) => {
      if (!path.startsWith(prefix)) return true
      const relative = path.slice(prefix.length)
      if (relative.includes('/')) return true
      if (SKIP_TOP_LEVEL.has(relative)) return false
      return !(fromWorkspace && SKIP_WORKSPACE_ONLY.has(relative))
    },
  })
}

if (refreshWorkspace) {
  if (!existsSync(join(outDir, '.collect-manifest.json'))) {
    console.error('collect-runtime-deps: --refresh-workspace needs an existing .collect-manifest.json')
    process.exit(1)
  }
  let refreshed = 0
  for (const [name, source] of workspacePackages) {
    const target = join(outDir, name)
    if (!existsSync(target)) continue
    copyPackage(name, source)
    refreshed += 1
  }
  console.log(`collect-runtime-deps: refreshed ${String(refreshed)} workspace packages in ${outDir}`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
let copied = 0
for (const [name, source] of resolved) {
  copyPackage(name, source)
  copied += 1
}

writeFileSync(
  join(outDir, '.collect-manifest.json'),
  `${JSON.stringify({ anchor, packages: [...resolved.keys()].sort(), unresolved }, null, 2)}\n`,
)

console.log(`collect-runtime-deps: copied ${String(copied)} packages to ${outDir}`)
if (unresolved.length > 0) {
  console.log(`collect-runtime-deps: ${String(unresolved.length)} unresolved (platform-optional or dev-only):`)
  for (const entry of unresolved.slice(0, 10)) console.log(`  - ${entry}`)
}
