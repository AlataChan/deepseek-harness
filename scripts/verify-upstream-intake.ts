/**
 * Enforce the upstream intake rules from `docs/plans/2026-10-06-upstream-selective-upgrade.md`.
 *
 * Rules split by when they can be evaluated:
 *
 * - **Working-tree rules** run on every checkout: no never-merge upstream file
 *   or upstream-only directory, the collided desktop path has not become
 *   upstream's Electron application, and every gated telemetry or account
 *   reference in a release composition is recorded in the registry.
 * - **Merge-time rules** run only when the caller supplies the file list the
 *   fork changed against the upstream pin: every edited upstream file is
 *   registered, and every package upstream removed carries a disposition.
 *   They stay dormant before the merge, because the fork has not yet been asked
 *   the question they check.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  FORBIDDEN_DEPENDENCIES,
  FORK_OWNED_PATHS,
  GATED_PACKAGE_NAMES,
  GUARDED_MANIFESTS,
  MOUNTS,
  NEVER_MERGE,
  PATCHES,
  RELEASE_COMPOSITIONS,
  REMOVALS,
  UPSTREAM_ONLY_DIRECTORIES,
  type IntakeRegistry,
} from './upstream-intake-registry.ts'

/** The live registry, assembled from `upstream-intake-registry.ts`. */
export const REGISTRY: IntakeRegistry = {
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
}

/** Inputs of one full evaluation. */
export interface IntakeInputs {
  /** Repository root, or a test fixture root. */
  readonly root: string
  /** Registry tables to check against. */
  readonly registry: IntakeRegistry
  /** File list changed against the upstream pin; absent before the merge. */
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
      for (const child of readdirSync(resolve(root, prefix), { recursive: true, encoding: 'utf8' })) {
        const relative = `${prefix}/${child}`.replaceAll('\\', '/')
        if (relative.endsWith('/')) continue
        files.push(relative)
      }
    } catch {
      // A missing directory is absence of the never-merge surface, not a failure.
    }
  }
  return files
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
    ...(mergeTime ? patchRegistryViolations(inputs.changedUpstreamFiles ?? [], registry) : []),
    ...(mergeTime ? removalDispositionViolations(registry) : []),
  ]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..')
  const failures = upstreamIntakeViolations({ root, registry: REGISTRY })
  if (failures.length > 0) {
    console.error('verify-upstream-intake: unrecorded upstream surface:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`verify-upstream-intake: intake complete; ${REGISTRY.mounts.length} recorded change(s) outstanding.`)
  }
}
