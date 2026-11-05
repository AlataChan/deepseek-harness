/**
 * Process-wide shared-desktop lease.
 * The kernel lock is an exclusive nonblocking flock on a stable inode.
 * The lock file is never unlinked.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/lease
 */

import { mkdir, open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'

/** Stderr line a second supervisor writes before it exits. */
export const SHARED_DESKTOP_LEASE_HELD = 'desktop-operation: shared desktop lease is held'

/** Another live descriptor already holds the desktop lease. */
export class DesktopLeaseBusyError extends Error {
  constructor() {
    super(SHARED_DESKTOP_LEASE_HELD)
    this.name = 'DesktopLeaseBusyError'
  }
}

/** The locked inode is no longer the file at the lock path. */
export class DesktopLeaseUnstableError extends Error {
  constructor() {
    super('desktop-operation: lock inode changed')
    this.name = 'DesktopLeaseUnstableError'
  }
}

/** One held flock. Closing the descriptor releases the lock. */
export class DesktopLease {
  private closed = false

  /**
   * @param handle - open lock file. The caller keeps this open for the child lifetime.
   */
  constructor(private readonly handle: FileHandle) {}

  /** Descriptor inherited by the native child on stdio fd 3. */
  get fd(): number {
    return this.handle.fd
  }

  /**
   * Close the descriptor. A second call does nothing. The lock file stays.
   * @returns when the descriptor is closed.
   */
  async release(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.handle.close()
  }
}

/**
 * Open `lockPath`, take a nonblocking exclusive flock, and keep that inode.
 * @param lockPath - absolute lock file. Parent directories are created.
 * @returns the held lease.
 * @throws {DesktopLeaseBusyError} when another descriptor holds the lock.
 * @throws {DesktopLeaseUnstableError} when the inode changes before the check. No retry and no unlink.
 */
export async function acquireDesktopLease(lockPath: string): Promise<DesktopLease> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  const handle = await open(lockPath, 'a+', 0o600)
  try {
    try {
      await tryLockExclusive(handle.fd)
    } catch (error: unknown) {
      if (isLockContention(error)) throw new DesktopLeaseBusyError()
      throw error
    }
    const held = await handle.stat({ bigint: true })
    const current = await stat(lockPath, { bigint: true }).catch((error: unknown) => {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    })
    if (current === undefined || current.ino !== held.ino || current.dev !== held.dev) {
      throw new DesktopLeaseUnstableError()
    }
    return new DesktopLease(handle)
  } catch (error: unknown) {
    await handle.close()
    throw error
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function isLockContention(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'EAGAIN' || code === 'EWOULDBLOCK'
}
