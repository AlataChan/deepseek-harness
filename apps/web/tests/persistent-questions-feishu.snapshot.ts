/** Synthetic Feishu SDK channel over real Host questions, Session admission and durable receipts. */
import { TenantReceiptStorage,createImPromptSource } from '@deepseek-ai/dsh-experimental-im-feishu'
import { OwnedCardChannel } from '@deepseek-ai/dsh-experimental-im-feishu/card-channel'
import type { NormalizedFeishuCardAction } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import { CardConsumers,createDesktopImRuntime,parseCardGeneration } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import { FeishuQuestions,decisionReceiptDomain,publicationSchema } from '@deepseek-ai/dsh-experimental-session-decisions/feishu'
import type { JsonValue } from '@deepseek-ai/dsh-experimental-session-decisions/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { chmod, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect,it,vi } from 'vitest'
import {
  Golden,
  MODEL, PROVIDER,
  createQuestionSession,
  copyRoot,
  durableWorld,
  enteredUserSources,
  enteredUserTexts,
  installAdapter,
  launchQuestions,
  promptSession,
  remoteGet,remoteSubmit,
  settleSession,soleDecision,
  textChunks,
  toolCallChunks,
} from './persistent-questions.fixture.ts'
import { compareOrRefreshGolden,readPersistedEvents } from './scaffold.ts'

async function cardWorld(failSend = false) {
  const { home, roots } = await durableWorld()
  const scaffold = await launchQuestions(roots)
  const adapter = await installAdapter(scaffold, [toolCallChunks([{ id: 'ask-feishu', name: 'request_persistent_question',
    args: { question: 'Which deployment region?', choices: ['/production', 'Keep staging'] } }]), textChunks('Your answer is recorded.')])
  const sessionId = await createQuestionSession(scaffold)
  await promptSession(scaffold, sessionId, 'Ask me which region to use.')
  const view = await soleDecision(scaffold, sessionId)
  const binding = { appId: 'synthetic-app', tenantId: 'synthetic-tenant', chatId: 'synthetic-chat',
    operatorId: 'synthetic-operator', workspace: roots.workspaceCwd,
    generation: parseCardGeneration('0ee74218-9270-46b8-ae48-38009b8f46b1') }
  const consumers = new CardConsumers()
  const cards: Readonly<Record<string, JsonValue>>[] = []
  const send = vi.fn(async (card: Readonly<Record<string, JsonValue>>) => {
    cards.push(card)
    if (failSend) throw new Error('synthetic acknowledgment lost')
    return { messageId: 'synthetic-platform-message' }
  })
  const channel = new OwnedCardChannel(binding, consumers, send, 32_768)
  let online = true
  const owner = { cardChannel: () => online ? channel : undefined,
    registerCardConsumer: consumers.register.bind(consumers) }
  const domain = await scaffold.ctx.storageDomain.open(decisionReceiptDomain)
  const receipts = new TenantReceiptStorage(domain)
  const feature = new FeishuQuestions(scaffold.ctx, scaffold.ctx.sessionDecisions, owner, receipts, 100_000)
  await feature.publish(view.decisionId)
  const publication = publicationSchema.parse(await scaffold.ctx.sessionDecisions.notification(view.decisionId))
  const click = (overrides: Partial<NormalizedFeishuCardAction> = {}): NormalizedFeishuCardAction => ({
    provider: 'feishu', appId: binding.appId, tenantKey: binding.tenantId, chatId: binding.chatId,
    operatorId: binding.operatorId, openId: binding.operatorId, openMessageId: 'synthetic-platform-message',
    actionTag: 'button', token: 'synthetic-sdk-token-never-persisted',
    actionValue: { kind: 'session-question', publicationId: publication.publicationId,
      decisionId: view.decisionId, revision: view.revision, choiceOrdinal: 1 }, ...overrides,
  })
  return { scaffold, roots, adapter, sessionId, view, channel, cards, send, feature, receipts, publication, click,
    revoke: () => { online = false },
    async close() {
      await feature.close()
      await channel.close()
      await domain.close()
      await scaffold.close()
      await rm(home, { recursive: true, force: true })
    },
  }
}

