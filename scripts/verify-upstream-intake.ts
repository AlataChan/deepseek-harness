/**
 * Enforce the upstream intake rules from `docs/plans/2026-10-06-upstream-selective-upgrade.md`.
 *
 * Rules split by when they can be evaluated:
 *
 * - **Working-tree rules** run on every checkout: no never-merge upstream file
 *   or upstream-only directory, the collided desktop path has not become
 *   upstream's Electron application, every gated telemetry or account
 *   reference in a release composition is recorded, and every mounted
 *   telemetry row resolves to no upstream collector.
 * - **Merge-time rules** run once the changed-file list against the upstream
 *   pin is supplied — the command computes it from `git diff`, so they always
 *   run there: every edited upstream file is registered, and every package
 *   upstream removed carries a disposition. Direct callers may omit the list
 *   to check the working-tree rules alone.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadCordisYaml, isJsExpr } from './cordis-yaml.ts'
import {
  FORBIDDEN_DEPENDENCIES,
  FORBIDDEN_ENDPOINTS,
  FORK_OWNED_PATHS,
  GATED_PACKAGE_NAMES,
  GUARDED_MANIFESTS,
  IGNORABLE_INSPECTION,
  MOUNTS,
  NEVER_MERGE,
  PATCHES,
  RELEASE_COMPOSITIONS,
  REMOVALS,
  UPSTREAM_ONLY_DIRECTORIES,
  UPSTREAM_PIN,
  type IntakeRegistry,
  type MountEntry,
} from './upstream-intake-registry.ts'

/** The live registry, assembled from `upstream-intake-registry.ts`. */
export const REGISTRY: IntakeRegistry = {
  upstreamPin: UPSTREAM_PIN,
  ignorableInspection: IGNORABLE_INSPECTION,
  neverMerge: NEVER_MERGE,
  patches: PATCHES,
  mounts: MOUNTS,
  removals: REMOVALS,
  gatedPackageNames: GATED_PACKAGE_NAMES,
  releaseCompositions: RELEASE_COMPOSITIONS,
  forkOwnedPaths: FORK_OWNED_PATHS,
  upstreamOnlyDirectories: UPSTREAM_ONLY_DIRECTORIES,
  forbiddenDependencies: FORBIDDEN_DEPENDENCIES,
  guardedManifests: GUARDED_MANIFESTS,
  forbiddenEndpoints: FORBIDDEN_ENDPOINTS,
}

/** Inputs of one full evaluation. */
export interface IntakeInputs {
  /** Repository root, or a test fixture root. */
  readonly root: string
  /** Registry tables to check against. */
  readonly registry: IntakeRegistry
  /** File list changed against the upstream pin; the command computes it from git, direct callers may omit it. */
  readonly changedUpstreamFiles?: readonly string[]
  /** Every repository-relative file, for the never-merge check. */
  readonly files?: readonly string[]
  /** File reader, injectable for fixtures. */
  readonly readFile?: (absolutePath: string) => string | undefined
}

/** True when `path` is the fork's own file rather than an upstream edit. */
function isForkOwned(path: string, registry: IntakeRegistry): boolean {
  return registry.forkOwnedPaths.some(owned => path === owned.replace(/\/$/, '') || path.startsWith(owned))
}

/**
 * Rule 1 — no never-merge upstream file or upstream-only directory is present.
 *
 * Exact entries are checked by equality against the supplied file list and are
 * deliberately not filtered by fork ownership: the registry names
 * upstream-authored paths, and a file at one of those paths is upstream's by
 * construction. Directories are checked only for `upstreamOnlyDirectories`,
 * which are the directories the fork has no files in. The collided
 * `apps/desktop/` path is not one of them; rule 2 guards it instead.
 *
 * @param registry - registry tables.
 * @param files - repository-relative files that exist on disk.
 * @returns deterministic path-qualified violations.
 */
