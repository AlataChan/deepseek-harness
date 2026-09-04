/**
 * Unit tests for the model-facing error remediation: the remedy appended to
 * guarded-mutation failures, code preservation, and passthrough behavior.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey } from '@deepseek-ai/dsh-fs'
import { remediateFsError, remediateFsToolError } from '../src/error.ts'

const target = {
  targetKey: FsTargetKey('file-key'),
  displayPath: '/work/file.txt',
}

describe('remediateFsError', () => {
  it('appends the re-read remedy to FS_STALE_VERSION, preserving the code and chaining the cause', () => {
    const original = new FsError('cannot edit "x": file changed since it was read', 'FS_STALE_VERSION')
    const remedied = remediateFsError(original) as FsError
    expect(remedied).toBeInstanceOf(FsError)
    expect(remedied.message).toBe('cannot edit "x": file changed since it was read — re-read the file, then retry')
    expect(remedied.code).toBe('FS_STALE_VERSION')
    expect(remedied.cause).toBe(original)
  })

  it('appends the read remedy to FS_NOT_OBSERVED', () => {
    const remedied = remediateFsError(new FsError('edit requires reading "x" first', 'FS_NOT_OBSERVED')) as FsError
    expect(remedied.message).toBe('edit requires reading "x" first — read the file, then retry')
    expect(remedied.code).toBe('FS_NOT_OBSERVED')
  })

  it('leaves other FsError codes untouched', () => {
    const original = new FsError('no match anywhere', 'FS_EDIT_NOT_FOUND')
    expect(remediateFsError(original)).toBe(original)
  })

  it('leaves non-FsError values untouched', () => {
    const original = new Error('boom')
    expect(remediateFsError(original)).toBe(original)
  })

  it('uses the fs/error-remedy waterfall default when no listener enriches the remedy', async () => {
    const ctx = new Context()
    const original = new FsError('cannot edit "x": file changed since it was read', 'FS_STALE_VERSION')

    const remedied = await remediateFsToolError(ctx, original, target, 'edit', undefined) as FsError

    expect(remedied.message).toBe('cannot edit "x": file changed since it was read — re-read the file, then retry')
    expect(remedied.code).toBe('FS_STALE_VERSION')
    expect(remedied.cause).toBe(original)
  })

  it('lets fs/error-remedy listeners replace the default remedy', async () => {
    const ctx = new Context()
    const original = new FsError('cannot write "x": file changed since it was read', 'FS_STALE_VERSION')
    ctx.on('fs/error-remedy', (request, next) => {
      expect(request.target).toBe(target)
      expect(request.operation).toBe('write')
      void next
      return Promise.resolve('custom attribution')
    })

    const remedied = await remediateFsToolError(ctx, original, target, 'write', { agent: undefined }) as FsError

    expect(remedied.message).toBe('cannot write "x": file changed since it was read — custom attribution')
  })
})
