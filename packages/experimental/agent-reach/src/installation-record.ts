/**
 * Versioned installation record stored beside plugin-owned runtime files.
 *
 * Persists ownership, lock identifier, installed tools, and digests with atomic writes
 * and restrictive file permissions. Never records credentials.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/installation-record
 */

import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { RUNTIME_MANIFEST_DIGEST } from './runtime-lock.ts'
import * as path from 'node:path'

/** Owner-record schema accepted by this runtime; other versions are refused. */
export const INSTALLATION_RECORD_SCHEMA_VERSION = 1

/** Installed command identity and verification data, excluding credentials. */
export interface InstalledToolEntry {
  readonly version: string
  readonly executablePath: string
  readonly digest: string
  readonly installedAt: string
}

/** One promoted private runtime generation and its frozen recipe identity. */
export interface InstallationRecord {
  readonly schemaVersion: number
  readonly manifestDigest: string
  readonly lockId: string
  readonly upstreamRevision: string
  readonly installedAt: string
  readonly releaseRoot: string
  readonly coreVenvPath: string
  readonly toolVenvPath?: string | undefined
  readonly tools: Record<string, InstalledToolEntry>
}

/** Absence is distinct from invalid or incompatible installed data. */
export type ReadRecordStatus = 'present' | 'absent' | 'corrupt'

/** Local record inspection without starting acquisition or processes. */
export type ReadInstallationRecordResult =
  | { readonly status: 'present'; readonly record: InstallationRecord; readonly error?: undefined }
  | { readonly status: 'absent'; readonly record?: undefined; readonly error?: undefined }
  | { readonly status: 'corrupt'; readonly record?: undefined; readonly error: string }

/**
 * Validate that an untrusted object conforms to the InstallationRecord contract.
 *
 * @param raw - parsed JSON value
 * @returns validated InstallationRecord
 * @throws Error if validation fails
 */
export function validateInstallationRecord(raw: unknown): InstallationRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Installation record must be an object')
  }

  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== INSTALLATION_RECORD_SCHEMA_VERSION) {
    throw new Error(`Unsupported installation record schema version: ${String(obj.schemaVersion)}`)
  }

  if (
    typeof obj.lockId !== 'string' ||
    typeof obj.upstreamRevision !== 'string' ||
    typeof obj.releaseRoot !== 'string' ||
    typeof obj.coreVenvPath !== 'string'
  ) {
    throw new Error('Installation record missing required path or identification strings')
  }

  const releaseRoot = path.resolve(obj.releaseRoot)
  const within = (value: unknown): string => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Installation path must be absolute')
    const relative = path.relative(releaseRoot, value)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Installation path escapes release root')
    return value
  }
  const timestamp = (value: unknown): string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error('Invalid installation timestamp')
    }
    return value
  }
  if (obj.manifestDigest !== RUNTIME_MANIFEST_DIGEST || obj.lockId !== RUNTIME_MANIFEST_DIGEST.slice(0,12)) throw new Error('Unsupported runtime recipe')
  if (!/^[a-f0-9]{12}$/.test(obj.lockId) || !/^[a-f0-9]{40}$/.test(obj.upstreamRevision)) {
    throw new Error('Invalid installation identity')
  }
  if (typeof obj.tools !== 'object' || obj.tools === null || Array.isArray(obj.tools)) throw new Error('Invalid tools record')
  const tools: Record<string, InstalledToolEntry> = {}
  for (const [key, value] of Object.entries(obj.tools)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid tool entry')
    const tool = value as Record<string, unknown>
    if (typeof tool.version !== 'string' || !tool.version) throw new Error('Invalid tool version')
    if (typeof tool.digest !== 'string' || !/^[a-f0-9]{64}$/.test(tool.digest)) {
      throw new Error('Invalid tool digest')
    }
    tools[key] = {
      version: tool.version, executablePath: within(tool.executablePath), installedAt: timestamp(tool.installedAt),
      digest: tool.digest,
    }
  }
  return {
    schemaVersion: INSTALLATION_RECORD_SCHEMA_VERSION, manifestDigest:RUNTIME_MANIFEST_DIGEST,
    lockId: obj.lockId, upstreamRevision: obj.upstreamRevision,
    installedAt: timestamp(obj.installedAt), releaseRoot, coreVenvPath: within(obj.coreVenvPath), tools,
    ...(obj.toolVenvPath === undefined ? {} : { toolVenvPath: within(obj.toolVenvPath) }),
  }
}

/**
 * Read the installation record from disk with explicit status classification (present, absent, corrupt).
 *
 * @param recordFilePath - path to installation-record.json
 * @returns ReadInstallationRecordResult
 */
export function readInstallationRecordDetailed(recordFilePath: string): ReadInstallationRecordResult {
  try {
    const content = fs.readFileSync(recordFilePath, 'utf-8')
    const parsed: unknown = JSON.parse(content)
    const record = validateInstallationRecord(parsed)
    if (path.resolve(record.releaseRoot) !== path.resolve(path.dirname(recordFilePath))) throw new Error('Record ownership mismatch')
    const realRoot = fs.realpathSync(record.releaseRoot)
    for (const directory of [record.coreVenvPath, record.toolVenvPath].filter((entry): entry is string => entry !== undefined)) {
      const relative = path.relative(realRoot, fs.realpathSync(directory))
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Runtime directory escapes owner')
    }
    const core = record.tools['agent-reach']
    const bin = process.platform === 'win32' ? 'Scripts' : 'bin'
    const launcher = process.platform === 'win32' ? 'agent-reach.exe' : 'agent-reach'
    if (!core || path.resolve(core.executablePath) !== path.resolve(record.coreVenvPath, bin, launcher)) {
      throw new Error('Missing or mismatched core executable identity')
    }
    for (const tool of Object.values(record.tools)) {
      const relative = path.relative(realRoot, fs.realpathSync(tool.executablePath))
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Executable escapes owner')
      if (createHash('sha256').update(fs.readFileSync(tool.executablePath)).digest('hex') !== tool.digest) {
        throw new Error('Installed executable digest mismatch')
      }
    }
    return { status: 'present', record }
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT' && !fs.existsSync(recordFilePath)) {
      return { status:'absent' }
    }
    return { status: 'corrupt', error: String(err) }
  }
}

/**
 * Read the installation record from disk.
 *
 * @param recordFilePath - path to installation-record.json
 * @returns InstallationRecord or null if absent or corrupt
 */
export function readInstallationRecord(recordFilePath: string): InstallationRecord | null {
  const res = readInstallationRecordDetailed(recordFilePath)
  return res.status === 'present' ? res.record : null
}

/**
 * Write the installation record atomically with restrictive (0o600) permissions.
 *
 * @param recordFilePath - destination path
 * @param record - InstallationRecord to save
 */
export function writeInstallationRecordAtomic(recordFilePath: string, record: InstallationRecord): void {
  const dir = path.dirname(recordFilePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  const tmpPath = `${recordFilePath}.${process.pid}.${Date.now()}.tmp`
  const serialized = JSON.stringify(validateInstallationRecord(record), null, 2)

  fs.writeFileSync(tmpPath, serialized, { mode: 0o600 })
  fs.renameSync(tmpPath, recordFilePath)
}