export function neverMergeViolations(
  registry: IntakeRegistry,
  files: readonly string[],
): string[] {
  const violations: string[] = []
  const present = new Set(files)
  for (const entry of registry.neverMerge) {
    if (entry.path.endsWith('/')) {
      violations.push(`${entry.path}: registry error — a directory entry belongs in upstreamOnlyDirectories, where it is checked`)
      continue
    }
    if (present.has(entry.path)) {
      violations.push(`${entry.path}: never-merge (${entry.tag}) is present — ${entry.reason}`)
    }
  }
  for (const directory of registry.upstreamOnlyDirectories) {
    for (const file of files) {
      if (file.startsWith(directory)) {
        violations.push(`${file}: lives under the upstream-only directory ${directory}`)
      }
    }
  }
  return violations
}

/**
 * Rule 2 — the collided desktop path has not become upstream's Electron app.
 *
 * `apps/desktop/` is a path collision between two independent products, so the
 * fork may keep whatever files it wants there. The invariant that matters is
 * that it does not acquire upstream's Electron runtime, which its manifest
 * shows directly. This is a dependency rule rather than an enumeration of
 * upstream's tree, because an enumeration would rot on the next upstream commit.
 *
 * @param registry - registry tables.
 * @param readFile - file reader, given repository-relative paths.
 * @returns deterministic path-qualified violations.
 */
export function forbiddenDependencyViolations(
  registry: IntakeRegistry,
  readFile: (relativePath: string) => string | undefined,
): string[] {
  const violations: string[] = []
  for (const manifest of registry.guardedManifests) {
    const text = readFile(manifest)
    if (text === undefined) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      violations.push(`${manifest}: not valid JSON, so its dependencies cannot be checked`)
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const record = parsed as Record<string, unknown>
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const section = record[field]
      if (typeof section !== 'object' || section === null) continue
      for (const name of Object.keys(section)) {
        if (registry.forbiddenDependencies.includes(name)) {
          violations.push(`${manifest}: declares ${name} in ${field}, adopting upstream's Electron application`)
        }
      }
    }
  }
  return violations
}

/**
 * Rule 3 — every gated package reference in a release composition is recorded.
 *
 * Classification is by mount, not by package name: `packages/telemetry` is a
 * required dependency of the base composition, so a package-name rule could not
 * survive the first merge. A recorded row may carry an outstanding change; the
 * row's job is to make that change visible, not to fail the tree before the
 * change lands.
 *
 * @param registry - registry tables.
 * @param readFile - file reader, given repository-relative paths.
 * @returns deterministic path-qualified violations.
 */
export function mountRecordingViolations(
  registry: IntakeRegistry,
  readFile: (relativePath: string) => string | undefined,
): string[] {
  const recorded = new Set(registry.mounts.map(mount => `${mount.composition}:${mount.packageName}`))
  const violations: string[] = []
  for (const composition of registry.releaseCompositions) {
    const text = readFile(composition)
    if (text === undefined) continue
    for (const packageName of registry.gatedPackageNames) {
      if (!text.includes(packageName)) continue
      if (recorded.has(`${composition}:${packageName}`)) continue
      violations.push(`${composition}: mounts or depends on ${packageName} with no registry row`)
    }
  }
  return violations
}

/**
 * Rule 4 — every upstream file the fork edits is registered with a reason.
 *
 * A patch with no registry entry is the defect this table exists to catch:
 * without it, "selective intake" decays into "nobody knows what is ours".
 *
 * @param changedUpstreamFiles - paths changed against the upstream pin.
 * @param registry - registry tables.
 * @returns deterministic path-qualified violations.
 */
export function patchRegistryViolations(
  changedUpstreamFiles: readonly string[],
  registry: IntakeRegistry,
): string[] {
  const registered = new Set(registry.patches.map(patch => patch.path))
  return changedUpstreamFiles
    .filter(path => !isForkOwned(path, registry) && !registered.has(path))
    .map(path => `${path}: edits an upstream file with no registry entry`)
}

