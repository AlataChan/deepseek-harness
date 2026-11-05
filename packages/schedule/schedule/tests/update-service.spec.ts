/** Edits share the timer FIFO, retain history, detect revisions and honor pre-write cancellation. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ScheduleCatalogEntry, SchedulePatch, ScheduleTiming } from '../src/types.ts'
import { scheduleTaskSchema } from '../src/storage.ts'
import { ScheduleId } from '../src/domain.ts'
import { harness, agentFor } from './harness.ts'
const contexts: Context[] = []
const releases: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T00:00:00.125Z')) })
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks(); vi.useRealTimers()
})
async function setup() { return harness({ onContext: ctx => contexts.push(ctx) }) }
function table(test: Awaited<ReturnType<typeof setup>>) {
  const domain = test.ctx.storageDomain.get('schedule')
  if (domain === undefined) throw new Error('Schedule domain unavailable')
  return domain.table('tasks')
}
async function create(test: Awaited<ReturnType<typeof setup>>, timing: ScheduleTiming = { kind: 'every', every_seconds: 300 }) {
  return test.service.create({ title: 'Keep', prompt: 'Exact prompt\n"quoted"', timing,
    target: { kind: 'session', sessionId: SessionId('owner') },
  })
}
function request(task: ScheduleCatalogEntry, patch: SchedulePatch = { timing: { kind: 'every', every_seconds: 600 } }) {
  return { id: task.id, action: 'update' as const, expectedUpdatedAt: task.updatedAt ?? null, patch }
}
function gatePut(test: Awaited<ReturnType<typeof setup>>) {
  const tasks = table(test)
  const put = tasks.put.bind(tasks)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  releases.push(() =>{  release.resolve(undefined) })
  const spy = vi.spyOn(tasks, 'put').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined); await release.promise; await put(...args)
  })
  return { entered: entered.promise, release: () =>{  release.resolve(undefined) }, spy }
}
it('updates all fields in one row write while preserving exact receipts and Session inactivity', async () => {
  const test = await setup()
  const task = await create(test)
  const before = table(test).get(task.id)
  const put = vi.spyOn(table(test), 'put'), changed = vi.fn()
  test.ctx.on('schedule/changed', changed)
  const updated = await test.service.edit(request(task, { title: 'Renamed', prompt: 'New instruction',
    timing: { kind: 'daily', daily: { time: '10:30:00.321', time_zone: 'Asia/Shanghai' } },
  }))
  expect(updated).toMatchObject({ id: task.id, kind: 'daily', title: 'Renamed', prompt: 'New instruction',
    scheduledAt: '2026-09-16T02:30:00.321Z', target: task.target,
  })
  expect(put).toHaveBeenCalledTimes(1)
  expect(scheduleTaskSchema.parse(table(test).get(task.id)).deliveryHistory)
    .toEqual(scheduleTaskSchema.parse(before).deliveryHistory)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(test.resolve).not.toHaveBeenCalled(); expect(test.flush).not.toHaveBeenCalled()
  await test.ctx.fiber.dispose()
  const reopened = await harness({ pool: test.pool, onContext: ctx => contexts.push(ctx) })
  expect(await reopened.service.view({ id: task.id })).toEqual(updated)
})
it.each(['title', 'prompt'] as const)('changes only %s without moving the committed occurrence', async (field) => {
  const test = await setup(), task = await create(test)
  const result = await test.service.edit(request(task, { [field]: 'Replacement' }))
  expect(result).toEqual({ ...task, [field]: 'Replacement', updatedAt: '2026-09-16T00:00:00.126Z' })
})
it('retains the exact stored alias and pinned occurrence for an equivalent timing edit', async () => {
  const test = await setup()
  const task = await create(test, { kind: 'daily', daily: { time: '09:00:00.100', time_zone: 'US/Eastern' } })
  const result = await test.service.edit(request(task, { timing: { kind: 'daily', daily: { time: '09:00:00.1', time_zone: 'America/New_York' } } }))
  expect(result).toEqual({ ...task, updatedAt: '2026-09-16T00:00:00.126Z' })
})
it('serializes competing edits and rejects stale revisions before invalid replacement content', async () => {
  const test = await setup(), task = await create(test), gate = gatePut(test)
  const first = test.service.edit(request(task)); await gate.entered
  const stale = test.service.edit(request(task, { prompt: '   ' }))
  gate.release()
  expect(await first).toMatchObject({ everySeconds: 600 })
  expect(await stale).toEqual({ id: task.id, code: 'schedule_conflict' })
  expect(await test.service.edit(request(task))).toEqual({ id: task.id, code: 'schedule_conflict' })
  expect(gate.spy).toHaveBeenCalledTimes(1)
})
it.each([
  { title: '   ' }, { title: 'x'.repeat(121) }, { prompt: ' \n ' },
])('rejects invalid content %j without writing or notifying', async (patch) => {
  const test = await setup(), task = await create(test)
  const put = vi.spyOn(table(test), 'put'), changed = vi.fn(); test.ctx.on('schedule/changed', changed)
  await expect(test.service.edit(request(task, patch))).rejects.toMatchObject({ code: 'invalid_prompt' })
  expect(put).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled()
  expect(await test.service.view({ id: task.id })).toEqual(task)
})
it('rejects empty patches, malformed timing and too-frequent intervals before writes', async () => {
  const test = await setup(), task = await create(test), put = vi.spyOn(table(test), 'put')
  await expect(test.service.edit(request(task, {}))).rejects.toMatchObject({ code: 'invalid_rule' })
  await expect(test.service.edit(request(task, { timing: { kind: 'every', every_seconds: 59 } })))
    .rejects.toMatchObject({ code: 'frequency_too_high' })
  await expect(test.service.edit(request(task, { timing: { kind: 'at', at: 'invalid' } })))
    .rejects.toMatchObject({ code: 'invalid_rule' })
  expect(put).not.toHaveBeenCalled()
})
it('reads queue-time clock after an earlier creation write instead of edit request time', async () => {
  const test = await setup(), task = await create(test), gate = gatePut(test)
  const creating = create(test, { kind: 'after', after_seconds: 3600 }); await gate.entered
  const editing = test.service.edit(request(task))
  vi.setSystemTime(new Date('2026-09-16T00:00:45.321Z')); gate.release(); await creating
  expect(await editing).toMatchObject({ scheduledAt: '2026-09-16T00:10:45.321Z' })
})
it('rejects an absolute edit that becomes past while its FIFO slot waits', async () => {
  const test = await setup(), task = await create(test), gate = gatePut(test)
  const creating = create(test, { kind: 'after', after_seconds: 3600 }); await gate.entered
  const editing = test.service.edit(request(task, { timing: { kind: 'at', at: '2026-09-16T00:01:00Z' } }))
  const outcome = expect(editing).rejects.toMatchObject({ code: 'not_future' })
  vi.setSystemTime(new Date('2026-09-16T00:02:00Z')); gate.release(); await creating; await outcome
  expect(await test.service.view({ id: task.id })).toEqual(task)
})
it('observes deletion ordered before edit without touching another task', async () => {
  const test = await setup(), task = await create(test)
  const other = await create(test)
  const deletion = test.service.edit({ id: task.id, action: 'delete' })
  const edit = test.service.edit(request(task))
  expect(await deletion).toEqual({ id: task.id, deleted: true })
  expect(await edit).toEqual({ id: task.id, code: 'schedule_not_found' })
  expect(await test.service.view({ id: other.id })).toEqual(other)
})
it.each(['every', 'after', 'daily'] as const)('waits for %s delivery and detects its new revision', async (kind) => {
  const test = await setup(), agent = agentFor(test.ctx, 'owner'); test.resolve.mockResolvedValue({ agent })
  const timing: ScheduleTiming = kind === 'every' ? { kind, every_seconds: 300 } : kind === 'after'
    ? { kind, after_seconds: 300 } : { kind, daily: { time: '00:05:00.125', time_zone: 'UTC' } }
  const task = await create(test, timing)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  releases.push(() =>{  release.resolve(undefined) })
  test.flush.mockImplementationOnce(async () => { entered.resolve(undefined); await release.promise })
  const timer = vi.advanceTimersByTimeAsync(300_000); await entered.promise
  const edit = test.service.edit(request(task))
  release.resolve(undefined); await timer
  expect(await edit).toEqual({ id: task.id, code: 'schedule_conflict' })
  expect(await test.service.history({ id: task.id, limit: 20 }))
    .toMatchObject({ records: [expect.objectContaining({ targetSessionId: agent.id })] })
})
it.each(['aborted', 'queued'] as const)('honors %s cancellation before the durable edit write', async (phase) => {
  const test = await setup(), task = await create(test), abort = new AbortController()
  let gate: ReturnType<typeof gatePut> | undefined, creating: Promise<unknown> | undefined
  if (phase === 'queued') { gate = gatePut(test); creating = create(test); await gate.entered }
  const reason = new Error('cancelled'); if (phase === 'aborted') abort.abort(reason)
  const edit = test.service.edit(request(task), undefined, abort.signal)
  const refusal = expect(edit).rejects.toBe(reason)
  abort.abort(reason); gate?.release(); await creating; await refusal
  expect(await test.service.view({ id: task.id })).toEqual(task)
})
it('does not roll back an accepted write when cancellation follows persistence admission', async () => {
  const test = await setup(), task = await create(test), gate = gatePut(test), abort = new AbortController()
  const edit = test.service.edit(request(task), undefined, abort.signal); await gate.entered
  abort.abort(); gate.release()
  expect(await edit).toMatchObject({ everySeconds: 600 })
})
it('propagates storage errors, preserves FIFO progress and refuses work after teardown', async () => {
  const test = await setup(), task = await create(test), put = vi.spyOn(table(test), 'put')
  put.mockRejectedValueOnce(new Error('write failure'))
  await expect(test.service.edit(request(task))).rejects.toThrow('write failure')
  expect(await test.service.view({ id: task.id })).toEqual(task)
  expect(await test.service.edit(request(task))).toMatchObject({ everySeconds: 600 })
  await test.ctx.fiber.dispose()
  await expect(test.service.edit(request(task))).rejects.toThrow('Schedule service is stopping')
})
it('contains a synchronous observer failure after a successful commit', async () => {
  const test = await setup(), task = await create(test)
  test.ctx.on('schedule/changed', () => { throw new Error('observer failed') })
  expect(await test.service.edit(request(task))).toMatchObject({ everySeconds: 600 })
  expect(test.resolve).not.toHaveBeenCalled()
})
it('permits human cleanup of a missing or ended task and retains history until deletion', async () => {
  const test = await setup(), task = await create(test)
  expect(await test.service.edit({ id: ScheduleId('missing'), action: 'delete' })).toEqual({ id: 'missing', code: 'schedule_not_found' })
  const row = table(test).get(task.id)
  if (row === undefined) throw new Error('Missing task')
  await table(test).put(task.id, { ...row, status: 'ended' })
  expect(await test.service.edit({ id: task.id, action: 'update', patch: { title: 'Retained' } })).toMatchObject({ status: 'ended', title: 'Retained' })
  expect(await test.service.edit({ id: task.id, action: 'delete' })).toEqual({ id: task.id, deleted: true })
})