it('publishes one card and admits its verified answer to the real asking Session exactly once', async () => {
  const f = await cardWorld()
  try {
    expect(f.send).toHaveBeenCalledTimes(1)
    await f.feature.publish(f.view.decisionId)
    expect(f.send).toHaveBeenCalledTimes(1)
    expect((await remoteGet(f.scaffold, f.view.decisionId))?.revision).toBe(f.view.revision)
    const result = await f.channel.handleCardAction(f.click())
    expect(result.success).toBe(true)
    await settleSession(f.scaffold, f.sessionId)
    const duplicate = await f.channel.handleCardAction(f.click())
    expect(duplicate.success).toBe(true)
    const events = await readPersistedEvents(f.scaffold, SessionId(f.sessionId))
    const text = `Answer to question ${f.view.decisionId}: option 1`
    expect(enteredUserTexts(events).filter(value => value === text)).toHaveLength(1)
    expect(enteredUserSources(events)).toContainEqual(createImPromptSource(f.view.requestId))
    expect(f.adapter.calls).toHaveLength(2)
    const raw = await f.scaffold.ctx.sessionDecisions.notification(f.view.decisionId)
    expect(JSON.stringify(raw)).not.toContain('synthetic-sdk-token')
    const golden = new Golden().session(f.sessionId).decision(f.view.decisionId)
    golden.add('notification state', f.publication.state)
    golden.add('card plain question and routing copy', f.cards[0]?.elements)
    golden.add('answer admission', result)
    golden.add('duplicate answer', duplicate)
    golden.add('entered human texts', enteredUserTexts(events))
    golden.add('entered human sources', enteredUserSources(events))
    golden.add('current question', await remoteGet(f.scaffold, f.view.decisionId))
    // Publication UUID is transport correlation, not a model input; map its known identity explicitly.
    const textGolden = golden.render().split(f.publication.publicationId).join('{{publicationId}}')
    await compareOrRefreshGolden(join(import.meta.dirname, '../../../snapshots/web/persistent-questions-feishu/card-answer.expected.md'), textGolden, f.scaffold.mode)
  } finally { await f.close() }
})

it('refuses foreign actors, publications and injected target Session IDs without prompting', async () => {
  const f = await cardWorld()
  try {
    const valid = f.click()
    for (const action of [f.click({ chatId: 'foreign' }), f.click({ operatorId: 'foreign' }),
      f.click({ tenantKey: 'foreign' }), f.click({ appId: 'foreign' }), f.click({ openMessageId: 'foreign' }),
      f.click({ actionValue: { ...valid.actionValue, sessionId: 'foreign-session' } }),
      f.click({ actionValue: { ...valid.actionValue, revision: f.view.revision + 1 } })]) {
      expect((await f.channel.handleCardAction(action)).success).toBe(false)
    }
    expect(f.adapter.calls).toHaveLength(1)
    expect((await remoteGet(f.scaffold, f.view.decisionId))?.answerIndex).toBe('none')
    f.revoke()
    expect((await f.channel.handleCardAction(valid)).success).toBe(false)
  } finally { await f.close() }
})

it.each(['cancel', 'pause'] as const)('returns an inert card after %s without admitting an answer', async (action) => {
  const f = await cardWorld()
  try {
    if (action === 'cancel') await f.scaffold.ctx.sessionDecisions.cancel(f.view.decisionId, f.view.revision)
    else await f.scaffold.ctx.sessionDecisions.pause(f.view.decisionId, f.view.revision, 'user-requested')
    const result = await f.channel.handleCardAction(f.click())
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.card)).not.toContain('choiceOrdinal')
    expect(JSON.stringify(result.card)).toContain('此问题已不可作答')
    expect(f.adapter.calls).toHaveLength(1)
  } finally { await f.close() }
})

it('retains unknown publication acknowledgment without sending a replacement card', async () => {
  const f = await cardWorld(true)
  try {
    expect(f.publication.state).toBe('unknown')
    await f.feature.publish(f.view.decisionId)
    expect(f.send).toHaveBeenCalledTimes(1)
    expect((await f.channel.handleCardAction(f.click())).success).toBe(false)
    expect(f.adapter.calls).toHaveLength(1)
  } finally { await f.close() }
})

it('keeps a reservation with a failed receipt write unresolved and never prompts on a duplicate', async () => {
  const f = await cardWorld()
  try {
    const receipt = vi.spyOn(f.receipts, 'recordAdmitting').mockRejectedValueOnce(new Error('synthetic receipt write failed'))
    expect((await f.channel.handleCardAction(f.click())).success).toBe(false)
    expect((await f.channel.handleCardAction(f.click())).success).toBe(false)
    expect(receipt).toHaveBeenCalledTimes(1)
    expect(f.adapter.calls).toHaveLength(1)
    expect((await remoteGet(f.scaffold, f.view.decisionId))?.answerIndex).toBe('submitting')
  } finally { await f.close() }
})

