/** Replacement uncertainty must preserve destination bytes until explicit validated reload. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'

const failure = vi.hoisted(() => ({ afterReplacement: false }))
vi.mock('../src/stage-c-storage.ts', async (importOriginal) => {
  const storage = await importOriginal<typeof import('../src/stage-c-storage.ts')>()
  return {
    ...storage,
    atomicStageCWrite: async (path: string, value: unknown) => {
      await storage.atomicStageCWrite(path, value)
      if (failure.afterReplacement) throw new storage.StageCStorageCommitError(new Error('Directory sync failure'))
    },
  }
})
import { DurableReadCursorManager, UsageAggregator } from '../src/cursors-usage.ts'

afterEach(() => { failure.afterReplacement = false })

describe('Stage C replacement uncertainty', () => {
  it('protects a newly replaced cursor file from stale in-memory flush until reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stagec-uncertain-cursor-'))
    try {
      const path = join(root, 'cursor.json')
      const cursors = new DurableReadCursorManager({ storagePath: path })
      await cursors.setReadCursor('conversation', 1)
      failure.afterReplacement = true
      await expect(cursors.setReadCursor('conversation', 4)).rejects.toThrow(/uncertain/)
      const replaced = await readFile(path, 'utf8')
      expect(JSON.parse(replaced)[0].lastReadSeq).toBe(4)
      expect(cursors.getReadCursor('conversation')?.lastReadSeq).toBe(1)
      failure.afterReplacement = false
      await expect(cursors.flush()).rejects.toThrow(/corrupt/)
      expect(await readFile(path, 'utf8')).toBe(replaced)
      await cursors.load()
      expect(cursors.getReadCursor('conversation')?.lastReadSeq).toBe(4)
      await cursors.setReadCursor('conversation', 5)
      expect(cursors.getReadCursor('conversation')?.lastReadSeq).toBe(5)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('protects newly replaced billing and reloads it exactly once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stagec-uncertain-usage-'))
    try {
      const path = join(root, 'usage.json')
      const usage = new UsageAggregator(new Context())
      usage.setStoragePath(path)
      const charge = { id: 'charge', sessionId: SessionId('session'), seq: 0, provider: 'mock', model: 'mock',
        purpose: 'prediction' as const, timestamp: 1, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
      failure.afterReplacement = true
      await expect(usage.recordAuxiliaryUsage(charge)).rejects.toThrow(/uncertain/)
      const replaced = await readFile(path, 'utf8')
      expect(usage.getAuxiliaryRecords(charge.sessionId)).toEqual([])
      failure.afterReplacement = false
      await expect(usage.flush()).rejects.toThrow(/corrupt/)
      expect(await readFile(path, 'utf8')).toBe(replaced)
      await usage.load()
      await usage.recordAuxiliaryUsage(charge)
      expect(usage.getAuxiliaryRecords(charge.sessionId)).toEqual([charge])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
