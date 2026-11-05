/** Observer lifecycle over real Agents, inboxes, Session events and durable question aggregates. */
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DecisionFacts, DecisionId } from '../src/types.ts'
import { addAbortListener } from 'node:events'
import { expect, it, onTestFinished, vi } from 'vitest'
import { DecisionObservers } from '../src/observers.ts'
import { answerRequestId } from '../src/store.ts'
import { stubAgent } from './agent-carrier.ts'
import { ReplyAdapter } from './admission-world.ts'
import { FakeClock, openStore } from './harness.ts'

async function world() {
  const clock = new FakeClock()
  const fixture = await openStore(clock)
  const { ctx, store } = fixture
  onTestFinished(async () => { await fixture.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  const tools = ctx.plugin(ToolRuntime)
  await tools
  const loop = await mountAgentLoopTestHarness(ctx)
  const model = new ReplyAdapter()
  ctx.effect(() => ctx.llm.registerAdapter(['unit'], model))
  let available = true
  const pending: Promise<unknown>[] = []
  const errors: unknown[] = []
  const settle = vi.fn((id: DecisionId, facts: DecisionFacts) => {
    store.accumulateFacts(id, facts)
    pending.push(store.settleFacts(id).catch((error: unknown) => { errors.push(error) }))
  })
  const failedSupersede = vi.fn<(id: DecisionId) => void>()
  const observer = new DecisionObservers(ctx, () => available ? store : undefined, settle, failedSupersede)
  observer.start()
  onTestFinished(() => { observer.dispose() })
  ctx.tools.register(defineTool({ name: 'observer_probe', description: 'A synthetic observer guard probe.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'ok' }))
  async function agent(id: string) {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: '/workspace' },
      agentOptions: { provider: 'unit', model: 'unit' } })
    const release = Promise.withResolvers<undefined>()
    void handle.agent.runMaintenance(async (signal) => {
      const abort = addAbortListener(signal, () => { release.resolve(undefined) })
      try { await release.promise } finally { abort[Symbol.dispose]() }
    })
    return { ...handle, release: () => { release.resolve(undefined) } }
  }
  async function reserved(agent: Agent) {
    const q = await store.create({ sessionId: agent.session.id, question: 'Which database?', choices: ['A', 'B'] })
    await store.reserveAnswer(q.decisionId, q.revision, { requestId: answerRequestId(q.decisionId) })
    return q
  }
  async function flush() {
    await store.drain()
    await Promise.all(pending.splice(0))
    expect(errors).toEqual([])
  }
  async function probe(agent: Agent) {
    return ctx.agents.withInitiator(agent, () => ctx.tools.execute({ agent, signal: new AbortController().signal,
      name: 'observer_probe', callId: ToolCallId('observer-probe'), arguments: {} }))
  }
  return { ...fixture, clock, observer, tools, loop, agent, reserved, settle, failedSupersede, flush, probe,
    setAvailable(value: boolean) { available = value } }
}

function message(id?: DecisionId, text = 'A') {
  return createUserMessage({ content: [{ type: 'text', text }], source: id === undefined
    ? { kind: 'user' } : { kind: 'user', rpcId: answerRequestId(id) } })
}

function step(agent: Agent, turn = 1, step = 1) {
  agent.session.append('turn/start', { turn })
  agent.session.append('step/start', { turn, step })
  agent.session.append('tool/call', { turn, step, callId: ToolCallId('asking-call'), name: 'request_persistent_question', arguments: '{}' })
  return { turn, step, callId: 'asking-call' }
}

it('keeps a repeated guard monotonic and ignores unrelated step or turn completions', async () => {
  const h = await world()
  const a = await h.agent('guard-boundaries')
  const identity = step(a.agent)
  h.observer.armProducingGuard(a.agent, identity)
  h.observer.armProducingGuard(a.agent, identity)
  a.agent.session.append('step/end', { turn: 1, step: 2 })
  expect((await h.probe(a.agent)).isError).toBe(true)
  a.agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  expect((await h.probe(a.agent)).isError).toBe(true)
  a.agent.session.append('step/end', { turn: 1, step: 1 })
  expect((await h.probe(a.agent)).isError).toBe(false)
})

it('does not match unknown calls or calls from a different producing step', async () => {
  const h = await world()
  const a = await h.agent('step-call-identity')
  expect(h.observer.producingIdentity(a.agent.session.id, 'unknown')).toBeUndefined()
  step(a.agent)
  a.agent.session.append('tool/call', { turn: 1, step: 2, callId: ToolCallId('late-call'), name: 'observer_probe', arguments: '{}' })
  expect(h.observer.producingIdentity(a.agent.session.id, 'late-call')).toBeUndefined()
  expect(h.observer.producingIdentity(a.agent.session.id, 'unknown')).toBeUndefined()
})

it('retains a replacement Agent guard and producing identity after an old disposal notification', async () => {
  const h = await world()
  const old = await h.agent('replaced-agent')
  const oldIdentity = step(old.agent)
  h.observer.armProducingGuard(old.agent, oldIdentity)
  await old.dispose()
  const current = await h.agent('replaced-agent')
  const currentIdentity = step(current.agent)
  h.observer.armProducingGuard(current.agent, currentIdentity)
  h.ctx.emit('agent/disposed', { agent: old.agent })
  expect(h.observer.producingIdentity(current.agent.session.id, 'asking-call')).toEqual(currentIdentity)
  expect((await h.probe(current.agent)).isError).toBe(true)
})

it('unwinds an armed guard with the observer owner', async () => {
  const h = await world()
  const a = await h.agent('observer-disposal')
  h.observer.armProducingGuard(a.agent, step(a.agent))
  h.observer.dispose()
  expect((await h.probe(a.agent)).isError).toBe(false)
})

it('handles a guard request after the tool capability has unloaded', async () => {
  const h = await world()
  const a = await h.agent('lost-tools')
  const identity = step(a.agent)
  await h.tools.dispose()
  expect(() => { h.observer.armProducingGuard(a.agent, identity) }).not.toThrow()
})

it('does not settle another Session from a copied answer identity', async () => {
  const h = await world()
  const a = await h.agent('owner-a')
  const b = await h.agent('owner-b')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  const settledBefore = h.settle.mock.calls.length
  b.agent.followup(message(q.decisionId))
  b.release()
  await b.agent.whenIdle()
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('submitting')
  expect(h.settle).toHaveBeenCalledTimes(settledBefore)
})

it.each([new Error('digest write failed'), 'digest write failed'])('keeps an edited answer pending after digest persistence fails: %s', async (error) => {
  const h = await world()
  const a = await h.agent('failed-digest')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  const update = vi.spyOn(h.domain.table('decisions'), 'update').mockRejectedValueOnce(error)
  try {
    a.agent.inbox.splice('next-turn', 0, 1, [message(q.decisionId, 'B')])
    await h.flush()
    expect(h.store.get(q.decisionId)?.answerIndex).toBe('submitting')
  } finally { update.mockRestore() }
})

it('ignores observer traffic after its store has degraded', async () => {
  const h = await world()
  const a = await h.agent('degraded-store')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  h.setAvailable(false)
  a.agent.inbox.splice('next-turn', 0, 1, [])
  a.agent.followup(message())
  h.ctx.emit('agent/inbox/claimed', { agent: a.agent, message: message(q.decisionId), turn: 1 })
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('submitting')
  await a.dispose()
  await h.agent('created-after-degradation')
})

it('retains withdrawn tracking when the same answer is reinserted and removed', async () => {
  const h = await world()
  const a = await h.agent('withdrawn-reinsert')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  a.agent.inbox.splice('next-turn', 0, 1, [])
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('withdrawn')
  a.agent.followup(message(q.decisionId))
  await h.flush()
  a.agent.inbox.splice('next-turn', 0, 1, [])
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('withdrawn')
})

it('does not rewrite an unchanged answer during a queue edit', async () => {
  const h = await world()
  const a = await h.agent('identical-edit')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  const update = vi.spyOn(h.store, 'updateAnswerDigest')
  a.agent.inbox.splice('next-turn', 0, 1, [message(q.decisionId)])
  await h.flush()
  expect(update).not.toHaveBeenCalled()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('submitting')
})

it('ignores a question closed during the durable-write/index-update gap', async () => {
  const h = await world()
  const a = await h.agent('closure-gap')
  const q = await h.store.create({ sessionId: a.agent.session.id, question: 'Which database?', choices: [] })
  const table = h.domain.table('decisions')
  const update = table.update.bind(table)
  vi.spyOn(table, 'update').mockImplementationOnce(async (...args) => {
    const saved = await update(...args)
    a.agent.followup(message())
    return saved
  })
  const supersede = vi.spyOn(h.store, 'supersede')
  await h.store.cancel(q.decisionId, q.revision)
  await h.flush()
  expect(supersede).not.toHaveBeenCalled()
  expect(h.store.get(q.decisionId)?.lifecycle).toBe('cancelled')
})

it('marks an undispatched reservation unknown when its exact Agent is disposed', async () => {
  const h = await world()
  const a = await h.agent('disposed-reservation')
  const b = await h.agent('other-owner')
  const q = await h.reserved(a.agent)
  await h.store.create({ sessionId: b.agent.session.id, question: 'Another question', choices: [] })
  await a.dispose()
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('needs_reconciliation')
})

it('does not downgrade an admitted answer when its Agent exits', async () => {
  const h = await world()
  const a = await h.agent('admitted-exit')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  a.release()
  await a.agent.whenIdle()
  await h.flush()
  await a.dispose()
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('admitted')
})

it('does not reopen dismissed tracking on Agent disposal', async () => {
  const h = await world()
  const a = await h.agent('dismissed-exit')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  const current = h.store.get(q.decisionId)!
  await h.store.dismiss(q.decisionId, current.revision)
  await a.dispose()
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('dismissed')
})


it('leaves settled withdrawal unchanged when the Agent closes', async () => {
  const h = await world()
  const a = await h.agent('withdrawal-exit')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  a.agent.inbox.splice('next-turn', 0, 1, [])
  await h.flush()
  await a.dispose()
  await h.flush()
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('withdrawn')
})

it('contains notifications while the inbox projection capability is absent', async () => {
  const fixture = await openStore(new FakeClock())
  const { ctx, store } = fixture
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const carrier = stubAgent('missing-projection', ctx)
  await ctx.agents.register(carrier.agent)
  const missingReader = () => {
    throw new Error('inbox projection is not registered')
  }
  const nextTurn = vi.spyOn(carrier.inbox, 'nextTurn', 'get').mockImplementation(missingReader)
  const nextStep = vi.spyOn(carrier.inbox, 'nextStep', 'get').mockImplementation(missingReader)
  const q = await store.create({ sessionId: carrier.session.id, question: 'Which database?', choices: ['A', 'B'] })
  await store.reserveAnswer(q.decisionId, q.revision, { requestId: answerRequestId(q.decisionId) })
  const settled: Promise<unknown>[] = []
  const observer = new DecisionObservers(ctx, () => store, (id, facts) => {
    store.accumulateFacts(id, facts)
    settled.push(store.settleFacts(id))
  }, () => {})
  try {
    observer.start()
    carrier.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message(q.decisionId)] })
    carrier.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
    await Promise.all(settled)
    expect(store.get(q.decisionId)?.answerIndex).toBe('submitting')
  } finally {
    nextTurn.mockRestore()
    nextStep.mockRestore()
    observer.dispose()
    await fixture.dispose()
  }
})


