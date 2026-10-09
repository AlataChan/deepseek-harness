/** Backup-or-stop guard: no migration of a released generation runs without a verified backup. */

import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence, { JsonlMigrationBackupError } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meta, releasedV1OneTurnLog } from '../../session-persistence/tests/contract.ts'
import { generationLogPath } from '../src/format.ts'

/** Injected copyFile failure state: rejection mode plus the thrown value. */
interface CopyFileFailure {
  /** 'throw': copyFile rejects; 'partial': copyFile writes only half the source bytes. */
  mode: 'throw' | 'partial' | undefined
  /** Value handed to rejections; deliberately unconstrained. */
  error: unknown
}

const copyFileFailure: CopyFileFailure = vi.hoisted(() => ({
  mode: undefined,
  error: undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    copyFile: (async (...args: Parameters<typeof actual.copyFile>) => {
      if (copyFileFailure.mode === 'throw' && copyFileFailure.error !== undefined) {
        throw copyFileFailure.error
      }
      if (copyFileFailure.mode === 'partial') {
        const [source, destination] = args
        const bytes = await actual.readFile(source)
        await actual.writeFile(destination, bytes.subarray(0, Math.floor(bytes.length / 2)))
        return
      }
      return actual.copyFile(...args)
    }),
  }
})

const id = SessionId('migration-backup')
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  copyFileFailure.mode = undefined
  copyFileFailure.error = undefined
  try {
    await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  } finally {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  }
})

async function mount(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx
}

/** Seed one valid v0 generation that the full chain migrates successfully. */
async function seedV0(root: string): Promise<{ sourcePath: string; backupPath: string; source: Buffer }> {
  const sourcePath = generationLogPath(root, '/work', id, 0, 'none')
  const header = meta('migration-backup', '/work')
  const releasedHeader = {
    type: 'session',
    version: 0,
    id: header.id,
    createdAt: header.createdAt,
    cwd: header.cwd,
    delegationDepth: 0,
  }
  // Reorder the released one-turn log so the first surface follows the first
  // step, the chronology the whole chain migrates (see jsonl.spec.ts).
  const [turn, user, step, ...tail] = releasedV1OneTurnLog()
  const rows = [turn!, { ...step!, time: 2 }, { ...user!, time: 3 }, ...tail]
    .map((event, seq) => ({ ...event, seq }))
  const source = Buffer.from([
    JSON.stringify(releasedHeader),
    ...rows.map(event => JSON.stringify(event)),
    '',
  ].join('\n'))
  await mkdir(dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, source)
  return { sourcePath, backupPath: `${sourcePath}.pre-migration.bak`, source }
}

describe('JsonlSessionPersistence pre-migration backup guard', () => {
  it('creates a verified non-empty backup before migrating and reuses it across backend instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-migration-backup-'))
    roots.push(root)
    const { sourcePath, backupPath, source } = await seedV0(root)

    const ctx = await mount(root)
    const reader = await ctx.sessionPersistence.open(id, 'read')
    const restored = await reader.read()
    expect(restored.events.length).toBeGreaterThan(0)
    await reader.close()
    expect(await readFile(backupPath)).toEqual(source)
    expect(await readFile(sourcePath)).toEqual(source)

    const backupIdentity = await stat(backupPath, { bigint: true })
    await ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)

    // A fresh backend instance satisfies the guard from the existing backup
    // without rewriting it, then publishes the successor on a write open.
    const reopened = await mount(root)
    const writer = await reopened.sessionPersistence.open(id, 'write')
    await writer.close()
    await reopened.sessionPersistence.flush()
    expect(await readFile(backupPath)).toEqual(source)
    expect(await readFile(sourcePath)).toEqual(source)
    const after = await stat(backupPath, { bigint: true })
    expect(after.mtimeNs).toBe(backupIdentity.mtimeNs)
    const successor = generationLogPath(root, '/work', id, SESSION_FORMAT_VERSION, 'none')
    expect((await readFile(successor)).length).toBeGreaterThan(0)
  })

  it('replaces an invalid earlier backup before migrating', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-migration-backup-'))
    roots.push(root)
    const { sourcePath, backupPath, source } = await seedV0(root)
    await writeFile(backupPath, 'truncated earlier backup')

    const ctx = await mount(root)
    const reader = await ctx.sessionPersistence.open(id, 'read')
    await reader.close()
    expect(await readFile(backupPath)).toEqual(source)
    expect(await readFile(sourcePath)).toEqual(source)
  })

  it('stops the open loudly without migrating when the backup cannot be written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-migration-backup-'))
    roots.push(root)
    const { sourcePath, backupPath, source } = await seedV0(root)
    copyFileFailure.mode = 'throw'
    copyFileFailure.error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })

    const ctx = await mount(root)
    await expect(ctx.sessionPersistence.open(id, 'read')).rejects.toMatchObject({
      name: 'JsonlMigrationBackupError',
      sourcePath,
      backupPath,
    })
    await expect(ctx.sessionPersistence.open(id, 'write')).rejects.toBeInstanceOf(JsonlMigrationBackupError)
    await ctx.sessionPersistence.flush()
    expect(await readFile(sourcePath)).toEqual(source)
    await expect(readFile(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const successor = generationLogPath(root, '/work', id, SESSION_FORMAT_VERSION, 'none')
    await expect(readFile(successor)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('carries a non-Error backup failure into the refusal message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-migration-backup-'))
    roots.push(root)
    await seedV0(root)
    copyFileFailure.mode = 'throw'
    copyFileFailure.error = 'disk exploded'

    const ctx = await mount(root)
    await expect(ctx.sessionPersistence.open(id, 'read')).rejects.toThrow(/disk exploded/)
    await ctx.sessionPersistence.flush()
  })

  it('stops the open loudly when a partial backup is detected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-migration-backup-'))
    roots.push(root)
    const { sourcePath, source } = await seedV0(root)
    copyFileFailure.mode = 'partial'

    const ctx = await mount(root)
    await expect(ctx.sessionPersistence.open(id, 'read')).rejects.toMatchObject({
      name: 'JsonlMigrationBackupError',
      message: expect.stringContaining('bytes of the'),
    })
    expect(await readFile(sourcePath)).toEqual(source)
  })

  it('refuses to migrate an empty source generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-migration-backup-'))
    roots.push(root)
    const sourcePath = generationLogPath(root, '/work', id, 0, 'none')
    await mkdir(dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '')

    const ctx = await mount(root)
    await expect(ctx.sessionPersistence.open(id, 'read')).rejects.toMatchObject({
      name: 'JsonlMigrationBackupError',
      message: expect.stringContaining('backup holds 0 bytes'),
    })
  })
})
