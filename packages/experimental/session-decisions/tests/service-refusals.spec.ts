/** Service refusal, retry and teardown paths through actual storage and Session commands. */
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { answerRequestId, DecisionStore, digestOf, mintDecisionId } from '../src/store.ts'
import { decisionsDomain } from '../src/schema.ts'
import { systemDecisionClock } from '../src/clock.ts'
import type { AnswerSubmitPayload, DecisionId } from '../src/types.ts'
import { admissionHarness, ReplyAdapter, SESSION } from './admission-world.ts'
import { requestId, testLimits } from './harness.ts'

it.each<AnswerSubmitPayload>([
  {}, { choiceOrdinal: 1, text: 'both' }, { text: '' }, { choiceOrdinal: 0 }, { choiceOrdinal: 1.5 },
  { choiceOrdinal: 3 }, { text: 'x'.repeat(17) },
])('refuses invalid answers without reserving or prompting: %j', async (payload) => {
  const h = await admissionHarness({ maxAnswerTextBytes: 16 })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, payload)).toMatchObject({ outcome: 'rejected' })
  expect(await h.service.get(q.decisionId)).toMatchObject({ answerIndex: 'none' })
  expect(h.followup).not.toHaveBeenCalled()
})

it('resumes a paused question through the public mutation and retains normal answer admission', async () => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const paused = await h.service.pause(q.decisionId, q.revision, 'user-requested')
  expect(paused.ok).toBe(true)
  if (!paused.ok) throw new Error('pause failed')
  expect(await h.service.resume(q.decisionId, paused.record.revision)).toMatchObject({ ok: true, record: { suspended: false } })
  expect(await h.service.resume(mintDecisionId(), 0)).toMatchObject({ ok: false, reason: 'DECISION_NOT_FOUND' })
})

it.each(['cancel', 'pause', 'dismiss', 'resume'] as const)('reports typed not-found failures through %s', async (action) => {
  const h = await admissionHarness()
  const id = mintDecisionId()
  const result = action === 'pause' ? await h.service.pause(id, 0, 'user-requested') : await h.service[action](id, 0)
  expect(result).toMatchObject({ ok: false, reason: 'DECISION_NOT_FOUND' })
})

it.each(['cancelled', 'expired'] as const)('does not reserve a closed question: %s', async (state) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'], ttlMs: state === 'expired' ? 10 : 1_000_000 })
  if (state === 'cancelled') await h.service.cancel(q.decisionId, q.revision)
  else await vi.waitFor(async () => { expect(await h.service.get(q.decisionId)).toMatchObject({ lifecycle: 'expired' }) })
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'rejected', reason: state === 'expired' ? 'DECISION_EXPIRED' : 'DECISION_TRACKING_CLOSED' })
  expect(h.followup).not.toHaveBeenCalled()
})

it.each([new Error('prompt transport closed'), 'prompt transport closed'])('retains uncertainty after a pre-enqueue prompt failure: %s', async (error) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  h.followup.mockImplementationOnce(() => { throw error })
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'reconciliation_required' })
})

it.each([new Error('flush failed'), 'flush failed'])('keeps a durably reserved answer pending when its Session flush fails: %s', async (error) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const flush = vi.spyOn(h.ctx.sessions, 'flush').mockRejectedValueOnce(error)
  try {
    expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })).toMatchObject({ outcome: 'submitting' })
    expect(h.followup).toHaveBeenCalledTimes(1)
    expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })).toMatchObject({ outcome: 'submitting' })
    expect(h.followup).toHaveBeenCalledTimes(1)
  } finally { flush.mockRestore() }
})

it('refuses new work after teardown and never sends a held callback after its services disappear', async () => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const pending = h.service.admitAnswer(q.decisionId, q.revision, { choiceOrdinal: 1 }, () => {
    entered.resolve(undefined)
    return release.promise
  })
  const rejection = expect(pending).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
  await entered.promise
  await h.ctx.fiber.dispose()
  release.resolve(undefined)
  await rejection
  expect(h.followup).not.toHaveBeenCalled()
  await expect(h.service.create({ sessionId: SESSION, question: 'Again?', choices: [] })).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'rejected', reason: 'DECISION_UNAVAILABLE' })
})