it('serializes a desktop-versus-card race through the same answer reservation', async () => {
  const f = await cardWorld()
  try {
    const answers = await Promise.allSettled([
      remoteSubmit(f.scaffold, f.view.decisionId, f.view.revision, f.view.requestId, { choiceOrdinal: 2 }),
      f.channel.handleCardAction(f.click()),
    ])
    expect(answers.every(result => result.status === 'fulfilled')).toBe(true)
    await settleSession(f.scaffold, f.sessionId)
    const events = await readPersistedEvents(f.scaffold, SessionId(f.sessionId))
    expect(enteredUserTexts(events).filter(text => text.startsWith(`Answer to question ${f.view.decisionId}:`))).toHaveLength(1)
    expect(f.adapter.calls).toHaveLength(2)
  } finally { await f.close() }
})

it('loads the real optional desktop IM consumer and retains desktop answering while IM is disabled', async () => {
  const { home, roots } = await durableWorld()
  const scaffold = await launchQuestions(roots, { withFeishu: true })
  try {
    await installAdapter(scaffold, [toolCallChunks([{ id: 'ask-offline', name: 'request_persistent_question',
      args: { question: 'Proceed while IM is disabled?', choices: ['Proceed', 'Wait'] } }]), textChunks('Desktop answer received.')])
    expect(scaffold.ctx.desktopIm.cardChannel()).toBeUndefined()
    expect(() => scaffold.ctx.desktopIm.registerCardConsumer('session-question', async () => ({ success: true })))
      .toThrow('already registered')
    const sessionId = await createQuestionSession(scaffold)
    await promptSession(scaffold, sessionId, 'Ask a question without connecting to Feishu.')
    const view = await soleDecision(scaffold, sessionId)
    expect(view.notificationStatus).toBeUndefined()
    const outcome = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 1 })
    expect(outcome.outcome).toBe('accepted')
    await settleSession(scaffold, sessionId)
    expect(enteredUserTexts(await readPersistedEvents(scaffold, SessionId(sessionId))))
      .toContain(`Answer to question ${view.decisionId}: option 1`)
  } finally {
    await scaffold.close()
    await rm(home, { recursive: true, force: true })
  }
})


it('answers a cold asking Session after restart through the real Host controller', async () => {
  const f = await cardWorld()
  const recovered = await durableWorld()
  try {
    await f.scaffold.ctx.sessions.flush(f.scaffold.ctx.agents.get(SessionId(f.sessionId))!.session)
    await copyRoot(f.roots.persistenceRoot, recovered.roots.persistenceRoot)
    await copyRoot(f.roots.storageRoot, recovered.roots.storageRoot)
    const scaffold = await launchQuestions({ ...recovered.roots, workspaceCwd: f.roots.workspaceCwd })
    try {
      const adapter = await installAdapter(scaffold, [textChunks('The answer after restart is recorded.')])
      expect(scaffold.ctx.agents.get(SessionId(f.sessionId))).toBeUndefined()
      const consumers = new CardConsumers()
      const send = vi.fn(async () => ({ messageId: 'unexpected-republication' }))
      const channel = new OwnedCardChannel(f.channel.binding, consumers, send, 32_768)
      const domain = await scaffold.ctx.storageDomain.open(decisionReceiptDomain)
      const feature = new FeishuQuestions(scaffold.ctx, scaffold.ctx.sessionDecisions, {
        cardChannel: () => channel, registerCardConsumer: consumers.register.bind(consumers),
      }, new TenantReceiptStorage(domain), 100_000)
      try {
        await feature.publish(f.view.decisionId)
        expect(send).not.toHaveBeenCalled()
        const result = await channel.handleCardAction(f.click())
        expect(result.success).toBe(true)
        await settleSession(scaffold, f.sessionId)
        expect((await channel.handleCardAction(f.click())).success).toBe(true)
        const events = await readPersistedEvents(scaffold, SessionId(f.sessionId))
        expect(enteredUserTexts(events).filter(text => text.startsWith('Answer to question'))).toHaveLength(1)
        expect(adapter.calls).toHaveLength(1)
        const golden = new Golden().session(f.sessionId).decision(f.view.decisionId)
        golden.add('cold answer', result)
        golden.add('entered human texts', enteredUserTexts(events))
        golden.add('current question', await remoteGet(scaffold, f.view.decisionId))
        await compareOrRefreshGolden(join(import.meta.dirname,
          '../../../snapshots/web/persistent-questions-feishu/cold-answer.expected.md'),
        golden.render().split(f.publication.publicationId).join('{{publicationId}}'), scaffold.mode)
      } finally { await feature.close(); await channel.close(); await domain.close() }
    } finally { await scaffold.close() }
  } finally { await f.close(); await rm(recovered.home, { recursive: true, force: true }) }
})