/**
 * Rule 5 — every package upstream removed carries a disposition.
 *
 * @param registry - registry tables.
 * @returns deterministic path-qualified violations.
 */
export function removalDispositionViolations(registry: IntakeRegistry): string[] {
  return registry.removals
    .filter(entry => entry.disposition === undefined || entry.reason === undefined || entry.reason.trim() === '')
    .map(entry => `${entry.path}: upstream removed it and no disposition is recorded`)
}

/**
 * Rule 6 — every mounted telemetry row resolves to no upstream collector.
 *
 * Endpoint and mode are resolved from the composed Cordis config, not read off
 * the patch text: each row's `!!js` expressions are resolved the way the
 * Loader resolves them with an unset environment, which yields the shipped
 * default. The gate fails on a forbidden endpoint anywhere in the row's
 * composed config — including the raw text of expressions it cannot resolve —
 * and on a default that is not `DISABLED` while an endpoint default exists.
 *
 * @param registry - registry tables.
 * @param readFile - file reader, given repository-relative paths.
 * @returns deterministic path-qualified violations.
 */
export function telemetryEndpointViolations(
  registry: IntakeRegistry,
  readFile: (relativePath: string) => string | undefined,
): string[] {
  const violations: string[] = []
  for (const mount of registry.mounts) {
    const text = readFile(mount.composition)
    if (text === undefined) continue
    let parsed: unknown
    try {
      parsed = loadCordisYaml(text)
    } catch {
      violations.push(`${mount.composition}: not valid Cordis YAML, so mounted row ${mount.row} cannot be resolved`)
      continue
    }
    for (const entry of cordisEntries(parsed)) {
      if (entry.id !== mount.row && entry.name !== mount.packageName) continue
      violations.push(...telemetryRowViolations(registry, mount, entry.config))
    }
  }
  return violations
}

/** Matches the `process.env` default expressions config values are written with. */
const ENV_DEFAULT_EXPR = /^process\.env\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*(?:\|\||\?\?)\s*(?:'([^']*)'|"([^"]*)"))?$/

/**
 * Resolve one composed config value the way the Loader does with an unset
 * environment: a literal stays itself, and a `process.env` expression yields
 * its fallback literal or `undefined`. An expression in any other shape is
 * reported as unresolvable rather than guessed.
 *
 * @param value - a composed config leaf.
 * @returns the resolved value, or unresolvable when the shape is unknown.
 */
function resolveComposedValue(value: unknown): { resolved: true; value: unknown } | { resolved: false } {
  if (!isJsExpr(value)) return { resolved: true, value }
  const match = ENV_DEFAULT_EXPR.exec(value.__jsExpr)
  if (match === null) return { resolved: false }
  return { resolved: true, value: match[2] ?? match[3] }
}

/**
 * Collect every Loader entry object in a parsed Cordis config, at any depth,
 * so patch operations (`insert`, `replace`, nested groups) all surface.
 *
 * @param value - parsed Cordis YAML value.
 * @param out - accumulator for entry records.
 * @returns entry records with a string `id` or `name`.
 */
function cordisEntries(value: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) cordisEntries(item, out)
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string' || typeof record.name === 'string') out.push(record)
    for (const child of Object.values(record)) cordisEntries(child, out)
  }
  return out
}

/**
 * Every literal string and every `!!js` expression's raw text in a row's
 * composed config. The raw text is scanned rather than only the resolved
 * default, because an expression the gate cannot resolve can still hide a
 * forbidden host in its fallback, and a resolvable expression's fallback is
 * always a substring of that text.
 *
 * @param value - the row's config value.
 * @param out - accumulator for collected strings.
 * @returns string leaves and expression texts, at any depth.
 */
function composedStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (isJsExpr(value)) {
    out.push(value.__jsExpr)
  } else if (Array.isArray(value)) {
    for (const item of value) composedStrings(item, out)
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) composedStrings(child, out)
  }
  return out
}

