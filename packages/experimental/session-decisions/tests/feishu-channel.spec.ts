/** Feishu publication and authentication over real question storage and Session admission. */
import { CardConsumers,CardPublishRefusal,OwnedCardChannel,parseCardGeneration } from '@deepseek-ai/dsh-experimental-im-feishu/card-channel'
import type { CardChannel,CardChannelBinding,NormalizedFeishuCardAction } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import { TenantReceiptStorage } from '@deepseek-ai/dsh-experimental-im-feishu'
import { randomUUID } from 'node:crypto'
import { describe,expect,it,vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { FeishuQuestions, decisionReceiptDomain, publicationSchema } from '../src/feishu/index.ts'
import { admissionHarness,ReplyAdapter,SESSION } from './admission-world.ts'

async function world(config: { closedRetentionMs?: number } = {}) {
  const consumers = new CardConsumers()
  const binding: CardChannelBinding = { appId: 'app', tenantId: 'tenant', chatId: 'chat', operatorId: 'operator', workspace: '/workspace', generation: parseCardGeneration(randomUUID()) }
  const send = vi.fn(async () => ({ messageId: 'published-message' }))
  const owned = new OwnedCardChannel(binding, consumers, send, 100_000)
  let live: CardChannel | undefined = owned
  const model = new ReplyAdapter()
  const h = await admissionHarness({ feishuEnabled: true, ...config }, { persistent: true, model, beforeService(ctx) {
    ctx.provide('desktopIm', { cardChannel: () => live, registerCardConsumer: consumers.register.bind(consumers) } as never)
  } })
  async function question(sessionId = SESSION) {
    return h.service.create({ sessionId, question: 'Select database', choices: ['SQLite', 'Postgres'] })
  }
  async function published(sessionId = SESSION) {
    const q = await question(sessionId)
    await h.service.notifyQuestion(q.decisionId)
    const p = publicationSchema.parse(await h.service.notification(q.decisionId))
    const action: NormalizedFeishuCardAction = { provider: 'feishu', appId: binding.appId, tenantKey: binding.tenantId,
      chatId: binding.chatId, operatorId: binding.operatorId, openId: binding.operatorId, openMessageId: 'published-message',
      actionTag: 'button', token: 'opaque-callback-token', actionValue: { kind: 'session-question', publicationId: p.publicationId,
        decisionId: q.decisionId, revision: q.revision, choiceOrdinal: 1 } }
    return { q, p, action }
  }
  return { ...h, model, binding, consumers, owned, send, question, published,
    setChannel(channel: CardChannel | undefined) { live = channel } }
}

describe('Feishu question publication and admission', () => {
  it('claims one publication during concurrent notifications without changing the question revision', async () => {
    const h = await world()
    const q = await h.question()
    await Promise.all([h.service.notifyQuestion(q.decisionId), h.service.notifyQuestion(q.decisionId)])
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(await h.service.get(q.decisionId)).toMatchObject({ revision: q.revision, notificationStatus: 'sent' })
    const publication = publicationSchema.parse(await h.service.notification(q.decisionId))
    expect(publication).toMatchObject({ state: 'sent', messageId: 'published-message' })
  })

  it.each(['unavailable', 'workspace', 'single-choice', 'cancelled', 'paused'] as const)('does not publish an ineligible question: %s', async (reason) => {
    const h = await world()
    const q = await h.service.create({ sessionId: SESSION, question: 'Select database', choices: reason === 'single-choice' ? ['SQLite'] : ['SQLite', 'Postgres'] })
    if (reason === 'unavailable') h.setChannel(undefined)
    if (reason === 'workspace') h.setChannel({ binding: { ...h.binding, workspace: '/elsewhere' }, publish: h.send })
    if (reason === 'cancelled') await h.service.cancel(q.decisionId, q.revision)
    if (reason === 'paused') await h.service.pause(q.decisionId, q.revision, 'user-requested')
    await h.service.notifyQuestion(q.decisionId)
    expect(h.send).not.toHaveBeenCalled()
    expect(await h.service.notification(q.decisionId)).toBeUndefined()
  })

  it.each([false, true])('retains a failed send without replay, local refusal=%s', async (local) => {
    const h = await world()
    h.send.mockRejectedValueOnce(local ? new CardPublishRefusal('too large') : new Error('lost acknowledgement'))
    const q = await h.question()
    await h.service.notifyQuestion(q.decisionId)
    await h.service.notifyQuestion(q.decisionId)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(publicationSchema.parse(await h.service.notification(q.decisionId)).state).toBe(local ? 'failed' : 'unknown')
  })

  it('uses the production queued prompt path once and returns an inert replacement card', async () => {
    const h = await world()
    const { action, q } = await h.published()
    const answer = await h.owned.handleCardAction(action)
    expect(answer.success).toBe(true)
    expect(JSON.stringify(answer.card)).not.toContain('"tag":"button"')
    expect(h.followup).toHaveBeenCalledTimes(1)
    expect(h.followup.mock.calls[0]![0].source).toMatchObject({ kind: 'user' })
    expect(await h.service.get(q.decisionId)).toMatchObject({ answerIndex: 'submitting' })
    expect((await h.owned.handleCardAction(action)).success).toBe(false)
    expect(h.followup).toHaveBeenCalledTimes(1)
  })

  it.each(['appId', 'tenantKey', 'chatId', 'operatorId', 'openMessageId'] as const)('rejects a foreign callback %s inside the consumer', async (field) => {
    const h = await world()
    const { action } = await h.published()
    expect((await h.consumers.dispatch({ ...action, [field]: 'foreign' }, h.binding)).success).toBe(false)
    expect(h.followup).not.toHaveBeenCalled()
  })

  it.each(['revision', 'publicationId', 'decisionId', 'choiceOrdinal', 'sessionId'] as const)('rejects a forged callback value %s', async (field) => {
    const h = await world()
    const { action } = await h.published()
    const value = field === 'revision' ? 100 : field === 'choiceOrdinal' ? 99 : field === 'sessionId' ? 'other-session' : randomUUID()
    const result = await h.consumers.dispatch({ ...action, actionValue: { ...action.actionValue, [field]: value } }, h.binding)
    expect(result.success).toBe(false)
    expect(h.followup).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'pause', 'revoked'] as const)('refuses callbacks after %s', async (state) => {
    const h = await world()
    const { action, q } = await h.published()
    if (state === 'cancel') await h.service.cancel(q.decisionId, q.revision)
    if (state === 'pause') await h.service.pause(q.decisionId, q.revision, 'user-requested')
    if (state === 'revoked') h.setChannel(undefined)
    const result = await h.consumers.dispatch(action, h.binding)
    expect(result.success).toBe(false)
    if (state !== 'revoked') expect(JSON.stringify(result.card)).not.toContain('"tag":"button"')
    expect(h.followup).not.toHaveBeenCalled()
  })
})


it('fences a channel revoked after its durable publication claim', async () => {
  const h = await world()
  const original = h.service.writeNotification.bind(h.service)
  vi.spyOn(h.service, 'writeNotification').mockImplementation(async (...args) => {
    const saved = await original(...args)
    if (saved && args[1] === undefined) h.setChannel(undefined)
    return saved
  })
  const q = await h.question()
  await h.service.notifyQuestion(q.decisionId)
  expect(h.send).not.toHaveBeenCalled()
  expect(publicationSchema.parse(await h.service.notification(q.decisionId)).state).toBe('unknown')
})

it.each(['before-receipt', 'after-receipt', 'receipt-failure'] as const)('does not prompt after callback admission loses its channel: %s', async (point) => {
  const h = await world()
  const { action, q } = await h.published()
  if (point === 'before-receipt') {
    const original = h.service.admitAnswer.bind(h.service)
    vi.spyOn(h.service, 'admitAnswer').mockImplementation((...args) => {
      h.setChannel(undefined)
      return original(...args)
    })
  } else {
    const receiptWrite = vi.spyOn(TenantReceiptStorage.prototype, 'recordAdmitting')
    receiptWrite.mockImplementationOnce(async function (this: TenantReceiptStorage, ...args) {
      receiptWrite.mockRestore()
      if (point === 'receipt-failure') throw new Error('receipt disk unavailable')
      const saved = await this.recordAdmitting(...args)
      h.setChannel(undefined)
      return saved
    })
  }
  try {
    expect((await h.consumers.dispatch(action, h.binding)).success).toBe(false)
    expect(h.followup).not.toHaveBeenCalled()
    expect(await h.service.get(q.decisionId)).toMatchObject({ answerIndex: 'submitting' })
    h.setChannel(h.owned)
    expect((await h.consumers.dispatch(action, h.binding)).success).toBe(false)
    expect(h.followup).not.toHaveBeenCalled()
  } finally { vi.restoreAllMocks() }
})


it.each(['desktop', 'card'] as const)('reconciles a real entered answer without a second model call, first admission=%s', async (first) => {
  const h = await world()
  const { action, q } = await h.published()
  if (first === 'card') expect((await h.owned.handleCardAction(action)).success).toBe(true)
  else expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 })).toMatchObject({ outcome: 'accepted' })
  h.releaseMaintenance()
  await h.agent.whenIdle()
  await h.ctx.sessions.flush(h.agent.session)
  await vi.waitFor(async () => { expect(await h.service.get(q.decisionId)).toMatchObject({ answerIndex: 'admitted' }) })
  const marked = vi.spyOn(TenantReceiptStorage.prototype, 'markAdmitted')
  try {
    expect((await h.owned.handleCardAction(action)).success).toBe(true)
    expect(h.model.calls).toBe(1)
    expect(h.followup).toHaveBeenCalledTimes(1)
    expect(marked).toHaveBeenCalledTimes(first === 'card' ? 1 : 0)
  } finally { marked.mockRestore() }
})


