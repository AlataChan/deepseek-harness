import { describe, expect, it, vi } from 'vitest'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness } from './harness.ts'

describe('Auxiliary review lifetime', () => {
  for (const stop of ['timeout', 'new-turn', 'dispose'] as const) {
    it(`aborts pending review on ${stop} without saving stale facts`, async () => {
      const h = await setupAssistantHarness([], { enableMemoryReview: true, reviewTimeoutMs: stop === 'timeout' ? 200 : 10000 })
      const profile = await h.assistants.createProfile({ name: 'Review lifetime', responsibility: 'Remember preferences' })
      let release!: () => void
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const entered = Promise.withResolvers<undefined>()
      let captured: AbortSignal | undefined
      const original = h.adapter.stream.bind(h.adapter)
      vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
        captured = options.signal
        entered.resolve(undefined)
        await barrier
        yield { type: 'finish', reason: { kind: 'stop' } }
      })
      // Freeze only the owned deadline while the durable request checkpoint uses real IO.
      if (stop === 'timeout') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const review = h.assistants.reviewTurn({ sessionId: h.lead.id, scope: { profileId: profile.id }, turnSeq: 1,
        trigger: 'manual', turnTexts: ['Remember that the user prefers brief replies'] })
      const settled = Promise.allSettled([review])
      try {
        await entered.promise
        expect(captured).toBeDefined()
        if (stop === 'new-turn') {
          h.adapter.stream = original
          h.lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Start a different turn' }] }))
        }
        if (stop === 'dispose') h.assistants.reviewPredictions.dispose()
        if (stop === 'timeout') {
          expect(captured?.aborted).toBe(false)
          await vi.advanceTimersByTimeAsync(200)
          expect(captured?.aborted).toBe(true)
          vi.useRealTimers()
        } else {
          await vi.waitFor(() => expect(captured?.aborted).toBe(true), { timeout: 1000 })
        }
        release()
        await settled
        expect(await h.assistants.listMemory({ kind: 'profile', profileId: profile.id })).toHaveLength(0)
      } finally { if (stop === 'timeout') vi.useRealTimers(); release(); await settled; await h.dispose(); vi.restoreAllMocks() }
    })
  }
})