it('retains uncertainty for a legacy reservation with a different saved request identity', async () => {
  let id: DecisionId | undefined
  const h = await admissionHarness({}, { persistent: true, async beforeService(ctx, agent) {
    const domain = await ctx.storageDomain.open(decisionsDomain)
    try {
      const store = new DecisionStore(domain, systemDecisionClock, testLimits())
      const q = await store.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
      id = q.decisionId
      const legacyId = requestId('legacy-answer-request')
      await store.reserveAnswer(q.decisionId, q.revision, { requestId: legacyId })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'A previously queued answer' }],
        source: { kind: 'user', rpcId: legacyId } }))
      await ctx.sessions.flush(agent.session)
    } finally { await domain.close() }
  } })
  if (id === undefined) throw new Error('legacy question was not seeded')
  const q = await h.service.get(id)
  expect(q).toMatchObject({ answerIndex: 'needs_reconciliation' })
  expect(await h.service.submit(id, q!.revision, answerRequestId(id), { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'reconciliation_required' })
  expect(h.followup).toHaveBeenCalledTimes(1)
})

it('treats a copied answer request ID as ordinary human input until an answer was reserved', async () => {
  const h = await admissionHarness({}, { model: new ReplyAdapter() })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  await h.ctx.sessionController.prompt({ sessionId: SESSION, requestId: q.requestId, mode: 'queue',
    content: [{ type: 'text', text: 'This is a new request, not a reserved answer.' }] }, new AbortController().signal)
  await vi.waitFor(async () => { expect(await h.service.get(q.decisionId)).toMatchObject({ lifecycle: 'superseded', answerIndex: 'none' }) })
  h.releaseMaintenance()
  await h.agent.whenIdle()
  expect(await h.service.get(q.decisionId)).toMatchObject({ hasAnswer: false })
})

it('stops timers and observers when optional channel activation fails after the question store opens', async () => {
  vi.useFakeTimers()
  let h: Awaited<ReturnType<typeof admissionHarness>> | undefined
  let baselineTimers = 0
  try {
    h = await admissionHarness({ feishuEnabled: true }, { persistent: true, async beforeService(ctx, agent) {
      const domain = await ctx.storageDomain.open(decisionsDomain)
      try {
        const store = new DecisionStore(domain, systemDecisionClock, testLimits())
        await store.create({ sessionId: SESSION, question: 'Pending activation question', choices: ['A', 'B'],
          ttlMs: 1000, contextAnchorSeq: 0 })
        agent.session.append('model/selection', { provider: 'unit', model: 'unit' })
        await ctx.sessions.flush(agent.session)
      } finally { await domain.close() }
      ctx.provide('desktopIm', { cardChannel: () => undefined,
        registerCardConsumer() { throw new Error('card consumer already registered') } } as never)
      baselineTimers = vi.getTimerCount()
    } })
    expect(await h.service.status()).toMatchObject({ available: false })
    expect(vi.getTimerCount()).toBe(baselineTimers)
    h.agent.session.append('step/start', { turn: 1, step: 1 })
    h.agent.session.append('tool/call', { turn: 1, step: 1, callId: 'disabled-call' as never,
      name: 'request_persistent_question', arguments: '{}' })
    expect(h.service.producingIdentity(SESSION, 'disabled-call')).toBeUndefined()
  } finally { await h?.ctx.fiber.dispose(); vi.useRealTimers() }
})

it('ignores facts for a question that no longer exists', async () => {
  const h = await admissionHarness()
  expect(await h.service.applyFacts(mintDecisionId(), { entered: true })).toBeUndefined()
})

it.each([new Error('record read failed'), 'record read failed'])('reports an unexpected record read as unavailable: %s', async (error) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const domain = h.ctx.storageDomain.get(decisionsDomain.name)
  if (domain === undefined) throw new Error('question domain unavailable')
  const get = vi.spyOn(domain.table('decisions'), 'get').mockImplementationOnce(() => { throw error })
  try {
    await expect(Promise.resolve().then(() => h.service.get(q.decisionId))).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
  } finally { get.mockRestore() }
})

it.each([new Error('record write failed'), 'record write failed'])('reports an unexpected mutation write as unavailable: %s', async (error) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const domain = h.ctx.storageDomain.get(decisionsDomain.name)
  if (domain === undefined) throw new Error('question domain unavailable')
  const write = vi.spyOn(domain.table('decisions'), 'update').mockRejectedValueOnce(error)
  try {
    await expect(h.service.cancel(q.decisionId, q.revision)).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
    expect(await h.service.get(q.decisionId)).toMatchObject({ lifecycle: 'open' })
  } finally { write.mockRestore() }
})