/**
 * Whether any `!!js` expression in the value has a shape the gate cannot
 * resolve, so the composed value cannot be inspected.
 *
 * @param value - a composed config value.
 * @returns whether an unresolvable expression is present, at any depth.
 */
function containsUnresolvableJsExpr(value: unknown): boolean {
  if (isJsExpr(value)) return !resolveComposedValue(value).resolved
  if (Array.isArray(value)) return value.some(containsUnresolvableJsExpr)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsUnresolvableJsExpr)
  }
  return false
}

/**
 * Check one mounted telemetry row's composed config.
 *
 * The exporter subtree fails closed: an exporter that is itself an
 * unresolvable expression, or holds one anywhere inside, is a violation,
 * because the gate cannot see which endpoint the row would compose.
 *
 * @param registry - registry tables, for the forbidden endpoints.
 * @param mount - the mounted row being checked.
 * @param config - the row's composed config value.
 * @returns deterministic path-qualified violations.
 */
function telemetryRowViolations(registry: IntakeRegistry, mount: MountEntry, config: unknown): string[] {
  const violations: string[] = []
  for (const value of composedStrings(config)) {
    // The most specific matching host only: a subdomain match also contains the parent domain.
    const match = registry.forbiddenEndpoints
      .filter(endpoint => value.includes(endpoint.host))
      .sort((a, b) => b.host.length - a.host.length)[0]
    if (match !== undefined) {
      violations.push(`${mount.composition}: row ${mount.row} composes the forbidden endpoint ${match.host} (${match.owner})`)
    }
  }
  const record = typeof config === 'object' && config !== null ? config as Record<string, unknown> : {}
  const exporterValue = record.exporter
  const exporter = typeof exporterValue === 'object' && exporterValue !== null && !isJsExpr(exporterValue)
    ? exporterValue as Record<string, unknown>
    : {}
  const mode = resolveComposedValue(record.mode)
  const url = resolveComposedValue(exporter.url)
  if (!mode.resolved || !url.resolved || containsUnresolvableJsExpr(exporterValue)) {
    violations.push(`${mount.composition}: row ${mount.row} has a mode or endpoint expression the gate cannot resolve`)
    return violations
  }
  // An absent mode composes the plugin schema default (FEEDBACK_ONLY), not DISABLED.
  const effectiveMode = mode.value ?? 'FEEDBACK_ONLY'
  if (effectiveMode !== 'DISABLED' && url.value !== undefined && url.value !== '') {
    violations.push(`${mount.composition}: row ${mount.row} defaults to mode ${describeComposedValue(effectiveMode)} with a default endpoint ${describeComposedValue(url.value)}`)
  }
  return violations
}

/**
 * Render a composed config value for a violation message without falling back
 * to Object's default stringification.
 *
 * @param value - a resolved composed config leaf.
 * @returns a printable rendering of the value.
 */
function describeComposedValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Build the file list rule 1 needs from disk: the registry's exact paths that
 * actually exist, plus every file under its upstream-only directories. Exact
 * paths are existence-probed rather than assumed, so the check reads disk truth
 * and never treats the registry itself as evidence.
 *
 * @param root - repository root.
 * @param registry - registry tables.
 * @returns repository-relative file paths that exist on disk.
 */
export function neverMergeFileList(root: string, registry: IntakeRegistry): string[] {
  const files: string[] = registry.neverMerge
    .filter(entry => !entry.path.endsWith('/') && existsSync(resolve(root, entry.path)))
    .map(entry => entry.path)
  for (const directory of registry.upstreamOnlyDirectories) {
    const prefix = directory.replace(/\/$/, '')
    try {
      for (const child of readdirSync(resolve(root, prefix), {
        recursive: true,
        encoding: 'utf8',
        withFileTypes: true,
      })) {
        if (!child.isFile()) continue
        const absolute = resolve(child.parentPath, child.name)
        const relativePath = `${prefix}/${relative(resolve(root, prefix), absolute)}`
        files.push(relativePath.replaceAll('\\', '/'))
      }
    } catch {
      // A missing directory is absence of the never-merge surface, not a failure.
    }
  }
  return files
}

