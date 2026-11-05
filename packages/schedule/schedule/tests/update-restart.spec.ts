/** Real JSON task files preserve edits, original target identity and saved history across reopen. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDailyScheduleRecord, ScheduleId } from '../src/domain.ts'
import { scheduleDomain, type ScheduleTask } from '../src/storage.ts'
import { harness } from './harness.ts'
const roots: string[] = []
const tests: Awaited<ReturnType<typeof harness>>[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T00:00:00Z')) })
afterEach(async () => {
  for (const test of tests.splice(0)) await test.ctx.fiber.dispose()
  vi.useRealTimers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(root: string, task?: ScheduleTask) {
  const test = await harness({ backend: new JsonStorageBackend(root), beforeService: async (_ctx, facility) => {
    if (task === undefined) return
    const domain = await facility.open(scheduleDomain)
    await domain.table('tasks').put(task.record.id, task); await domain.close()
  } }); tests.push(test); return test
}
it.each([true, false])('persists same-ID daily edits with saved history=%s without activating a Session', async (withHistory) => {
  const root = await mkdtemp(join(tmpdir(), 'schedule-edited-')); roots.push(root)
  const sessionId = SessionId('cold-original'), id = ScheduleId('daily-stable-id')
  const record = createDailyScheduleRecord(id, 'Retained exact prompt\nsecond line', { time: '09:00:00.250', time_zone: 'UTC' }, Date.now(), 'Retained exact prompt')
  const receipt = { targetSessionId: sessionId, scheduledAt: '2026-09-15T09:00:00.250Z', deliveredAt: '2026-09-15T09:00:01.333Z', messageId: MessageId('saved') }
  const task: ScheduleTask = { target: { kind: 'session', sessionId }, involvedSessionIds: [sessionId], record, status: 'active', lastDelivery: receipt,
    ...(withHistory ? { deliveryHistory: { earlierRecordsUnavailable: false, records: [{ ...receipt, prompt: record.prompt }] } } : {}),
  }
  const first = await setup(root, task)
  const updated = await first.service.edit({ id, action: 'update', expectedUpdatedAt: null, patch: {
    timing: { kind: 'daily', daily: { time: '10:00:00.125', time_zone: 'Asia/Shanghai' } },
  } })
  const nextRecord = { ...record, time: '10:00:00.125', timeZone: 'Asia/Shanghai', scheduledAt: '2026-09-16T02:00:00.125Z' }
  expect(updated).toEqual({ ...nextRecord, target: task.target, involvedSessionIds: [sessionId], status: 'active',
    updatedAt: '2026-09-16T00:00:00.000Z', lastDelivery: receipt,
  })
  const path = join(root, 'schedule.json'), bytes = await readFile(path, 'utf8')
  expect(JSON.parse(bytes)).toEqual({ unit: { name: 'schedule', version: 2 }, global: null,
    tables: { tasks: { [id]: { ...task, record: nextRecord, updatedAt: '2026-09-16T00:00:00.000Z' } } },
  })
  expect(first.resolve).not.toHaveBeenCalled(); expect(first.flush).not.toHaveBeenCalled()
  await first.ctx.fiber.dispose()
  const second = await setup(root)
  expect(await second.service.view({ id })).toEqual(updated)
  expect(await second.service.history({ id, limit: 100 })).toEqual({ id,
    records: withHistory ? [{ ...receipt, prompt: record.prompt }] : [receipt], earlierRecordsUnavailable: !withHistory,
    earlierRecordsPruned: false, retention: { days: 30, records: 200 },
  })
  expect(await readFile(path, 'utf8')).toBe(bytes)
  expect(second.resolve).not.toHaveBeenCalled()
})
it('retains exact IANA alias spelling and pinned milliseconds while an equivalent edit advances revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'schedule-alias-')); roots.push(root)
  const id = ScheduleId('alias'), sessionId = SessionId('alias-session')
  const task: ScheduleTask = { target: { kind: 'session', sessionId }, involvedSessionIds: [sessionId], status: 'active',
    record: { id, kind: 'daily', title: 'Pinned target', prompt: 'Pinned target', time: '09:00:00.100', timeZone: 'US/Eastern', scheduledAt: '2026-09-16T14:00:00.321Z' },
  }
  const first = await setup(root, task)
  const result = await first.service.edit({ id, action: 'update', expectedUpdatedAt: null,
    patch: { timing: { kind: 'daily', daily: { time: '09:00:00.1', time_zone: 'America/New_York' } } },
  })
  expect(result).toEqual({ ...task.record, target: task.target, involvedSessionIds: [sessionId], status: 'active', updatedAt: '2026-09-16T00:00:00.000Z' })
  const bytes = await readFile(join(root, 'schedule.json'), 'utf8')
  await first.ctx.fiber.dispose()
  const second = await setup(root)
  expect(await second.service.view({ id })).toEqual(result)
  expect(await readFile(join(root, 'schedule.json'), 'utf8')).toBe(bytes)
})
