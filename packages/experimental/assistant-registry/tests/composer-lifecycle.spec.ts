/** Prediction lifecycle, durable replay, and bounded source-context regressions. */
import { rmSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
async function complete(h: Awaited<ReturnType<typeof setupAssistantHarness>>) {
  await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue', requestId: 'lifecycle-turn' as never,
    content: [{ type: 'text', text: 'Complete the report' }] }, new AbortController().signal)
  await h.lead.whenIdle()
  return h.ctx.sessions.get(h.lead.id)!.snapshotEvents().findLast(e => e.type === 'turn/end')!.seq
}
describe('Composer prediction lifecycle', () => {
  it('returns an eligible completed result to a later subscriber without another inference', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    try {
      const seq = await complete(h)
      const request = { sessionId: h.lead.id, asOfSeq: seq, draftText: '' }
      const first = await h.assistants.predictComposer(request)
      expect(first).not.toBeNull()
      const loggedRequest = h.ctx.sessions.get(h.lead.id)!.snapshotEvents().find(event =>
        event.type === 'assistant/auxiliary' && event.data.phase === 'request')
      expect(loggedRequest?.type).toBe('assistant/auxiliary')
      if (loggedRequest?.type === 'assistant/auxiliary' && loggedRequest.data.phase === 'request') {
        expect(loggedRequest.data.messages.map(({ role, source, content }) => ({ role, source, content }))).toMatchSnapshot()
      }
      const before = h.adapter.requests.length
      const second = await h.assistants.predictComposer(request)
      expect(second?.predictionId).toBe(first?.predictionId)
      expect(h.adapter.requests.length).toBe(before)
    } finally { await h.dispose() }
  })
  it('rechecks retirement after asynchronous admission', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    let pending: Promise<unknown> | undefined
    let spy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const profile = await h.assistants.createProfile({ name: 'Reviewer', responsibility: 'Review reports' })
      const team = await h.assistants.createTeam({ name: 'Review group', coordinatorProfileId: profile.id })
      const seat = await h.assistants.createSeat({ teamId: team.id, profileId: profile.id, role: 'teammate', name: 'reviewer',
        duty: 'Review' })
      await h.assistants.bindSeatSession(seat.id, h.lead.id)
      const seq = await complete(h)
      const original = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
      spy = vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementationOnce(async (...args) => {
        const observation = await original(...args); entered.resolve(undefined); await release.promise; return observation
      })
      pending = h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })
      await entered.promise
      await h.assistants.retireSeat(seat.id)
      const before = h.adapter.requests.length
      release.resolve(undefined)
      const result = await pending
      expect({ result, calls: h.adapter.requests.length - before }).toEqual({ result: null, calls: 0 })
    } finally { release.resolve(undefined); await pending; spy?.mockRestore(); await h.dispose() }
  })
  it('revalidates eligibility after the inference settles', async () => {
    const h = await setupAssistantHarness(new MockAdapter([textResponse('Completed'), textResponse('Run checks next?')]),
      { enableComposerPredictions: true }, { withCatalog: true })
    try {
      const seq = await complete(h)
      let valid = true
      const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
      const spy = vi.spyOn(h.ctx.sessions, 'flush').mockImplementation(async (session) => {
        const flushed = await flush(session)
        const last = session.snapshotEvents().at(-1)
        if (last?.type === 'assistant/auxiliary' && last.data.phase === 'result') valid = false
        return flushed
      })
      try {
        const result = await h.assistants.reviewPredictions.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '',
          recentTexts: ['User: Review the completed work'] }, undefined, () => ({ provider: 'mock', model: 'mock' }), () => valid)
        expect(valid).toBe(false)
        expect(result).toBeNull()
        const events = h.ctx.sessions.get(h.lead.id)!.snapshotEvents()
        const resultEvent = events.findLast(event => event.type === 'assistant/auxiliary' && event.data.phase === 'result')
        expect(resultEvent?.type === 'assistant/auxiliary' && resultEvent.data.phase === 'result' &&
          resultEvent.data.usage?.totalTokens).toBeGreaterThan(0)
      } finally { spy.mockRestore() }
    } finally { await h.dispose() }
  })
  it.each(['deleted profile', 'missing session', 'changed session identity'] as const)(
    'rejects %s after asynchronous admission without dispatch', async (invalidation) => {
      const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      let pending: Promise<unknown> | undefined
      const restores: (() => void)[] = []
      try {
        const profile = await h.assistants.createProfile({ name: 'Writer', responsibility: 'Write reports' })
        const conversation = await h.assistants.createConversation(profile.id, { rootSessionId: h.lead.id })
        expect(conversation.rootSessionId).toBe(h.lead.id)
        const seq = await complete(h)
        const original = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
        const observer = vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementationOnce(async (...args) => {
          const observation = await original(...args)
          entered.resolve(undefined)
          await release.promise
          return observation
        })
        restores.push(() => observer.mockRestore())
        pending = h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })
        await entered.promise
        if (invalidation === 'deleted profile') {
          await h.assistants.deleteProfile(profile.id, profile.revision)
        } else {
          const sessions = h.ctx.sessions
          const get = sessions.get.bind(sessions)
          const replacement = invalidation === 'changed session identity' ? sessions.create() : undefined
          const lookup = vi.spyOn(sessions, 'get').mockImplementation(id => id === h.lead.id ? replacement : get(id))
          restores.push(() => lookup.mockRestore())
        }
        const calls = h.adapter.requests.length
        release.resolve(undefined)
        expect(await pending).toBeNull()
        expect(h.adapter.requests.length).toBe(calls)
      } finally {
        release.resolve(undefined)
        await pending
        for (const restore of restores.reverse()) restore()
        await h.dispose()
      }
    },
  )

  it('does not replay an already issued request when the successful cache is absent', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    try {
      const seq = await complete(h)
      const request = { sessionId: h.lead.id, asOfSeq: seq, draftText: '' }
      expect(await h.assistants.predictComposer(request)).not.toBeNull()
      h.assistants.reviewPredictions.cancelAllPredictions()
      const before = h.adapter.requests.length
      expect(await h.assistants.predictComposer(request)).toBeNull()
      expect(h.adapter.requests.length).toBe(before)
    } finally { await h.dispose() }
  })

  it('revalidates eligibility after the durable request checkpoint before provider dispatch', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    let spy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const seq = await complete(h)
      let eligible = true
      const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
      spy = vi.spyOn(h.ctx.sessions, 'flush').mockImplementation(async (session) => {
        const flushed = await flush(session)
        const last = session.snapshotEvents().at(-1)
        if (last?.type === 'assistant/auxiliary' && last.data.phase === 'request') eligible = false
        return flushed
      })
      const before = h.adapter.requests.length
      expect(await h.assistants.reviewPredictions.predictComposer(
        { sessionId: h.lead.id, asOfSeq: seq, draftText: '', recentTexts: ['User: Review the report'] },
        undefined, () => ({ provider: 'mock', model: 'mock' }), () => eligible,
      )).toBeNull()
      expect(eligible).toBe(false)
      expect(h.adapter.requests.length).toBe(before)
    } finally { spy?.mockRestore(); await h.dispose() }
  })

  it('bounds context before reading later text blocks and honors larger configured allowances', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true, predictionContextMaxBytes: 8192 },
      { withCatalog: true })
    let spy: ReturnType<typeof vi.spyOn> | undefined
    try {
      await complete(h)
      const observe = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
      let unreadBlocks = 0
      spy = vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementationOnce(async (...args) => {
        const observation = await observe(...args)
        const events = observation.events.map((event) => {
          if (event.type !== 'user/message') return event
          return {
            ...event, data: {
              ...event.data, content: [
                { type: 'text' as const, text: '中文\n"\\'.repeat(200_000) },
                { type: 'text' as const, get text(): string { unreadBlocks++; throw new Error('Read beyond allocated context') } },
              ],
            },
          }
        })
        return { ...observation, events }
      })
      const context = await h.assistants.getComposerContext(h.lead.id)
      expect(context).not.toBeNull()
      expect(unreadBlocks).toBe(0)
      expect(Buffer.byteLength(JSON.stringify(context), 'utf8')).toBeLessThanOrEqual(8192)
      expect(Buffer.byteLength(context!.recentTexts[0]!, 'utf8')).toBeGreaterThan(1024)
      expect(context!.recentTexts.join('')).not.toContain('\uFFFD')
    } finally { spy?.mockRestore(); await h.dispose() }
  })

  it('keeps billed evidence while rejecting a seat retired during inference settlement', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    let spy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const profile = await h.assistants.createProfile({ name: 'Reviewer', responsibility: 'Review reports' })
      const team = await h.assistants.createTeam({ name: 'Review group', coordinatorProfileId: profile.id })
      const seat = await h.assistants.createSeat({ teamId: team.id, profileId: profile.id, role: 'teammate', name: 'reviewer',
        duty: 'Review' })
      await h.assistants.bindSeatSession(seat.id, h.lead.id)
      const seq = await complete(h)
      const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
      spy = vi.spyOn(h.ctx.sessions, 'flush').mockImplementation(async (session) => {
        const flushed = await flush(session)
        const last = session.snapshotEvents().at(-1)
        if (last?.type === 'assistant/auxiliary' && last.data.phase === 'result') await h.assistants.retireSeat(seat.id)
        return flushed
      })
      const before = h.adapter.requests.length
      expect(await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })).toBeNull()
      expect(h.adapter.requests.length).toBe(before + 1)
      const event = h.ctx.sessions.get(h.lead.id)!.snapshotEvents().findLast(event => event.type === 'assistant/auxiliary')
      expect(event?.type === 'assistant/auxiliary' && event.data.phase === 'result' && event.data.usage?.totalTokens).toBeGreaterThan(0)
      const summaries = await h.assistants.aggregateUsage({ sessionBindings: [{ sessionId: h.lead.id, bindingId: 'reviewer',
        startBoundarySeq: 0 }] })
      expect(summaries.some(summary => summary.auxiliaryTokens.totalTokens > 0)).toBe(true)
    } finally { spy?.mockRestore(); await h.dispose() }
  })

  it('refuses automatic inference after an incomplete durable request checkpoint', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    let spy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const seq = await complete(h)
      const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
      spy = vi.spyOn(h.ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
        await flush(session)
        throw new Error('Stopped after durable request checkpoint')
      })
      const request = { sessionId: h.lead.id, asOfSeq: seq, draftText: '' }
      const before = h.adapter.requests.length
      await expect(h.assistants.predictComposer(request)).rejects.toThrow('Stopped after durable request checkpoint')
      spy.mockRestore()
      const session = h.ctx.sessions.get(h.lead.id)!
      expect(session.snapshotEvents().some(event => event.type === 'assistant/auxiliary' && event.data.phase === 'request')).toBe(true)
      expect(await h.assistants.predictComposer(request)).toBeNull()
      expect(h.adapter.requests.length).toBe(before)
    } finally { spy?.mockRestore(); await h.dispose() }
  })

  it('does not re-dispatch an uncertain durable prediction after a cold restart', async () => {
    const first = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    let restarted: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    let firstDisposed = false
    let spy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const seq = await complete(first)
      const flush = first.ctx.sessions.flush.bind(first.ctx.sessions)
      spy = vi.spyOn(first.ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
        await flush(session)
        throw new Error('Interrupted after durable request')
      })
      const request = { sessionId: first.lead.id, asOfSeq: seq, draftText: '' }
      await expect(first.assistants.predictComposer(request)).rejects.toThrow('Interrupted after durable request')
      spy.mockRestore()
      await first.dispose(true)
      firstDisposed = true
      restarted = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, {
        withCatalog: true, storageRoot: first.storageRoot, leadSessionId: SessionId('other-live-session'),
      })
      const handle = await restarted.ctx.sessionPersistence.open(first.lead.id, 'read')
      try {
        const read = await handle.read(0)
        restarted.ctx.sessions.create(first.lead.id, { seed: read.events, meta: handle.header })
      } finally { await handle.close() }
      expect(await restarted.assistants.predictComposer(request)).toBeNull()
      expect(restarted.adapter.requests).toHaveLength(0)
    } finally {
      spy?.mockRestore()
      if (!firstDisposed) await first.dispose(true)
      await restarted?.dispose()
      rmSync(first.storageRoot, { recursive: true, force: true })
    }
  })

  it('uses actual user intent and assistant replies without injected runtime context', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
    try {
      h.lead.session.append('user/message', createUserMessage({
        source: { kind: 'runtime-context' },
        content: [{ type: 'text', text: 'Current runtime: /private/test-workspace, clock: 2031-11-12T13:14:15Z' }],
      }), { surfaceOp: 'append' })
      await complete(h)
      const context = await h.assistants.getComposerContext(h.lead.id)
      expect(context?.recentTexts).toEqual(['User: Complete the report', 'Assistant: Real seat response'])
      expect(context?.recentTexts.join('')).not.toContain('/private/test-workspace')
      expect(context?.recentTexts.join('')).not.toContain('2031-11-12')
    } finally { await h.dispose() }
  })

})
