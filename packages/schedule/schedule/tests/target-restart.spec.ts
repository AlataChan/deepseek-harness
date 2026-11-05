/** Failed Session creation retains one reserved destination across Host restarts. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { agentFor, harness } from './harness.ts'

const tests: Awaited<ReturnType<typeof harness>>[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T00:00:00Z')) })
afterEach(async () => {
  for (const test of tests.splice(0)) await test.ctx.fiber.dispose()
  vi.useRealTimers()
})

it.each(['new_once', 'new'] as const)('retries %s with the persisted destination after create fails', async (kind) => {
  const first = await harness(); tests.push(first)
  const task = await first.service.create({ title: 'Recover', prompt: 'Inspect',
    timing: { kind: 'after', after_seconds: 3600 }, target: { kind },
  })
  first.create.mockRejectedValueOnce(new Error('create interrupted'))
  await expect(first.service.run({ id: task.id })).rejects.toThrow('create interrupted')
  const reserved = first.create.mock.calls[0]?.[0].sessionId
  expect(reserved).toBeDefined()
  expect(first.pool.media.get('schedule')?.tables.get('tasks')?.get(task.id))
    .toHaveProperty('pendingDelivery.targetSessionId', reserved)
  await first.ctx.fiber.dispose()
  const second = await harness({ pool: first.pool }); tests.push(second)
  second.resolve.mockImplementation(async (id) => {
    const agent = second.ctx.agents.get(id)
    if (agent === undefined) throw new Error('Reserved Session was not created')
    return { agent }
  })
  const recovered = await second.service.run({ id: task.id })
  expect(second.create).toHaveBeenCalledExactlyOnceWith({ sessionId: reserved })
  expect(recovered).toMatchObject({ lastDelivery: { targetSessionId: reserved } })
  expect(second.pool.media.get('schedule')?.tables.get('tasks')?.get(task.id)).not.toHaveProperty('pendingDelivery')
})

it('rejects a delegated acting Session without creating a destination', async () => {
  const test = await harness(); tests.push(test)
  const delegated = agentFor(test.ctx, 'child', { delegationDepth: 1 })
  await expect(test.service.create({ title: 'Forbidden', prompt: 'Inspect',
    timing: { kind: 'after', after_seconds: 60 },
  }, delegated.session)).rejects.toThrow()
  expect(test.create).not.toHaveBeenCalled()
  expect(await test.service.catalog()).toEqual([])
})
