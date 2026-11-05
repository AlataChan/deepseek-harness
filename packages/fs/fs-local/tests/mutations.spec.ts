/**
 * Guarded delete and move on the local provider: freshness, conflicts,
 * symlink and directory targets, cancellation, and a retained source.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'

let dir: string
let ctx: Context
let fs: LocalFileSystem
let fiber: Awaited<ReturnType<Context['plugin']>>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-fs-mutate-'))
  ctx = new Context()
  fiber = await ctx.plugin(LocalFileSystem, { cwd: dir })
  fs = ctx.fs as LocalFileSystem
})

afterEach(async () => {
  await fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('deleteFile', () => {
  it('removes a regular file and returns its bounded basis', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const target = await fs.resolve('notes.txt')
    const version = (await fs.stat(target))?.version
    const outcome = await fs.deleteFile(target, { version: version! })
    expect(outcome.before).toBe('hello\n')
    await expect(readFile(join(dir, 'notes.txt'), 'utf8')).rejects.toThrow()
  })

  it('rejects a missing or stale file and leaves an existing file in place', async () => {
    const missing = await fs.resolve('absent.txt')
    await expect(fs.deleteFile(missing)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const target = await fs.resolve('notes.txt')
    await expect(fs.deleteFile(target, { version: FsVersion('stale') })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('rejects a directory and a symlink to a directory', async () => {
    await mkdir(join(dir, 'folder'))
    await symlink('folder', join(dir, 'folder-link'))
    await expect(fs.deleteFile(await fs.resolve('folder'))).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    await expect(fs.deleteFile(await fs.resolve('folder-link'))).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    await expect(readFile(join(dir, 'folder'), 'utf8')).rejects.toThrow()
  })

  it('follows a file symlink and removes the real file', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await symlink('real.txt', join(dir, 'link.txt'))
    const target = await fs.resolve('link.txt')
    expect(target.targetKey).toContain('real.txt')
    await fs.deleteFile(target)
    await expect(readFile(join(dir, 'real.txt'), 'utf8')).rejects.toThrow()
  })

  it('aborts before removal and leaves the file', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const target = await fs.resolve('notes.txt')
    const controller = new AbortController()
    controller.abort()
    await expect(fs.deleteFile(target, undefined, controller.signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('aborts after the diff basis is read and leaves the file', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const target = await fs.resolve('notes.txt')
    const controller = new AbortController()
    fs.internals.inspectAfterDiffBasis = () => { controller.abort() }
    await expect(fs.deleteFile(target, undefined, controller.signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('maps a permission failure and any other removal failure', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const target = await fs.resolve('notes.txt')
    fs.internals.removeFile = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
    await expect(fs.deleteFile(target)).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    fs.internals.removeFile = async () => { throw new Error('disk') }
    await expect(fs.deleteFile(target)).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello\n')
  })
})

describe('moveFile', () => {
  it('publishes the source at a new path and removes the source', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    const outcome = await fs.moveFile(source, destination, {})
    expect(outcome.sourceDeleted).toBe(true)
    expect(outcome.destination.after).toBe('hello\n')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('hello\n')
    await expect(readFile(join(dir, 'real.txt'), 'utf8')).rejects.toThrow()
  })

  it('writes caller content and refuses an existing unread destination', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await writeFile(join(dir, 'other.txt'), 'kept\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    await expect(fs.moveFile(source, destination, {
      content: 'hi\n',
      expectedDestination: { kind: 'createIfAbsent' },
    })).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('kept\n')
  })

  it('rejects a move onto the same file before either effect', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    const source = await fs.resolve('real.txt')
    await expect(fs.moveFile(source, source, { content: 'hi\n' })).rejects.toMatchObject({ code: 'FS_SAME_TARGET' })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
  })

  it('reports a published destination when source removal fails', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    fs.internals.removeFile = async () => {
      throw new FsError('cannot delete "real.txt": disk', 'FS_IO_ERROR')
    }
    const outcome = await fs.moveFile(source, destination, { content: 'hi\n' })
    expect(outcome.sourceDeleted).toBe(false)
    if (outcome.sourceDeleted) throw new Error('expected the source to remain')
    expect(outcome.sourceFailure.code).toBe('FS_IO_ERROR')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('hi\n')
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
  })

  it('aborts before publication and leaves the source', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    const controller = new AbortController()
    controller.abort()
    await expect(fs.moveFile(source, destination, {}, controller.signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    await expect(readFile(join(dir, 'other.txt'), 'utf8')).rejects.toThrow()
  })

  it('reads an existing destination basis and aborts before publication', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await writeFile(join(dir, 'other.txt'), 'kept\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    const version = (await fs.stat(destination))?.version
    if (version === undefined) throw new Error('destination has no version')
    const controller = new AbortController()
    fs.internals.inspectAfterDiffBasis = () => { controller.abort() }
    await expect(fs.moveFile(source, destination, {
      expectedDestination: { kind: 'replaceIfVersion', version },
    }, controller.signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('kept\n')
  })

  it('aborts during publication and leaves both paths unchanged', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    const controller = new AbortController()
    fs.internals.inspectTemp = () => { controller.abort() }
    await expect(fs.moveFile(source, destination, {}, controller.signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    await expect(readFile(join(dir, 'other.txt'), 'utf8')).rejects.toThrow()
  })

  it('rejects a directory destination and a stale or missing replacement guard', async () => {
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await mkdir(join(dir, 'folder'))
    const source = await fs.resolve('real.txt')
    await expect(fs.moveFile(source, await fs.resolve('folder'), {})).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    await writeFile(join(dir, 'other.txt'), 'kept\n')
    const destination = await fs.resolve('other.txt')
    await expect(fs.moveFile(source, destination, {
      expectedDestination: { kind: 'replaceIfVersion', version: FsVersion('stale') },
    })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    const missing = await fs.resolve('absent.txt')
    await expect(fs.moveFile(source, missing, {
      expectedDestination: { kind: 'replaceIfVersion', version: FsVersion('stale') },
    })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('hello\n')
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('kept\n')
  })

  it('omits an oversized basis and still publishes the move', async () => {
    await fiber.dispose()
    ctx = new Context()
    fiber = await ctx.plugin(LocalFileSystem, { cwd: dir, diffBasisMaxBytes: 4 })
    fs = ctx.fs as LocalFileSystem
    await writeFile(join(dir, 'real.txt'), 'hello\n')
    await writeFile(join(dir, 'other.txt'), 'kept\n')
    const source = await fs.resolve('real.txt')
    const destination = await fs.resolve('other.txt')
    const version = (await fs.stat(destination))?.version
    const outcome = await fs.moveFile(source, destination, {
      content: 'longer\n',
      expectedDestination: { kind: 'replaceIfVersion', version: version! },
    })
    expect(outcome.sourceDeleted).toBe(true)
    expect(outcome.destination.before).toBeNull()
    expect(outcome.sourceBefore).toBeNull()
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('longer\n')
  })
})
