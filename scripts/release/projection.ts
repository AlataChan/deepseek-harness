/** Fail-closed projection of source-named DSH package payloads. */

import {
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ResolvedPublicationTarget } from './targets.ts'

/** Source namespace whose absence is required after projection. */
const SOURCE_DSH_PREFIX = '@deepseek-ai/dsh'

/** Bytes that identify a residual source-scope DSH reference. */
const SOURCE_DSH_BYTES = Buffer.from(SOURCE_DSH_PREFIX)

/** Package-derived runtime identifiers that are not npm package references. */
const PACKAGE_RUNTIME_IDENTIFIERS = [
  { packageName: '@deepseek-ai/dsh-tools', suffix: '.scheduler' },
] as const

/** Decode UTF-8 strictly so binary payloads are never rewritten through replacement characters. */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

/**
 * Escape text for use as a regular-expression literal.
 * @param value - literal text.
 * @returns Escaped expression text.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Project known package names, package-derived runtime identifiers, and a
 * delimiter-terminated DSH namespace prefix inside one UTF-8 payload.
 *
 * A package-name character after a known name means the occurrence may be a
 * different package, so it remains for residual validation instead of being
 * partially rewritten.
 * @param text - UTF-8 payload text.
 * @param target - resolved target and complete family inventory.
 * @param _path - payload path reserved for caller diagnostics.
 * @returns Projected text.
 */
export function projectText(
  text: string,
  target: ResolvedPublicationTarget,
  _path: string,
): string {
  let projected = text
  for (const entry of target.projections) {
    const expression = new RegExp(`${escapeRegExp(entry.source)}(?=$|[^A-Za-z0-9._-])`, 'g')
    projected = projected.replace(expression, entry.target)
  }
  for (const identifier of PACKAGE_RUNTIME_IDENTIFIERS) {
    const packageName = target.projectReference(identifier.packageName)
    if (packageName === undefined) continue
    const source = `${identifier.packageName}${identifier.suffix}`
    const expression = new RegExp(`${escapeRegExp(source)}(?=$|[^A-Za-z0-9._-])`, 'g')
    projected = projected.replace(expression, `${packageName}${identifier.suffix}`)
  }
  const root = target.projections.find(entry => entry.source === SOURCE_DSH_PREFIX)
  if (root !== undefined) {
    const namespacePrefix = new RegExp(`${escapeRegExp(root.source)}-(?=$|[^A-Za-z0-9._-])`, 'g')
    projected = projected.replace(namespacePrefix, `${root.target}-`)
  }
  return projected
}

/**
 * Project package identities recursively through JSON keys and string values.
 * @param value - parsed JSON value.
 * @param target - resolved publication target.
 * @param path - manifest path for collision diagnostics.
 * @returns A projected JSON value.
 */
function projectJson(value: unknown, target: ResolvedPublicationTarget, path: string): unknown {
  if (typeof value === 'string') return projectText(value, target, path)
  if (Array.isArray(value)) return value.map(entry => projectJson(entry, target, path))
  if (value === null || typeof value !== 'object') return value

  const projected: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const projectedKey = projectText(key, target, path)
    if (Object.hasOwn(projected, projectedKey)) {
      throw new Error(`${path}: publication projection produces duplicate JSON key ${projectedKey}`)
    }
    projected[projectedKey] = projectJson(entry, target, path)
  }
  return projected
}

/**
 * Decode a regular file only when it is safe UTF-8 text.
 * @param bytes - file contents.
 * @returns Decoded text, or undefined for a binary payload.
 */
function decodeText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    return UTF8_DECODER.decode(bytes)
  } catch (error) {
    // TextDecoder throws only for invalid UTF-8 under the fatal policy.
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/**
 * Extract a useful residual package reference from raw payload bytes.
 * @param bytes - final file contents.
 * @returns The residual reference, or undefined when none exists.
 */
function residualDshReference(bytes: Buffer): string | undefined {
  const index = bytes.indexOf(SOURCE_DSH_BYTES)
  if (index === -1) return undefined
  const tail = bytes.subarray(index, Math.min(bytes.length, index + 256)).toString('latin1')
  return /^@deepseek-ai\/dsh(?:-[A-Za-z0-9._-]+)?(?:\/[A-Za-z0-9._~/-]+)?/.exec(tail)?.[0]
    ?? SOURCE_DSH_PREFIX
}

/**
 * Assert one symlink remains within the extracted package directory.
 * @param packageRoot - absolute extracted `package/` directory.
 * @param path - absolute symlink path.
 */
function assertSafeSymlink(packageRoot: string, path: string): void {
  const target = readlinkSync(path)
  if (isAbsolute(target)) throw new Error(`${relative(packageRoot, path)} symlink escapes package/: ${target}`)
  const resolved = resolve(dirname(path), target)
  const fromRoot = relative(packageRoot, resolved)
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw new Error(`${relative(packageRoot, path)} symlink escapes package/: ${target}`)
  }
}

/**
 * Return every regular payload file after validating directory entries and links.
 * @param packageRoot - absolute extracted `package/` directory.
 * @returns Absolute regular-file paths sorted by package-relative path.
 */
function payloadFiles(packageRoot: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else if (entry.isFile()) {
        files.push(path)
      } else if (entry.isSymbolicLink()) {
        assertSafeSymlink(packageRoot, path)
      } else {
        throw new Error(`${relative(packageRoot, path)} has unsupported packed file type`)
      }
    }
  }
  walk(packageRoot)
  return files
}

/**
 * Project an extracted npm `package/` directory in place.
 * @param packageRoot - absolute extracted package directory.
 * @param target - resolved target and complete family inventory.
 */
export function projectExtractedPackage(packageRoot: string, target: ResolvedPublicationTarget): void {
  const files = payloadFiles(packageRoot)
  for (const path of files) {
    const label = relative(packageRoot, path).replaceAll('\\', '/')
    const bytes = readFileSync(path)
    const text = decodeText(bytes)
    if (text === undefined) continue
    const projected = label === 'package.json'
      ? `${JSON.stringify(projectJson(JSON.parse(text) as unknown, target, label), null, 2)}\n`
      : projectText(text, target, label)
    if (projected !== text) writeFileSync(path, projected)
  }

  for (const path of files) {
    const residual = residualDshReference(readFileSync(path))
    if (residual !== undefined) {
      const label = relative(packageRoot, path).replaceAll('\\', '/')
      throw new Error(`${label}: unresolved source DSH package reference ${residual}`)
    }
  }
}
