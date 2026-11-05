/** Three destinations share the single timer runtime and durable receipt writer. */
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { harness, agentFor, type HarnessAgent } from './harness.ts'
const tests: Awaited<ReturnType<typeof harness>>[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T00:00:00Z')) })
afterEach(async () => { for (const test of tests.splice(0)) await test.ctx.fiber.dispose(); vi.useRealTimers() })
it.each(['session', 'new_once', 'new'] as const)('delivers %s with explicit schedule attribution and reuses only the intended destination', async (kind) => {
  const test = await harness(); tests.push(test)
  const original = agentFor(test.ctx)
  ctxRegister()
  function ctxRegister() { test.ctx.effect(() => test.ctx.agents.enter(original, undefined)) }
  test.resolve.mockImplementation(async (id) => {
    const agent = test.ctx.agents.get(id)
    if (agent === undefined) throw new Error('Missing reserved target')
    return { agent }
  })
  const target = kind === 'session' ? { kind, sessionId: original.id } : { kind }
  const task = await test.service.create({ title: 'Repeat', prompt: 'Check', timing: { kind: 'every', every_seconds: 60 }, target })
  await vi.advanceTimersByTimeAsync(60_000)
  const [first] = await test.service.catalog()
  expect(first?.lastDelivery).toMatchObject({ scheduledAt: '2026-11-01T00:01:00.000Z' })
  const firstTarget = first!.lastDelivery!.targetSessionId
  const delivered = test.ctx.agents.get(firstTarget) as HarnessAgent | undefined
  expect(delivered?.followup).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'schedule' } }))
  await vi.advanceTimersByTimeAsync(60_000)
  const [second] = await test.service.catalog()
  if (kind === 'new') expect(second?.lastDelivery?.targetSessionId).not.toBe(firstTarget)
  else expect(second?.lastDelivery?.targetSessionId).toBe(firstTarget)
  expect(test.create).toHaveBeenCalledTimes(kind === 'session' ? 0 : kind === 'new_once' ? 1 : 2)
  const history = await test.service.history({ id: task.id, limit: 10 })
  expect(history).toHaveProperty('records')
  if (!('records' in history)) throw new Error('Missing delivery history')
  expect(history.records.map(record => record.targetSessionId)).toContain(firstTarget)
})

it('announces reused-target completion so Run now becomes available after whole-agent idle', async () => {
  const test = await harness(); tests.push(test)
  const agent = agentFor(test.ctx)
  const idle = Promise.withResolvers<undefined>()
  agent.whenIdle = () => idle.promise
  test.resolve.mockResolvedValue({ agent })
  const task = await test.service.create({ title: 'Run', prompt: 'Inspect',
    timing: { kind: 'after', after_seconds: 3600 }, target: { kind: 'session', sessionId: agent.id },
  })
  await test.service.run({ id: task.id })
  expect(await test.service.view({ id: task.id })).toHaveProperty('executionActive', true)
  const changed = vi.fn()
  test.ctx.on('schedule/changed', changed)
  idle.resolve(undefined)
  await Promise.resolve()
  expect(changed).toHaveBeenCalledOnce()
  expect(await test.service.view({ id: task.id })).not.toHaveProperty('executionActive')
})

it('refuses an archived existing destination at creation and again before manual delivery', async () => {
  const test = await harness(); tests.push(test)
  const agent = agentFor(test.ctx)
  const archivedSessionIds: typeof agent.id[] = []
  test.ctx.provide('workspaceRegistry', { archivedSessionIds } as never)
  const request = { title: 'Archive guard', prompt: 'Inspect', timing: { kind: 'after' as const, after_seconds: 3600 },
    target: { kind: 'session' as const, sessionId: agent.id },
  }
  archivedSessionIds.push(agent.id)
  await expect(test.service.create(request)).rejects.toThrow('archived')
  archivedSessionIds.length = 0
  const task = await test.service.create(request)
  archivedSessionIds.push(agent.id)
  await expect(test.service.run({ id: task.id })).rejects.toThrow('archived')
  expect(test.resolve).not.toHaveBeenCalled()
  expect(agent.followup).not.toHaveBeenCalled()
  expect(await test.service.view({ id: task.id })).toEqual(task)
})

it('inherits original header cwd for Agent-owned new targets and refuses a missing cold destination', async () => {
  const test = await harness(); tests.push(test)
  const actor = agentFor(test.ctx, 'acting-owner', { cwd: '/original-workspace' })
  expect(await test.service.create({ title: 'Owned', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 } }, actor.session))
    .toMatchObject({ target: { kind: 'new_once', create: { cwd: '/original-workspace' } }, involvedSessionIds: [actor.id, expect.any(String)] })
  vi.spyOn(test.ctx.sessionPersistence, 'stat').mockResolvedValueOnce(undefined)
  await expect(test.service.create({ title: 'Missing', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: actor.id },
  }, undefined, new AbortController().signal)).resolves.toHaveProperty('target.sessionId', actor.id)
  const missing = SessionId('never-created')
  await expect(test.service.create({ title: 'Missing', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: missing },
  }, undefined, new AbortController().signal)).rejects.toThrow('does not exist')
})

it('leaves manual delivery retryable after Session persistence refuses its inbox acknowledgement', async () => {
  const test = await harness(); tests.push(test)
  const agent = agentFor(test.ctx)
  test.resolve.mockResolvedValue({ agent })
  const task = await test.service.create({ title: 'Retry', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: agent.id },
  })
  vi.spyOn(test.ctx.sessions, 'flush').mockResolvedValueOnce(false)
  await expect(test.service.run({ id: task.id })).rejects.toThrow('Session persistence did not acknowledge')
  expect(agent.followup).toHaveBeenCalledOnce()
  expect(await test.service.view({ id: task.id })).toEqual(task)
  expect(await test.service.run({ id: task.id })).toHaveProperty('lastDelivery.targetSessionId', agent.id)
})

it('rejects delegated cold Session metadata without activating the stored destination', async () => {
  const test = await harness(); tests.push(test)
  const owner = agentFor(test.ctx)
  const id = SessionId('stored-child')
  const stat = vi.spyOn(test.ctx.sessionPersistence, 'stat')
  stat.mockResolvedValueOnce({ header: { ...owner.session.header, id, delegationDepth: 1 },
    revision: SessionPersistenceRevision('stored-child-revision'),
  })
  await expect(test.service.create({ title: 'Refused', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: id },
  })).rejects.toHaveProperty('code', 'subagent_session')
  const { delegationDepth: _depth, ...ordinary } = owner.session.header
  stat.mockResolvedValueOnce({ header: { ...ordinary, id }, revision: SessionPersistenceRevision('ordinary-revision') })
  expect(await test.service.create({ title: 'Accepted', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: id },
  })).toHaveProperty('target.sessionId', id)
  expect(test.resolve).not.toHaveBeenCalled()
})
