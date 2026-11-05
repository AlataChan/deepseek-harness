/** Real Host create/resume controllers, production inboxes, and durable task recovery. */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefaultModel from '../../../core/agent-default-model/src/index.ts'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionDecisions, { answerRequestId } from '../../../experimental/session-decisions/src/index.ts'
import { afterEach, expect, it, vi } from 'vitest'
import ScheduleService from '../src/index.ts'

/** Observe production live and cold Sessions; this fixture never issues a search. */
class ObservationQuery extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('Search is outside this fixture') }
  async searchEvents(): Promise<never> { throw new Error('Search is outside this fixture') }
}
const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
})
async function boot(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'domains') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(ObservationQuery)
  await ctx.plugin(AgentDefaultModel, { provider: 'unused', model: 'unused' })
  await mountAgentLoopTestHarness(ctx)
  // Transport lookup registration is the only external Host seam replaced here.
  ctx.provide('typert', {
    lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('attachments', {
    admitPromptContent: async (content: readonly { type: 'text'; text: string }[]) => [...content],
  } as never)
  ctx.provide('fileUploads', { resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }), retirePrompt: () => {},
  } as never)
  const agents = new ApiSessionAgentController(ctx)
  const commands = new SessionCommandController(ctx, agents, root)
  ctx.provide('sessionController', {
    create: commands.create.bind(commands), resolveAgent: agents.resolveAgent.bind(agents), prompt: commands.prompt.bind(commands),
  } as never)
  await ctx.plugin(ScheduleService)
  return { ctx, commands, agents }
}
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'schedule-host-')); roots.push(path); return path
}
it('cold-resumes a reserved create-before-prompt Session without creating a second identity', async () => {
  const path = await root()
  const first = await boot(path)
  const task = await first.ctx.schedule.create({ title: 'Reserved', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 } })
  expect(task.target.kind).toBe('new_once')
  if (task.target.kind !== 'new_once') throw new Error('Expected reserved target')
  const reserved = task.target.sessionId
  const domain = first.ctx.storageDomain.get('schedule')
  if (domain === undefined) throw new Error('Missing task domain')
  const row = domain.table('tasks').get(task.id)
  if (row === undefined) throw new Error('Missing task')
  await domain.table('tasks').put(task.id, { ...row, pendingDelivery: { targetSessionId: reserved } })
  await first.commands.create({ sessionId: reserved, cwd: path })
  const live = await first.agents.resolveAgent(reserved)
  if ('error' in live) throw live.error
  await first.ctx.sessions.flush(live.agent.session)
  await first.ctx.fiber.dispose()
  const second = await boot(path)
  const create = vi.spyOn(second.ctx.sessionController, 'create')
  const resolved = await second.agents.resolveAgent(reserved)
  if ('error' in resolved) throw resolved.error
  const hold = Promise.withResolvers<undefined>()
  const maintenance = resolved.agent.runMaintenance(signal => new Promise<void>((resolve) => {
    signal.addEventListener('abort', () =>{  resolve() }, { once: true })
    void hold.promise.then(resolve)
  }))
  const result = await second.ctx.schedule.run({ id: task.id })
  expect(result).toMatchObject({ target: { kind: 'session', sessionId: reserved }, lastDelivery: { targetSessionId: reserved } })
  expect(create).toHaveBeenCalledWith({ sessionId: reserved })
  expect((await second.ctx.sessionPersistence.list()).map(item => item.header.id)).toEqual([reserved])
  expect(resolved.agent.inbox.nextTurn).toHaveLength(1)
  expect(resolved.agent.inbox.nextTurn[0]?.source.kind).toBe('schedule')
  expect(await second.ctx.schedule.run({ id: task.id })).toEqual({ id: task.id, code: 'schedule_execution_pending' })
  resolved.agent.inbox.remove(resolved.agent.inbox.nextTurn[0]!.id)
  hold.resolve(undefined); await maintenance
  const stored = second.ctx.storageDomain.get('schedule')
  if (stored === undefined) throw new Error('Missing task domain')
  expect(stored.table('tasks').get(task.id)).not.toHaveProperty('pendingDelivery')
})
it('delivers non-human schedule input through the actual inbox and supersedes an open question while keeping queued answers', async () => {
  const path = await root()
  const { ctx, commands, agents } = await boot(path)
  const id = SessionId('question-owner')
  await commands.create({ sessionId: id, cwd: path })
  const resolved = await agents.resolveAgent(id)
  if ('error' in resolved) throw resolved.error
  const hold = Promise.withResolvers<undefined>()
  const maintenance = resolved.agent.runMaintenance(signal => new Promise<void>((resolve) => {
    signal.addEventListener('abort', () =>{  resolve() }, { once: true }); void hold.promise.then(resolve)
  }))
  await ctx.plugin(SessionDecisions, { enabled: true, feishuEnabled: false,
    defaultTtlMs: 86400000, closedRetentionMs: 2592000000, maxRecords: 1000,
    maxQuestionBytes: 16384, maxChoiceLabelBytes: 512, maxAnswerTextBytes: 16384, maxChoices: 8, reconcileMaxEvents: 100000 })
  const question = await ctx.sessionDecisions.create({ sessionId: id, question: 'Choose', choices: ['A', 'B'] })
  const answerId = answerRequestId(question.decisionId)
  expect((await ctx.sessionDecisions.submit(question.decisionId, 0, answerId, { choiceOrdinal: 1 })).outcome).toBe('accepted')
  const queued = resolved.agent.inbox.nextTurn[0]
  const task = await ctx.schedule.create({ title: 'Review', prompt: 'Review status', timing: { kind: 'every', every_seconds: 300 }, target: { kind: 'session', sessionId: id } })
  await ctx.schedule.run({ id: task.id })
  await expect.poll(async () => (await ctx.sessionDecisions.get(question.decisionId))?.lifecycle).toBe('superseded')
  expect(resolved.agent.inbox.nextTurn).toContainEqual(queued)
  expect(resolved.agent.inbox.nextTurn.at(-1)?.source).toEqual({ kind: 'schedule' })
  for (const message of resolved.agent.inbox.nextTurn) resolved.agent.inbox.remove(message.id)
  hold.resolve(undefined); await maintenance
})