it.each([new Error('supersede failed'), 'supersede failed'])('reports a failed supersession to its admission owner: %s', async (error) => {
  const h = await world()
  const a = await h.agent('failed-supersession')
  const q = await h.store.create({ sessionId: a.agent.session.id, question: 'Which database?', choices: [] })
  vi.spyOn(h.domain.table('decisions'), 'update').mockRejectedValueOnce(error)
  a.agent.followup(message())
  await vi.waitFor(() => { expect(h.failedSupersede).toHaveBeenCalledWith(q.decisionId) })
  expect(h.store.get(q.decisionId)?.lifecycle).toBe('open')
})

it('settles a claimed answer only at its owning Session and turn boundary', async () => {
  const h = await world()
  const a = await h.agent('claimed-owner')
  const b = await h.agent('unrelated-boundary')
  const q = await h.reserved(a.agent)
  a.agent.followup(message(q.decisionId))
  await h.flush()
  expect(h.loop.claim(a.agent, 'next-turn', 1)).toHaveLength(1)
  b.agent.session.append('step/end', { turn: 1, step: 1 })
  a.agent.session.append('step/end', { turn: 2, step: 1 })
  await h.flush()
  expect(h.observer.hasUnsettledClaim(q.decisionId)).toBe(true)
  a.agent.session.append('step/end', { turn: 1, step: 1 })
  await h.flush()
  expect(h.observer.hasUnsettledClaim(q.decisionId)).toBe(false)
  expect(h.store.get(q.decisionId)?.answerIndex).toBe('needs_reconciliation')
})

it.each(['submitting', 'dismissed', 'ordinary', 'foreign'] as const)('inspects already-pending input when observers restart: %s', async (state) => {
  const h = await world()
  const a = await h.agent('cold-inspection')
  const b = await h.agent('cold-other-session')
  const q = await h.reserved(a.agent)
  const target = state === 'foreign' ? b.agent : a.agent
  target.followup(state === 'ordinary' ? message() : message(q.decisionId))
  await h.flush()
  if (state === 'dismissed') await h.store.dismiss(q.decisionId, h.store.get(q.decisionId)!.revision)
  h.observer.dispose()
  const pending: Promise<unknown>[] = []
  const observe = vi.fn((id: DecisionId, facts: DecisionFacts) => {
    h.store.accumulateFacts(id, facts)
    pending.push(h.store.settleFacts(id))
  })
  const restarted = new DecisionObservers(h.ctx, () => h.store, observe, () => {})
  try {
    restarted.start()
    await Promise.all(pending)
    if (state === 'submitting') expect(observe).toHaveBeenCalledWith(q.decisionId, { pending: true })
    else expect(observe).not.toHaveBeenCalled()
  } finally { restarted.dispose() }
})