it('isolates a non-Error failure from the durable domain provider', async () => {
  const h = await admissionHarness({}, { beforeService(ctx) {
    vi.spyOn(ctx.storageDomain, 'open').mockRejectedValueOnce('medium unavailable')
  } })
  expect(await h.service.status()).toMatchObject({ available: false, reason: 'medium unavailable' })
})

it('preserves the reservation when a local admission prerequisite rejects with a non-Error value', async () => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercise a foreign channel's non-Error rejection.
  expect(await h.service.admitAnswer(q.decisionId, q.revision, { choiceOrdinal: 1 }, () => Promise.reject('channel revoked')))
    .toMatchObject({ outcome: 'submitting' })
  expect(h.followup).not.toHaveBeenCalled()
})

it.each([new Error('shutdown write failed'), 'shutdown write failed'])('contains a failed reservation settlement during feature shutdown: %s', async (error) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  await h.service.admitAnswer(q.decisionId, q.revision, { choiceOrdinal: 1 }, () => Promise.reject(new Error('not dispatched')))
  const domain = h.ctx.storageDomain.get(decisionsDomain.name)
  if (domain === undefined) throw new Error('question domain unavailable')
  vi.spyOn(domain.table('decisions'), 'update').mockRejectedValueOnce(error)
  await h.closeFeature()
  expect(await h.service.status()).toMatchObject({ available: false })
  expect(h.followup).not.toHaveBeenCalled()
})

it.each([new Error('expiry write failed'), 'expiry write failed'])('stops the feature after its owned expiry sweep fails: %s', async (error) => {
  vi.useFakeTimers()
  let h: Awaited<ReturnType<typeof admissionHarness>> | undefined
  try {
    h = await admissionHarness()
    const q = await h.service.create({ sessionId: SESSION, question: 'Expiring question', choices: [], ttlMs: 1000 })
    const domain = h.ctx.storageDomain.get(decisionsDomain.name)
    if (domain === undefined) throw new Error('question domain unavailable')
    vi.spyOn(domain.table('decisions'), 'update').mockRejectedValueOnce(error)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await h.service.status()).toMatchObject({ available: false })
    expect(h.followup).not.toHaveBeenCalled()
    await expect(Promise.resolve().then(() => h!.service.get(q.decisionId))).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
  } finally { await h?.ctx.fiber.dispose(); vi.useRealTimers() }
})

it('recognizes a genuinely pending answer when its stored index needed reconciliation', async () => {
  let id: DecisionId | undefined
  const h = await admissionHarness({}, { persistent: true, async beforeService(ctx, agent) {
    const domain = await ctx.storageDomain.open(decisionsDomain)
    try {
      const store = new DecisionStore(domain, systemDecisionClock, testLimits())
      const q = await store.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'], contextAnchorSeq: 0 })
      id = q.decisionId
      const rpcId = answerRequestId(q.decisionId)
      await store.reserveAnswer(q.decisionId, q.revision, { requestId: rpcId, digest: digestOf({ choiceOrdinal: 1 }) })
      await store.markNeedsReconciliation(q.decisionId)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: `Answer to question ${q.decisionId}: option 1` }],
        source: { kind: 'user', rpcId } }))
      await ctx.sessions.flush(agent.session)
    } finally { await domain.close() }
  } })
  if (id === undefined) throw new Error('question was not seeded')
  await vi.waitFor(async () => { expect(await h.service.get(id!)).toMatchObject({ answerIndex: 'submitting' }) })
  expect(h.followup).toHaveBeenCalledTimes(1)
})

it('reports a withdrawn answer on retry without re-sending its prompt', async () => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })
  h.agent.inbox.splice('next-turn', 0, 1, [])
  await vi.waitFor(async () => { expect(await h.service.get(q.decisionId)).toMatchObject({ answerIndex: 'withdrawn' }) })
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })).toMatchObject({ outcome: 'withdrawn' })
  expect(h.followup).toHaveBeenCalledTimes(1)
})

it.each([1, 2])('classifies a retry racing tracking dismissal, ordinal=%s', async (ordinal) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  await h.service.admitAnswer(q.decisionId, q.revision, { choiceOrdinal: 1 }, () => Promise.reject(new Error('not dispatched')))
  const current = await h.service.get(q.decisionId)
  const dismissed = h.service.dismiss(q.decisionId, current!.revision)
  const retry = h.service.submit(q.decisionId, current!.revision, q.requestId, { choiceOrdinal: ordinal })
  await dismissed
  expect(await retry).toMatchObject(ordinal === 1 ? { outcome: 'tracking_closed' } : { outcome: 'rejected', reason: 'DECISION_CONFLICT' })
  expect(h.followup).not.toHaveBeenCalled()
})