it('honors cancelled delivery admission and keeps accepted input after real Host cancellation and task deletion', async () => {
  const path = await root()
  const { ctx, commands, agents } = await boot(path)
  const id = SessionId('cancel-owner')
  await commands.create({ sessionId: id, cwd: path })
  const resolved = await agents.resolveAgent(id)
  if ('error' in resolved) throw resolved.error
  const maintenance = resolved.agent.runMaintenance(signal => new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  }))
  const task = await ctx.schedule.create({ title: 'Cancel', prompt: 'Retain this input',
    timing: { kind: 'after', after_seconds: 3600 }, target: { kind: 'session', sessionId: id },
  })
  const abort = new AbortController()
  abort.abort(new Error('admission cancelled'))
  await expect(ctx.schedule.run({ id: task.id }, abort.signal)).rejects.toThrow('admission cancelled')
  expect(resolved.agent.inbox.nextTurn).toHaveLength(0)
  expect(await ctx.schedule.view({ id: task.id })).toEqual(task)
  await ctx.schedule.run({ id: task.id })
  const queued = resolved.agent.inbox.nextTurn[0]
  expect(queued?.source).toEqual({ kind: 'schedule' })
  expect(await ctx.schedule.edit({ id: task.id, action: 'delete' })).toEqual({ id: task.id, deleted: true })
  expect(resolved.agent.inbox.nextTurn).toContainEqual(queued)
  expect(commands.cancel({ sessionId: id })).toEqual({ accepted: true })
  expect(resolved.agent.inbox.nextTurn).toContainEqual(queued)
  if (queued !== undefined) resolved.agent.inbox.remove(queued.id)
  await maintenance
})

it('delivers successive recurring occurrences through the real Host resolver and inbox', async () => {
  const path = await root()
  const { ctx, commands, agents } = await boot(path)
  const id = SessionId('recurring-owner')
  await commands.create({ sessionId: id, cwd: path })
  const resolved = await agents.resolveAgent(id)
  if ('error' in resolved) throw resolved.error
  const hold = Promise.withResolvers<undefined>()
  const maintenance = resolved.agent.runMaintenance(signal => new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
    void hold.promise.then(resolve)
  }))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
  try {
    const task = await ctx.schedule.create({ title: 'Recurring', prompt: 'Inspect each occurrence',
      timing: { kind: 'every', every_seconds: 60 }, target: { kind: 'session', sessionId: id },
    })
    for (let index = 1; index <= 2; index++) {
      await vi.advanceTimersByTimeAsync(60_000)
      // The edit joins the delivery FIFO and waits for its durable receipt.
      await ctx.schedule.edit({ id: task.id, action: 'update', patch: { title: 'Recurring' } })
      expect(await ctx.schedule.history({ id: task.id, limit: 10 })).toHaveProperty('records.length', index)
      expect(resolved.agent.inbox.nextTurn).toHaveLength(index)
      expect(resolved.agent.inbox.nextTurn.at(-1)?.source).toEqual({ kind: 'schedule' })
    }
    expect(await ctx.schedule.view({ id: task.id })).toMatchObject({ status: 'active',
      scheduledAt: '2026-11-01T00:03:00.000Z', lastDelivery: { targetSessionId: id },
    })
  } finally {
    for (const message of resolved.agent.inbox.nextTurn) resolved.agent.inbox.remove(message.id)
    hold.resolve(undefined)
    await maintenance
    vi.useRealTimers()
  }
})