it('does not publish after the adapter has closed', async () => {
  const h = await world()
  const q = await h.question()
  const domain = await h.ctx.storageDomain.open({ ...decisionReceiptDomain, name: 'closed_adapter_receipts' })
  const consumers = new CardConsumers()
  const adapter = new FeishuQuestions(h.ctx, h.service, {
    cardChannel: () => h.owned, registerCardConsumer: consumers.register.bind(consumers),
  }, new TenantReceiptStorage(domain), 1000)
  try {
    await adapter.close()
    await adapter.publish(q.decisionId)
    expect(h.send).not.toHaveBeenCalled()
  } finally { await adapter.close(); await domain.close() }
})

it('authenticates the saved root header of a cold paused asking Session', async () => {
  const h = await world()
  const id = SessionId(randomUUID())
  const handle = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/workspace' },
    agentOptions: { provider: 'unit', model: 'unit' } })
  handle.agent.session.append('model/selection', { provider: 'unit', model: 'unit' })
  await h.ctx.sessions.flush(handle.agent.session)
  const { action, q } = await h.published(id)
  await h.service.pause(q.decisionId, q.revision, 'user-requested')
  await handle.dispose()
  expect(h.ctx.agents.get(id)).toBeUndefined()
  const result = await h.owned.handleCardAction(action)
  expect(result.success).toBe(false)
  expect(result.card).toBeDefined()
  expect(h.model.calls).toBe(0)
})

