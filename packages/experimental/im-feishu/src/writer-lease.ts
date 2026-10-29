/**
 * POSIX single-writer ownership for an IM state directory. A persistent lock inode
 * is never removed; process death releases its descriptor's kernel lock.
 * @module @deepseek-ai/dsh-experimental-im-feishu/writer-lease
 */
import { constants } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'

/** Directory-scoped kernel lock held before opening any IM storage domain. */
export class ImWriterLease {
  private releasePromise: Promise<void> | undefined
  private constructor(private readonly handle: FileHandle) {}

  /**
   * Acquire exclusive ownership of an existing private state directory.
   * @param directory - Absolute, canonical, owner-only directory created by deployment.
   * @returns Held kernel lease; contention, unsafe permissions and unsupported OS fail closed.
   */
  static async acquire(directory: string): Promise<ImWriterLease> {
    if (process.platform !== 'linux' && process.platform !== 'darwin') throw new Error('IM writer leases require POSIX')
    if (!isAbsolute(directory)) throw new Error('State directory must be absolute')
    const uid = process.getuid?.()
    const parent = await lstat(directory)
    if (uid === undefined || !parent.isDirectory() || parent.uid !== uid || (parent.mode & 0o077) !== 0
      || await realpath(directory) !== resolve(directory)) throw new Error('State directory must be canonical and private to its OS owner')
    const path = join(directory, 'writer.lock')
    const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
    try {
      const info = await handle.stat({ bigint: true })
      if (!info.isFile() || info.uid !== BigInt(uid) || (info.mode & 0o077n) !== 0n || info.nlink !== 1n) {
        throw new Error('Writer lock must be an owner-only regular file without hard links')
      }
      await tryLockExclusive(handle.fd)
      const current = await lstat(path, { bigint: true })
      if (current.ino !== info.ino || current.dev !== info.dev || current.isSymbolicLink()) throw new Error('Writer lock inode changed')
      return new ImWriterLease(handle)
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  /**
   * Release the held kernel lock without unlinking its persistent inode.
   * @returns Completion after the descriptor closes.
   */
  release(): Promise<void> {
    this.releasePromise ??= this.handle.close()
    return this.releasePromise
  }
}