it('classifies a retry after exact Agent disposal changes its reservation state', async () => {
  const h = await admissionHarness()
  const handle = await h.ctx.agents.create({ sessionId: SessionId('disposed-retry-owner'), meta: { cwd: '/workspace' } })
  const q = await h.service.create({ sessionId: handle.agent.session.id, question: 'Which database?', choices: ['A', 'B'] })
  await h.service.admitAnswer(q.decisionId, q.revision, { choiceOrdinal: 1 }, () => Promise.reject(new Error('not dispatched')))
  const current = await h.service.get(q.decisionId)
  let retry: ReturnType<typeof h.service.submit> | undefined
  h.ctx.on('agent/disposed', ({ agent }) => {
    if (agent === handle.agent) retry = h.service.submit(q.decisionId, current!.revision, q.requestId, { choiceOrdinal: 1 })
  })
  await handle.dispose()
  expect(await retry).toMatchObject({ outcome: 'reconciliation_required' })
})

it('keeps a reserved answer unknown if its Session disappeared before dispatch', async () => {
  const h = await admissionHarness()
  const handle = await h.ctx.agents.create({ sessionId: SessionId('gone-before-dispatch'), meta: { cwd: '/workspace' } })
  const q = await h.service.create({ sessionId: handle.agent.session.id, question: 'Which database?', choices: ['A', 'B'] })
  await handle.dispose()
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'reconciliation_required' })
})

it.each(['session', 'host'] as const)('refuses a late admission response after the %s closes', async (scope) => {
  const h = await admissionHarness({}, { model: new ReplyAdapter() })
  const target = scope === 'session'
    ? await h.ctx.agents.create({ sessionId: SessionId('late-admission-owner'), meta: { cwd: '/workspace' },
      agentOptions: { provider: 'unit', model: 'unit' } }) : undefined
  const sessionId = target?.agent.session.id ?? SESSION
  const q = await h.service.create({ sessionId, question: 'Which database?', choices: ['A', 'B'] })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const prompt = h.ctx.sessionController.prompt.bind(h.ctx.sessionController)
  const latency = vi.spyOn(h.ctx.sessionController, 'prompt').mockImplementationOnce(async (...args) => {
    // Delay only the result of the actual production controller; never synthesize acceptance.
    const result = await prompt(...args)
    entered.resolve(undefined)
    await release.promise
    return result
  })
  const pending = h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })
  const refused = expect(pending).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
  await entered.promise
  if (target !== undefined) await target.dispose()
  else await h.ctx.fiber.dispose()
  release.resolve(undefined)
  await refused
  latency.mockRestore()
})

it('reports acceptance even when retention prunes the settled question before its response returns', async () => {
  const h = await admissionHarness({ closedRetentionMs: 1 }, { hold: false, model: new ReplyAdapter() })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
  const gate = vi.spyOn(h.ctx.sessions, 'flush').mockImplementationOnce(async (...args) => {
    const result = await flush(...args)
    await h.agent.whenIdle()
    await flush(...args)
    await vi.waitFor(async () => { expect(await h.service.get(q.decisionId)).toBeUndefined() })
    return result
  })
  try {
    expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'accepted', revision: 0 })
    expect(h.followup).toHaveBeenCalledTimes(1)
  } finally { gate.mockRestore() }
})

