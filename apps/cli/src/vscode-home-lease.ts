/** Exclusive lifecycle lease for a VS Code companion's resolved DSH_HOME. */

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Current on-disk owner-record version. */
export const VSCODE_HOME_LEASE_VERSION = 1

/** Lease location relative to the resolved Harness home. */
export const VSCODE_HOME_LEASE_RELATIVE_PATH = join('.locks', 'vscode-companion.lock')

/** Durable owner facts used for liveness checks and token-matched release. */
export interface VsCodeHomeLeaseRecord {
  /** Owner-record format version. */
  version: 1
  /** Companion process id. */
  pid: number
  /** Random token unique to this acquisition. */
  instanceId: string
  /** ISO timestamp recorded for diagnostics; age never breaks a lease. */
  startedAt: string
  /** Absolute Harness home protected by this record. */
  home: string
}

/** Result of probing an existing owner without assuming permission failures mean death. */
export type ProcessLiveness = 'alive' | 'dead' | 'indeterminate'

/** Injectable process facts for deterministic lease tests. */
export interface VsCodeHomeLeaseOptions {
  /** Owning process id. */
  pid?: number
  /** Owning process token. */
  instanceId?: string
  /** Timestamp source. */
  now?: () => Date
  /** Existing-owner liveness probe. */
  probePid?: (pid: number) => ProcessLiveness
}

/** An existing live, corrupt, or indeterminate owner prevents profile boot. */
export class VsCodeHomeBusyError extends Error {
  /** Stable startup error code sent through the companion carrier. */
  readonly code = 'home-busy'
}

/** Acquired lease handle; release is idempotent and token-matched. */
export interface VsCodeHomeLease {
  /** Absolute lease-file path. */
  readonly path: string
  /** This process's immutable owner token. */
  readonly owner: Readonly<VsCodeHomeLeaseRecord>
  /** Remove this process's record if it still owns the lease path. */
  release(): void
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

function defaultProbePid(pid: number): ProcessLiveness {
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    if (isErrno(error, 'ESRCH')) return 'dead'
    return 'indeterminate'
  }
}

function parseRecord(value: unknown, expectedHome: string): VsCodeHomeLeaseRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Partial<VsCodeHomeLeaseRecord>
  if (record.version !== VSCODE_HOME_LEASE_VERSION
    || !Number.isSafeInteger(record.pid) || (record.pid as number) <= 0
    || typeof record.instanceId !== 'string' || record.instanceId === ''
    || typeof record.startedAt !== 'string' || Number.isNaN(Date.parse(record.startedAt))
    || record.home !== expectedHome) return undefined
  return record as VsCodeHomeLeaseRecord
}

function readRecord(path: string, home: string): VsCodeHomeLeaseRecord | undefined {
  try {
    if (!lstatSync(path).isFile()) return undefined
    return parseRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown, home)
  } catch {
    // Partial, malformed, link-shaped, or unreadable ownership is
    // indeterminate and therefore cannot be broken automatically.
    return undefined
  }
}

function sameOwner(left: VsCodeHomeLeaseRecord | undefined, right: VsCodeHomeLeaseRecord): boolean {
  return left?.version === right.version
    && left.pid === right.pid
    && left.instanceId === right.instanceId
    && left.startedAt === right.startedAt
    && left.home === right.home
}

function writeExclusive(path: string, owner: VsCodeHomeLeaseRecord): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(owner) + '\n')
  } finally {
    closeSync(descriptor)
  }
}

function busy(home: string, owner?: VsCodeHomeLeaseRecord): VsCodeHomeBusyError {
  const detail = owner === undefined ? 'owner record is corrupt or unreadable' : `process ${String(owner.pid)} owns it`
  return new VsCodeHomeBusyError(`VS Code companion cannot use ${home}: ${detail}`)
}

function assertNoRecovery(path: string, home: string): void {
  try {
    lstatSync(path)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return
    throw busy(home)
  }
  throw busy(home)
}

/**
 * Acquire one exclusive companion lease before any profile plugin starts.
 * A definitely dead owner is archived once; live, corrupt, and permission-
 * indeterminate ownership fails closed. Record age is diagnostic only.
 * @param home - Harness home to protect.
 * @param options - injectable owner and liveness facts.
 * @returns the acquired token-matched lease handle.
 */
export function acquireVsCodeHomeLease(
  home: string,
  options: VsCodeHomeLeaseOptions = {},
): VsCodeHomeLease {
  const resolvedHome = resolve(home)
  const path = join(resolvedHome, VSCODE_HOME_LEASE_RELATIVE_PATH)
  const recoveryPath = `${path}.recovery`
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const owner: VsCodeHomeLeaseRecord = Object.freeze({
    version: VSCODE_HOME_LEASE_VERSION,
    pid: options.pid ?? process.pid,
    instanceId: options.instanceId ?? randomUUID(),
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    home: resolvedHome,
  })
  const probePid = options.probePid ?? defaultProbePid

  assertNoRecovery(recoveryPath, resolvedHome)
  try {
    writeExclusive(path, owner)
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error
    const existing = readRecord(path, resolvedHome)
    if (existing === undefined) throw busy(resolvedHome)
    const liveness = probePid(existing.pid)
    if (liveness !== 'dead') throw busy(resolvedHome, existing)
    try {
      mkdirSync(recoveryPath, { mode: 0o700 })
    } catch {
      throw busy(resolvedHome)
    }
    try {
      const recovered = readRecord(path, resolvedHome)
      if (!sameOwner(recovered, existing) || recovered === undefined || probePid(recovered.pid) !== 'dead') {
        throw busy(resolvedHome, recovered)
      }
      const stalePath = `${path}.stale-${String(Date.now())}-${randomUUID()}`
      try {
        renameSync(path, stalePath)
      } catch {
        throw busy(resolvedHome, readRecord(path, resolvedHome))
      }
      try {
        writeExclusive(path, owner)
      } catch (retryError) {
        if (isErrno(retryError, 'EEXIST')) throw busy(resolvedHome, readRecord(path, resolvedHome))
        throw retryError
      }
    } finally {
      rmdirSync(recoveryPath)
    }
  }

  let released = false
  return {
    path,
    owner,
    release: () => {
      if (released) return
      released = true
      if (!sameOwner(readRecord(path, resolvedHome), owner)) return
      try {
        unlinkSync(path)
      } catch (error) {
        // A concurrent dead-owner recovery can remove the old path after its
        // owner exits; the missing token is already released.
        if (!isErrno(error, 'ENOENT')) throw error
      }
    },
  }
}