it('allows a retained answer to settle when the question is pruned during callback delivery', async () => {
  const h = await world({ closedRetentionMs: 1 })
  const { action, q } = await h.published()
  const original = h.service.admitAnswer.bind(h.service)
  vi.spyOn(h.service, 'admitAnswer').mockImplementation(async (...args) => {
    const outcome = await original(...args)
    h.releaseMaintenance()
    await h.agent.whenIdle()
    await h.ctx.sessions.flush(h.agent.session)
    await vi.waitFor(async () => { expect(await h.service.get(q.decisionId)).toBeUndefined() })
    return outcome
  })
  const result = await h.owned.handleCardAction(action)
  expect(result.success).toBe(true)
  expect(result.card).toBeUndefined()
  expect(h.model.calls).toBe(1)
  expect(h.followup).toHaveBeenCalledTimes(1)
})

it('drains an admitted card callback before closing its receipt domain', async () => {
  const h = await world()
  const { action, q } = await h.published()
  const domain = h.ctx.storageDomain.get(decisionReceiptDomain.name)
  if (domain === undefined) throw new Error('receipt domain unavailable')
  const table = domain.table('receipts')
  const put = table.put.bind(table)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  vi.spyOn(table, 'put').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return put(...args)
  })
  const close = vi.spyOn(domain, 'close')
  const cancel = vi.spyOn(h.agent, 'cancel')
  const callback = h.owned.handleCardAction(action)
  await entered.promise
  const closing = h.closeFeature()
  try {
    await vi.waitFor(async () => {
      expect(await h.service.submit(q.decisionId, q.revision, q.requestId, { choiceOrdinal: 1 }))
        .toMatchObject({ outcome: 'rejected', reason: 'DECISION_UNAVAILABLE' })
    })
    expect(close).not.toHaveBeenCalled()
  } finally {
    release.resolve(undefined)
    await callback
    await closing
  }
  expect(close).toHaveBeenCalledTimes(1)
  expect(h.followup).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(h.ctx.agents.get(SESSION)).toBe(h.agent)
  cancel.mockRestore()
})


it('leaves the desktop question answerable when its publication claim cannot be stored', async () => {
  const h = await world()
  const q = await h.question()
  const domain = h.ctx.storageDomain.get('session_decisions')
  if (domain === undefined) throw new Error('question domain unavailable')
  vi.spyOn(domain.table('decisions'), 'update').mockRejectedValueOnce(new Error('publication storage unavailable'))
  await h.service.notifyQuestion(q.decisionId)
  expect(await h.service.get(q.decisionId)).toMatchObject({ lifecycle: 'open', answerIndex: 'none' })
  expect(h.send).not.toHaveBeenCalled()
})

it('attempts both domain closes and reports failures after callback intake has stopped', async () => {
  const h = await world()
  const questionDomain = h.ctx.storageDomain.get('session_decisions')
  const receiptDomain = h.ctx.storageDomain.get(decisionReceiptDomain.name)
  if (questionDomain === undefined || receiptDomain === undefined) throw new Error('question domains unavailable')
  const closeQuestion = questionDomain.close.bind(questionDomain)
  vi.spyOn(questionDomain, 'close').mockImplementationOnce(async () => {
    await closeQuestion()
    throw new Error('question close reported an I/O error')
  })
  const closeReceipt = vi.spyOn(receiptDomain, 'close')
  await h.closeFeature()
  expect(closeReceipt).toHaveBeenCalledTimes(1)
  expect(await h.service.status()).toMatchObject({ available: false })
})
