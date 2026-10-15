/**
 * Kernel-flock based exclusive write lease for the assistant catalog.
 * Follows the pattern in session-persistence-jsonl/src/lease.ts.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/lease
 */

import { mkdir, open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { CatalogAlreadyOwnedError } from './errors.ts'

/** Held lock representation. */
type HeldLock =
  | { readonly kind: 'posix'; readonly handle: FileHandle }
  | { readonly kind: 'stub'; readonly close: () => Promise<void> }

/**
 * Determines whether an error represents lock contention (already held by another descriptor).
 * @param error - caught error.
 * @returns true if error indicates lock contention.
 */
function isLockContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'EAGAIN' || code === 'EWOULDBLOCK' || code === 'EBUSY'
}

/**
 * Exclusive write lease over the catalog storage.
 * Only one writer may hold the lease on a given lockPath at any time.
 */
export class CatalogWriteLease {
  private released = false

  private constructor(
    public readonly lockPath: string,
    private readonly held: HeldLock,
  ) {}

  /**
   * Acquires the exclusive kernel write lease at the given lock file path.
   * Creates parent directories if needed. Retries up to 3 times on inode mismatch.
   * @param lockPath - absolute path to the lock file.
   * @returns the acquired write lease.
   * @throws {CatalogAlreadyOwnedError} if another writer currently holds the lock.
   */
  static async acquire(lockPath: string): Promise<CatalogWriteLease> {
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })

    /* v8 ignore start -- platform-specific branch for native Windows coverage */
    if (process.platform === 'win32') {
      try {
        const handle = await open(lockPath, 'wx')
        return new CatalogWriteLease(lockPath, {
          kind: 'posix',
          handle,
        })
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
          throw new CatalogAlreadyOwnedError(lockPath)
        }
        throw err
      }
    }
    /* v8 ignore stop */

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const handle = await open(lockPath, 'w')
      try {
        try {
          await tryLockExclusive(handle.fd)
        } catch (error: unknown) {
          if (isLockContention(error)) {
            throw new CatalogAlreadyOwnedError(lockPath)
          }
          throw error
        }
        const heldStat = await handle.stat({ bigint: true })
        const currentStat = await stat(lockPath, { bigint: true }).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
          throw error
        })
        if (currentStat !== undefined && currentStat.ino === heldStat.ino && currentStat.dev === heldStat.dev) {
          return new CatalogWriteLease(lockPath, { kind: 'posix', handle })
        }
      } catch (error: unknown) {
        await handle.close()
        throw error
      }
      await handle.close()
    }

    throw new CatalogAlreadyOwnedError(lockPath)
  }

  /**
   * Whether the lease is currently actively held.
   * @returns true if the lease has not been released.
   */
  get isHeld(): boolean {
    return !this.released
  }

  /**
   * Release the lease. Idempotent.
   * @returns promise resolving when descriptor is closed.
   */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    if (this.held.kind === 'posix') {
      await this.held.handle.close()
    } else {
      await this.held.close()
    }
  }
}
