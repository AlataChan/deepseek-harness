/** Installed Harness and real Node discovery for the VS Code extension host. */

import { execFile } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HARNESS_PACKAGE_NAME = '@deepseek-ai/dsh'

/** Verified launch inputs; no field names a shell command. */
export interface ResolvedInstalledRuntime {
  /** Canonical real Node executable. */
  nodePath: string
  /** Canonical installed Harness package root. */
  packageRoot: string
  /** Canonical JavaScript module declared by `dsh.companions.vscode`. */
  companionEntry: string
  /** Installed Harness package version. */
  runtimeVersion: string
  /** User or PATH candidate used only to locate the package. */
  discoveryPath: string
}

/** Injectable discovery inputs for settings, PATH, platform tests, and Node probing. */
export interface RuntimeResolverOptions {
  /** Explicit package root, manifest, JS bin, or recognized shim. */
  runtimePath?: string
  /** Explicit real Node executable. */
  nodePath?: string
  /** Extension-host PATH value. */
  pathValue?: string
  /** Platform whose PATH candidate names are considered. */
  platform?: NodeJS.Platform
  /** Probe returning the selected executable's `node --version` output. */
  nodeProbe?: (nodePath: string) => Promise<string>
}

interface HarnessManifest {
  name?: unknown
  version?: unknown
  dsh?: { companions?: { vscode?: unknown } }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function executableOnPath(names: readonly string[], pathValue: string, platform: NodeJS.Platform): string | undefined {
  const separator = platform === 'win32' ? ';' : delimiter
  for (const directory of pathValue.split(separator).filter(Boolean)) {
    for (const name of names) {
      const candidate = resolve(directory, name)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

async function defaultNodeProbe(nodePath: string): Promise<string> {
  const { stdout } = await execFileAsync(nodePath, ['--version'], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  })
  return stdout.trim()
}

function assertSupportedNode(version: string): void {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  if (match === null) throw new Error(`Node executable returned an invalid version: ${JSON.stringify(version)}`)
  const major = Number(match[1])
  const minor = Number(match[2])
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    throw new Error(`Node ${version.trim()} is not compatible with Harness (^22.19.0 or >=24.0.0)`)
  }
}

function resolveNodeCandidate(options: RuntimeResolverOptions, platform: NodeJS.Platform): string {
  const selected = options.nodePath ?? executableOnPath(
    platform === 'win32' ? ['node.exe'] : ['node'],
    options.pathValue ?? process.env.PATH ?? '',
    platform,
  )
  if (selected === undefined) {
    throw new Error('Node executable was not found; configure harnessClient.nodePath or add real Node to PATH')
  }
  const extension = extname(selected).toLowerCase()
  if (extension === '.cmd' || extension === '.ps1') {
    throw new Error(`Node executable must be a real binary, not a ${extension} shim: ${selected}`)
  }
  if (!isFile(selected)) throw new Error(`Node executable does not exist or is not a file: ${selected}`)
  return realpathSync(selected)
}

function nearestManifest(start: string): string | undefined {
  let current = isDirectory(start) ? realpathSync(start) : dirname(realpathSync(start))
  while (true) {
    const manifest = join(current, 'package.json')
    if (isFile(manifest)) return manifest
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function quotedJavaScriptTargets(contents: string, base: string): string[] {
  const normalized = contents.replaceAll('\\', '/')
  const targets = new Set<string>()
  for (const match of normalized.matchAll(/["']([^"'\r\n]+\.(?:c|m)?js)["']/gi)) {
    const raw = match[1]
      ?.replace(/%~dp0/gi, `${base}/`)
      .replace(/\$basedir/gi, base)
    if (raw === undefined || raw.includes('$') || raw.includes('%')) continue
    const target = isAbsolute(raw) ? resolve(raw) : resolve(base, raw)
    if (isFile(target)) targets.add(realpathSync(target))
  }
  return [...targets]
}

function resolveShimTarget(path: string): string {
  const contents = readFileSync(path, 'utf8')
  const extension = extname(path).toLowerCase()
  const recognizedHeader = extension === '.cmd'
    ? /%~dp0/i.test(contents)
    : extension === '.ps1'
      ? /\$basedir/i.test(contents)
      : /^#!\s*\/bin\/sh\b/.test(contents) && /\$basedir/.test(contents)
  const targets = recognizedHeader ? quotedJavaScriptTargets(contents, dirname(path)) : []
  if (targets.length !== 1) throw new Error(`unrecognized dsh package-manager shim: ${path}`)
  return targets[0] as string
}

function runtimeAnchor(candidate: string): string {
  const absolute = resolve(candidate)
  if (isDirectory(absolute)) return realpathSync(absolute)
  if (!isFile(absolute)) throw new Error(`Harness runtime discovery path does not exist: ${absolute}`)
  const real = realpathSync(absolute)
  if (lstatSync(absolute).isSymbolicLink()) return real
  const extension = extname(absolute).toLowerCase()
  if (extension === '.cmd' || extension === '.ps1') return resolveShimTarget(absolute)
  const contents = readFileSync(absolute, 'utf8')
  if (extension === '' && /^#!\s*\/bin\/sh\b/.test(contents)) return resolveShimTarget(absolute)
  return real
}

function resolveRuntimeCandidate(options: RuntimeResolverOptions, platform: NodeJS.Platform): string {
  if (options.runtimePath !== undefined) return resolve(options.runtimePath)
  const clue = executableOnPath(
    platform === 'win32' ? ['dsh', 'dsh.cmd', 'dsh.ps1'] : ['dsh'],
    options.pathValue ?? process.env.PATH ?? '',
    platform,
  )
  if (clue === undefined) {
    throw new Error('Harness runtime was not found; configure harnessClient.runtimePath or add dsh to PATH')
  }
  return clue
}

function validateManifest(anchor: string, discoveryPath: string): Omit<ResolvedInstalledRuntime, 'nodePath'> {
  const manifestPath = isDirectory(anchor) && isFile(join(anchor, 'package.json'))
    ? join(anchor, 'package.json')
    : nearestManifest(anchor)
  if (manifestPath === undefined) throw new Error(`Harness package manifest was not found from ${discoveryPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as HarnessManifest
  if (manifest.name !== HARNESS_PACKAGE_NAME) {
    throw new Error(`Harness package name must be ${HARNESS_PACKAGE_NAME}, got ${JSON.stringify(manifest.name)}`)
  }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('Harness package version is missing')
  }
  const declared = manifest.dsh?.companions?.vscode
  if (typeof declared !== 'string' || declared === '') {
    throw new Error('Harness package does not declare dsh.companions.vscode')
  }
  const packageRoot = realpathSync(dirname(manifestPath))
  const declaredEntry = resolve(packageRoot, declared)
  const extension = extname(declaredEntry).toLowerCase()
  if (extension !== '.js' && extension !== '.mjs' && extension !== '.cjs') {
    throw new Error('Harness VS Code companion entry must be a JavaScript module')
  }
  const within = relative(packageRoot, declaredEntry)
  if (within === '' || within.startsWith('..') || isAbsolute(within)) {
    throw new Error('Harness VS Code companion entry must stay inside the installed package')
  }
  if (!isFile(declaredEntry)) throw new Error(`Harness VS Code companion entry is missing: ${declaredEntry}`)
  const companionEntry = realpathSync(declaredEntry)
  const canonicalWithin = relative(packageRoot, companionEntry)
  if (canonicalWithin === '' || canonicalWithin.startsWith('..') || isAbsolute(canonicalWithin)) {
    throw new Error('Harness VS Code companion entry must resolve inside the installed package')
  }
  return {
    packageRoot,
    companionEntry,
    runtimeVersion: manifest.version,
    discoveryPath,
  }
}

/**
 * Resolve verified direct-fork inputs without executing any dsh or package-manager shim.
 * @param options - settings, PATH, platform, and injectable Node version probe.
 * @returns canonical Node, package, and declared companion paths.
 */
export async function resolveInstalledRuntime(options: RuntimeResolverOptions = {}): Promise<ResolvedInstalledRuntime> {
  const platform = options.platform ?? process.platform
  const nodePath = resolveNodeCandidate(options, platform)
  const version = await (options.nodeProbe ?? defaultNodeProbe)(nodePath)
  assertSupportedNode(version)
  const discoveryPath = resolveRuntimeCandidate(options, platform)
  const anchor = runtimeAnchor(discoveryPath)
  return { nodePath, ...validateManifest(anchor, discoveryPath) }
}
