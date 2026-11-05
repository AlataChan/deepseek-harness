/** Released v1 task rows evolve in memory and persist as v2 only on mutation. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { harness } from './harness.ts'
import { scheduleTaskSchema } from '../src/storage.ts'
import { ScheduleId } from '../src/domain.ts'
const tests: Awaited<ReturnType<typeof harness>>[] = []
const roots: string[] = []
afterEach(async () => {
  for (const test of tests.splice(0)) await test.ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
it('reads v1 inactive task and legacy receipts byte-for-byte, then writes v2 without sessionId on edit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'schedule-v1-')); roots.push(root)
  const file = join(root, 'schedule.json')
  const receipt = { scheduledAt: '2026-01-01T00:00:00.000Z', deliveredAt: '2026-01-01T00:00:00.100Z', messageId: 'legacy-delivery' }
  const record = { id: 'legacy', kind: 'after', title: 'Retained', prompt: 'Retained', afterSeconds: 1, scheduledAt: receipt.scheduledAt }
  const bytes = JSON.stringify({ unit: { name: 'schedule', version: 1 }, global: null,
    tables: { tasks: { legacy: { sessionId: 'original', record, status: 'inactive', lastDelivery: receipt } } },
  })
  await writeFile(file, bytes)
  const test = await harness({ backend: new JsonStorageBackend(root) }); tests.push(test)
  const row = await test.service.view({ id: ScheduleId('legacy') })
  expect(row).toEqual({ ...record, target: { kind: 'session', sessionId: 'original' }, involvedSessionIds: ['original'],
    status: 'ended', lastDelivery: { ...receipt, targetSessionId: 'original' },
  })
  expect(await test.service.history({ id: ScheduleId('legacy'), limit: 10 })).toMatchObject({
    records: [{ ...receipt, targetSessionId: 'original' }], earlierRecordsUnavailable: true,
  })
  expect(await readFile(file, 'utf8')).toBe(bytes)
  await test.service.edit({ id: ScheduleId('legacy'), action: 'update', expectedUpdatedAt: null, patch: { title: 'Edited' } })
  const written: unknown = JSON.parse(await readFile(file, 'utf8'))
  expect(written).toHaveProperty('unit.version', 2)
  expect(written).not.toHaveProperty('tables.tasks.legacy.sessionId')
  expect(written).toHaveProperty('tables.tasks.legacy.record.title', 'Edited')
  expect(written).toHaveProperty('tables.tasks.legacy.status', 'ended')
  expect(written).toHaveProperty('tables.tasks.legacy.target', { kind: 'session', sessionId: 'original' })
})

it('keeps a compatible memory fixture stamp until a successful mutation', async () => {
  const { MemoryMediaPool, MemoryStorageBackend } = await import('../../../storage/storage-domain/tests/helpers/memory-backend.ts')
  const pool = new MemoryMediaPool()
  pool.versions.set('compatible', 1)
  const backend = new MemoryStorageBackend(pool)
  const unit = await backend.kv.open({ name: 'compatible', version: 2, compatibleVersions: [1], tables: ['rows'], hasGlobal: false })
  expect(pool.versions.get('compatible')).toBe(1)
  pool.failNextWrites = 1
  await expect(unit.putRecord('rows', 'item', { value: 1 })).rejects.toThrow('injected write failure')
  expect(pool.versions.get('compatible')).toBe(1)
  await unit.putRecord('rows', 'item', { value: 2 })
  expect(pool.versions.get('compatible')).toBe(2)
  await unit.close()
  await backend.close()
})

it('rejects unbound rows and fresh-Session receipts without a destination, while accepting explicit history', () => {
  const record = { id: 'stored', kind: 'after', title: 'Stored', prompt: 'Stored', afterSeconds: 60,
    scheduledAt: '2099-01-01T00:00:00.000Z',
  }
  const receipt = { scheduledAt: record.scheduledAt, deliveredAt: record.scheduledAt, messageId: 'receipt' }
  expect(scheduleTaskSchema.safeParse({ record }).success).toBe(false)
  expect(scheduleTaskSchema.safeParse({ record, target: { kind: 'new', create: {} }, lastDelivery: receipt }).success).toBe(false)
  expect(scheduleTaskSchema.safeParse({ record, target: { kind: 'new', create: {} },
    lastDelivery: { ...receipt, targetSessionId: 'delivered' },
    deliveryHistory: { records: [receipt], earlierRecordsUnavailable: false },
  }).success).toBe(false)
  const current = scheduleTaskSchema.parse({ record, target: { kind: 'new', create: {} },
    lastDelivery: { ...receipt, targetSessionId: 'delivered' },
    deliveryHistory: { records: [{ ...receipt, targetSessionId: 'delivered' }], earlierRecordsUnavailable: false },
  })
  expect(current.involvedSessionIds).toEqual([])
  expect(current.deliveryHistory?.records[0]?.targetSessionId).toBe('delivered')
})