it('does not persist admitted indexing before the matching human entry is durable', async () => {
  vi.useFakeTimers()
  let h: Awaited<ReturnType<typeof admissionHarness>> | undefined
  const release = Promise.withResolvers<undefined>()
  let pending: ReturnType<Awaited<ReturnType<typeof admissionHarness>>['service']['submit']> | undefined
  try {
    h = await admissionHarness({}, { persistent: true, hold: false, model: new ReplyAdapter() })
    await h.ctx.sessions.flush(h.agent.session)
    const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
    const indexed = Promise.withResolvers<undefined>()
    const active = h
    h.ctx.on('domain/changed', (change) => {
      if (change.domain !== decisionsDomain.name || change.key !== q.decisionId) return
      const domain = active.ctx.storageDomain.get(decisionsDomain.name)
      const current = domain?.table('decisions').get(q.decisionId)
      if (current && typeof current === 'object' && 'answerIndex' in current && current.answerIndex === 'admitted') {
        indexed.resolve(undefined)
      }
    })
    const prompt = h.ctx.sessionController.prompt.bind(h.ctx.sessionController)
    vi.spyOn(h.ctx.sessionController, 'prompt').mockImplementationOnce(async (...args) => {
      const result = await prompt(...args)
      await release.promise
      return result
    })
    pending = h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })
    await indexed.promise
    const reader = await h.ctx.sessionPersistence.open(SESSION, 'read')
    try {
      const snapshot = await reader.read()
      expect(snapshot.events.some(event => event.type === 'user/message' && event.data.source.kind === 'user'
        && 'rpcId' in event.data.source && event.data.source.rpcId === q.requestId)).toBe(true)
    } finally { await reader.close() }
  } finally {
    release.resolve(undefined)
    await pending
    await h?.ctx.fiber.dispose()
    vi.useRealTimers()
  }
})


it('does not acknowledge a queued answer when no Session persistence owner participates', async () => {
  const h = await admissionHarness({}, { persistent: false })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'submitting' })
  expect(h.followup).toHaveBeenCalledTimes(1)
})

it.each([new Error('Session entry checkpoint failed'), 'Session entry checkpoint failed'])
('disables answer indexing after an observed human entry cannot be flushed: %s', async (error) => {
  const h = await admissionHarness({}, { hold: false, model: new ReplyAdapter() })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const flush = vi.spyOn(h.ctx.sessions, 'flush').mockRejectedValue(error)
  try {
    await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })
    await h.agent.whenIdle()
    await vi.waitFor(async () => { expect(await h.service.status()).toMatchObject({ available: false }) })
    const domain = h.ctx.storageDomain.get(decisionsDomain.name)
    expect(domain?.table('decisions').get(q.decisionId)).toMatchObject({ answerIndex: 'submitting' })
    expect(h.followup).toHaveBeenCalledTimes(1)
  } finally { flush.mockRestore() }
})

it('disables observed entry indexing without a participating Session writer', async () => {
  const h = await admissionHarness({}, { persistent: false, hold: false, model: new ReplyAdapter() })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })
  await h.agent.whenIdle()
  await vi.waitFor(async () => { expect(await h.service.status()).toMatchObject({ available: false }) })
})

it('keeps a prompt rejection uncertain while the inbox projection cannot be observed', async () => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  h.followup.mockImplementationOnce(() => { throw new Error('prompt refused') })
  const state = h.ctx.sessionProjections.stateOf.bind(h.ctx.sessionProjections)
  const projection = vi.spyOn(h.ctx.sessionProjections, 'stateOf').mockImplementation((session, name) => {
    return name === 'inbox' ? undefined : state(session, name)
  })
  try {
    expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'submitting' })
  } finally { projection.mockRestore() }
})


it.each([new Error('prompt transport closed'), 'prompt transport closed'])('classifies a controller rejection without replaying: %s', async (error) => {
  const h = await admissionHarness()
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const prompt = h.ctx.sessionController.prompt.bind(h.ctx.sessionController)
  h.followup.mockImplementationOnce(() => { throw new Error('Agent queue refused') })
  const latency = vi.spyOn(h.ctx.sessionController, 'prompt').mockImplementationOnce(async (...args) => {
    try { return await prompt(...args) } catch (rejection) {
      expect(rejection).toBeInstanceOf(Error)
      throw error
    }
  })
  try {
    expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required' })
    expect(h.followup).toHaveBeenCalledTimes(1)
  } finally { latency.mockRestore() }
})

it('ignores a fact whose aggregate disappeared at the durable read seam', async () => {
  const h = await admissionHarness({}, { hold: false, model: new ReplyAdapter() })
  const q = await h.service.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'] })
  const domain = h.ctx.storageDomain.get(decisionsDomain.name)
  if (domain === undefined) throw new Error('question domain unavailable')
  const table = domain.table('decisions')
  let restoreMissing: (() => void) | undefined
  const dispose = h.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message') {
      const missing = vi.spyOn(table, 'get').mockReturnValueOnce(undefined)
      restoreMissing = () => { missing.mockRestore() }
    }
  }, { prepend: true })
  try {
    await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })
    await h.agent.whenIdle()
    expect(await h.service.status()).toMatchObject({ available: true })
    expect(h.followup).toHaveBeenCalledTimes(1)
  } finally { dispose(); restoreMissing?.() }
})