it('logs nullable-identity ordinary IM text in its own real Host Session without answering a pending question', async () => {
  const world = await durableWorld()
  const roots = { ...world.roots, workspaceCwd: await realpath(world.roots.workspaceCwd) }
  await chmod(roots.workspaceCwd, 0o700)
  const scaffold = await launchQuestions(roots)
  let runtime: Awaited<ReturnType<typeof createDesktopImRuntime>> | undefined
  try {
    const adapter = await installAdapter(scaffold, [toolCallChunks([{ id: 'ask-before-im',
      name: 'request_persistent_question', args: { question: 'Which deployment region?', choices: ['A', 'B'] } }]),
    textChunks('The separate IM conversation received your text.')])
    const asking = await createQuestionSession(scaffold)
    await promptSession(scaffold, asking, 'Ask a question before ordinary IM text arrives.')
    const view = await soleDecision(scaffold, asking)
    let connected = false
    let receive: ((data: unknown) => Promise<unknown>) | undefined
    const sent: string[] = []
    runtime = await createDesktopImRuntime(scaffold.ctx, {
      provider: 'feishu', appId: 'app', appSecret: 'synthetic', tenantId: 'tenant', chatId: 'chat', senderId: 'operator',
      cwd: roots.workspaceCwd, modelSelection: { provider: PROVIDER, model: MODEL }, stateDirectory: join(world.home, 'im-state'),
      dispatchIntervalMs: 10, shutdownTimeoutMs: 5000, maxReconciliationEvents: 1000,
      ingress: { maxStoredDeliveries: 100, maxPendingAdmissions: 10, maxPromptBytes: 32768, maxReplyBytes: 32768,
        maxEventAgeMs: 300000, maxFutureSkewMs: 30000, maxOutboxAttempts: 3 },
    }, () => { throw new Error('Unexpected IM dispatcher failure') }, { feishu: {
      clientFactory: {
        createWSClient: () => ({ async start() { connected = true }, close() { connected = false },
          getConnectionStatus: () => ({ state: connected ? 'connected' : 'idle' }) }),
        createEventDispatcher: () => ({ register(handlers) { receive = handlers['im.message.receive_v1']; return this },
          invoke(data) { if (!receive) throw new Error('Missing real transport handler'); return receive(data) } }),
      },
      fetchFn: async (url, init) => {
        if (String(url).includes('tenant_access_token')) return new Response(JSON.stringify({ code: 0, msg: 'ok',
          tenant_access_token: 'synthetic-token', expire: 3600 }))
        if (typeof init?.body !== 'string') throw new Error('Missing outgoing IM body')
        sent.push(init.body)
        return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { message_id: 'synthetic-reply' } }))
      },
    } })
    await runtime.start()
    if (!receive) throw new Error('Transport did not register its SDK handler')
    const text = 'Ordinary IM text with unavailable secondary IDs.'
    await receive({ schema: '2.0', event_id: 'event-null-ids', event_type: 'im.message.receive_v1',
      create_time: String(Date.now()), app_id: 'app', tenant_key: 'tenant', token: '',
      sender: { sender_type: 'user', sender_id: { open_id: 'operator', user_id: null, union_id: null } },
      message: { message_id: 'message-null-ids', chat_id: 'chat', chat_type: 'p2p', message_type: 'text',
        create_time: String(Date.now()), content: JSON.stringify({ text }) } })
    await vi.waitFor(() => { expect(sent).toHaveLength(1) }, { timeout: 5000, interval: 20 })
    const imAgents = scaffold.ctx.agents.list().filter(agent => agent.session.id !== asking)
    expect(imAgents).toHaveLength(1)
    const imId = imAgents[0]!.session.id
    await settleSession(scaffold, imId)
    const imEvents = await readPersistedEvents(scaffold, imId)
    const askingEvents = await readPersistedEvents(scaffold, SessionId(asking))
    expect(enteredUserTexts(imEvents)).toEqual([text])
    expect(enteredUserTexts(askingEvents)).not.toContain(text)
    expect(await remoteGet(scaffold, view.decisionId)).toMatchObject({ lifecycle: 'open', answerIndex: 'none' })
    expect(adapter.calls).toHaveLength(2)
    const golden = new Golden().session(asking).session(imId).decision(view.decisionId)
    golden.add('ordinary IM text enters its own persisted Session', enteredUserTexts(imEvents))
    golden.add('ordinary IM source is authenticated human', enteredUserSources(imEvents).map(source => source.kind))
    golden.add('asking Session is unchanged', enteredUserTexts(askingEvents))
    golden.add('pending question remains unanswered', await remoteGet(scaffold, view.decisionId))
    golden.add('one outgoing IM reply', sent.length)
    golden.add('scripted model calls', adapter.calls.length)
    await compareOrRefreshGolden(join(import.meta.dirname,
      '../../../snapshots/web/persistent-questions-feishu/nullable-identity-im.expected.md'), golden.render(), scaffold.mode)
  } finally {
    await runtime?.close()
    await scaffold.close()
    await rm(world.home, { recursive: true, force: true })
  }
})
