/** Human and Agent management share one durable task catalog. */
import { afterEach, expect, it, vi } from 'vitest'
import { harness } from './harness.ts'

const contexts: Awaited<ReturnType<typeof harness>>[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(test => test.ctx.fiber.dispose())) })
it('defaults to one reserved Session and rejects a stale concurrent edit', async () => {
  const test = await harness(); contexts.push(test)
  const created = await test.service.create({ title: 'Check', prompt: 'Inspect status', timing: { kind: 'after', after_seconds: 3600 } })
  expect(created.target).toMatchObject({ kind: 'new_once' })
  expect(test.resolve).not.toHaveBeenCalled()
  expect(await test.service.list({ limit: 1 })).toMatchObject({ items: [created], shown: 1, total: 1 })
  const [first, stale] = await Promise.all([
    test.service.edit({ id: created.id, action: 'update', expectedUpdatedAt: created.updatedAt ?? null, patch: { title: 'Revised' } }),
    test.service.edit({ id: created.id, action: 'update', expectedUpdatedAt: created.updatedAt ?? null, patch: { prompt: 'Stale' } }),
  ])
  expect(first).toMatchObject({ title: 'Revised' })
  expect(stale).toEqual({ id: created.id, code: 'schedule_conflict' })
  expect(await test.service.view({ id: created.id })).toEqual(first)
})
it('cancels before storage, pauses and resumes without deleting history', async () => {
  const test = await harness(); contexts.push(test)
  const changed = vi.fn(); test.ctx.on('schedule/changed', changed)
  const signal = AbortSignal.abort(new Error('cancelled'))
  await expect(test.service.create({ title: 'Cancelled', prompt: 'No write', timing: { kind: 'after', after_seconds: 3600 } }, undefined, signal)).rejects.toThrow('cancelled')
  expect((await test.service.list()).total).toBe(0)
  expect(changed).not.toHaveBeenCalled()
  const task = await test.service.create({ title: 'Periodic', prompt: 'Check', timing: { kind: 'every', every_seconds: 300 } })
  expect(await test.service.edit({ id: task.id, action: 'update', patch: { active: false } })).toMatchObject({ status: 'paused' })
  expect(await test.service.deleteInactive()).toEqual({ deleted: 0 })
  expect(await test.service.edit({ id: task.id, action: 'update', patch: { active: true } })).toMatchObject({ status: 'active' })
  expect(await test.service.edit({ id: task.id, action: 'delete' })).toEqual({ id: task.id, deleted: true })
})

it('uses the human Remote error channel for validation and preserves non-input failures', async () => {
  const test = await harness(); contexts.push(test)
  const task = await test.service.remoteCreate({ title: 'Remote', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 } })
  expect(await test.service.remoteList({ limit: 1 })).toMatchObject({ items: [task] })
  await expect(test.service.remoteList({ limit: 0 })).rejects.toMatchObject({
    code: 'schedule/input-invalid', details: { code: 'invalid_rule' },
  })
  await expect(test.service.remoteEdit({ id: task.id, action: 'update', patch: { title: ' ' } }))
    .rejects.toMatchObject({ code: 'schedule/input-invalid', details: { code: 'invalid_prompt' } })
  test.pool.failNextWrites = 1
  await expect(test.service.remoteEdit({ id: task.id, action: 'update', patch: { title: 'Retry' } }))
    .rejects.toThrow('injected write failure')
  expect(await test.service.remoteEdit({ id: task.id, action: 'update', patch: { title: 'Accepted' } }))
    .toMatchObject({ title: 'Accepted' })
  expect(await test.service.run({ id: 'missing' as typeof task.id })).toEqual({ id: 'missing', code: 'schedule_not_found' })
})

it('rejects unsupported timing discriminants and destinations before creating a Session', async () => {
  const test = await harness(); contexts.push(test)
  for (const patch of [{ timing: { kind: 'other', undefined: 1 } }, { target: { kind: 'other' } }]) {
    await expect(Reflect.apply(test.service.create.bind(test.service), undefined, [{
      title: 'Invalid', prompt: 'Invalid', timing: { kind: 'after', after_seconds: 60 }, ...patch,
    }])).rejects.toHaveProperty('code')
  }
  expect(await test.service.catalog()).toEqual([])
})

it('announces completed clear-ended deletions when a later row delete fails, preserving paused rows', async () => {
  const test = await harness(); contexts.push(test)
  const tasks = test.ctx.storageDomain.get('schedule')?.table('tasks')
  if (tasks === undefined) throw new Error('Missing Schedule domain')
  const first = await test.service.create({ title: 'First', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 } })
  const second = await test.service.create({ title: 'Second', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 } })
  const { scheduleTaskSchema } = await import('../src/storage.ts')
  for (const task of [first, second]) await tasks.put(task.id, { ...scheduleTaskSchema.parse(tasks.get(task.id)), status: 'ended' })
  const remove = tasks.delete.bind(tasks)
  vi.spyOn(tasks, 'delete').mockImplementationOnce(remove).mockRejectedValueOnce(new Error('second delete failed'))
  const changed = vi.fn(); test.ctx.on('schedule/changed', changed)
  await expect(test.service.deleteInactive()).rejects.toThrow('second delete failed')
  expect(changed).toHaveBeenCalledOnce()
  expect(await test.service.catalog()).toHaveLength(1)
  expect(await test.service.view({ id: second.id })).toHaveProperty('status', 'ended')
  await expect(test.service.deleteInactive(AbortSignal.abort(new Error('clear cancelled')))).rejects.toThrow('clear cancelled')
  expect(await test.service.catalog()).toHaveLength(1)
})