/**
 * A composition surface rule 4 must see outside `src/`: dependency manifests
 * and Cordis compositions under `packages/` and `apps/`, at any depth. These
 * files decide what the harness mounts — the fork's workspace Host
 * dependencies live in `apps/cli/package.json`, and each package's
 * `package.json` and `cordis.yml` / `cordis.patch.yml` can add or reorder
 * plugins. `tsconfig.json` is deliberately excluded: no registered patch
 * edits one, so it is build configuration, not composition surface.
 */
function isCompositionSurface(path: string): boolean {
  if (!path.startsWith('packages/') && !path.startsWith('apps/')) return false
  return path.endsWith('/package.json') || path.endsWith('/cordis.yml') || path.endsWith('/cordis.patch.yml')
}

/**
 * Rule 4's input: the upstream files the working tree edits, read from
 * `git diff --name-only --diff-filter=M` against the registry's upstream pin.
 * Modified files only — an addition is a fork-authored file (rules 1–3 govern
 * those) and a deletion is a removal decision (rule 5 and the never-merge
 * tables). The patch surface is the `src/` tree, the release composition
 * manifests, and every `package.json` / `cordis.yml` / `cordis.patch.yml`
 * under `packages/` and `apps/` (see {@link isCompositionSurface}), matching
 * what the registry's patch table records: behaviour and composition edits,
 * not docs, tests, or generated files.
 *
 * @param root - repository root.
 * @param registry - registry tables, for the pin and the composition manifests.
 * @returns repository-relative upstream files the working tree edits.
 * @throws when git or the pin is unreadable, so the command fails loud instead of leaving rule 4 dormant.
 */
export function changedUpstreamFilesAgainstPin(root: string, registry: IntakeRegistry): string[] {
  const output = execFileSync('git', ['-C', root, 'diff', '--name-only', '--diff-filter=M', registry.upstreamPin], { encoding: 'utf8' })
  return output.split('\n')
    .filter(path => path !== '')
    .filter(path => path.includes('/src/') || isCompositionSurface(path) || registry.releaseCompositions.includes(path))
}

/**
 * Evaluate every applicable intake rule.
 *
 * @param inputs - repository root, registry, and optional merge-time file list.
 * @returns deterministic violations; empty when every applicable rule passes.
 */
export function upstreamIntakeViolations(inputs: IntakeInputs): string[] {
  const { root, registry } = inputs
  const files = inputs.files ?? neverMergeFileList(root, registry)
  const readFile = inputs.readFile ?? ((path) => {
    const absolute = resolve(root, path)
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined
  })
  const mergeTime = inputs.changedUpstreamFiles !== undefined
  return [
    ...neverMergeViolations(registry, files),
    ...forbiddenDependencyViolations(registry, readFile),
    ...mountRecordingViolations(registry, readFile),
    ...telemetryEndpointViolations(registry, readFile),
    ...(mergeTime ? patchRegistryViolations(inputs.changedUpstreamFiles ?? [], registry) : []),
    ...(mergeTime ? removalDispositionViolations(registry) : []),
  ]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..')
  let failures: string[]
  try {
    const changedUpstreamFiles = changedUpstreamFilesAgainstPin(root, REGISTRY)
    failures = upstreamIntakeViolations({ root, registry: REGISTRY, changedUpstreamFiles })
  } catch (error) {
    failures = [`cannot diff the working tree against the upstream pin ${REGISTRY.upstreamPin}: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (failures.length > 0) {
    console.error('verify-upstream-intake: unrecorded upstream surface:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`verify-upstream-intake: intake complete; ${REGISTRY.mounts.length} recorded change(s) outstanding.`)
  }
}
