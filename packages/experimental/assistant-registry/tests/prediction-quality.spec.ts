/** Provider latency and execution evidence in next-message suggestions. */
import { describe, expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function complete(h: Awaited<ReturnType<typeof setupAssistantHarness>>, text = '检查报表并完成验证') {
  await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue',
    requestId: `quality-turn-${h.lead.session.snapshotEvents().length}` as never,
    content: [{ type: 'text', text }] }, new AbortController().signal)
  await h.lead.whenIdle()
  return h.lead.session.snapshotEvents().findLast(e => e.type === 'turn/end')!.seq
}

describe('Prediction stream deadlines', () => {
  it.each(['slow-success', 'silent', 'stalled-after-text', 'reasoning-only', 'no-deadline'] as const)(
    '%s uses first-text and whole-request deadlines independently', async (mode) => {
      const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true,
        predictionTimeoutMs: mode === 'no-deadline' ? 0 : 10000,
        predictionFirstTextTimeoutMs: mode === 'no-deadline' ? 0 : 6000 })
      let pending: ReturnType<typeof h.assistants.predictComposer> | undefined
      let settled: Promise<unknown> | undefined
      const entered = Promise.withResolvers<undefined>()
      let signal: AbortSignal | undefined
      try {
        const seq = await complete(h)
        vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (options): AsyncIterable<StreamChunk> {
          signal = options.signal
          const wait = (ms: number) => new Promise<void>((resolve, reject) => {
            const done = () => { options.signal?.removeEventListener('abort', abort); resolve() }
            const timer = setTimeout(done, ms)
            const abort = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(options.signal?.reason) }
            options.signal?.addEventListener('abort', abort, { once: true })
          })
          entered.resolve(undefined)
          if (mode === 'reasoning-only') {
            yield { type: 'block-start', index: 0, blockType: 'reasoning' }
            yield { type: 'reasoning-delta', index: 0, text: 'Checking the available context' }
          }
          await wait(mode === 'silent' || mode === 'reasoning-only' || mode === 'no-deadline' ? 20000 : 3500)
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: '请先修复验证失败，再重新检查报表。' }
          await wait(mode === 'stalled-after-text' ? 20000 : 1500)
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '请先修复验证失败，再重新检查报表。' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        pending = h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })
        settled = Promise.allSettled([pending])
        await entered.promise
        await vi.advanceTimersByTimeAsync(3500)
        expect(signal?.aborted).toBe(false)
        if (mode === 'slow-success' || mode === 'no-deadline') {
          if (mode === 'no-deadline') {
            await vi.advanceTimersByTimeAsync(16500)
            expect(signal?.aborted).toBe(false)
          }
          await vi.advanceTimersByTimeAsync(1500)
          expect((await pending)?.text).toBe('请先修复验证失败，再重新检查报表。')
        } else {
          const deadline = mode === 'stalled-after-text' ? 10000 : 6000
          await vi.advanceTimersByTimeAsync(deadline - 3500 - 1)
          expect(signal?.aborted).toBe(false)
          await vi.advanceTimersByTimeAsync(1)
          expect(signal?.aborted).toBe(true)
          expect(await pending).toBeNull()
        }
        expect(h.adapter.requests).toHaveLength(1)
      } finally {
        h.assistants.reviewPredictions.dispose()
        vi.useRealTimers()
        await settled
        vi.restoreAllMocks()
        await h.dispose()
      }
    },
  )
})

describe('Completed execution context', () => {
  it('retains a recent user constraint when the latest request is only continue', async () => {
    const h = await setupAssistantHarness(new MockAdapter([
      textResponse('I will plan the exports.'), textResponse('Only PDF is authorized.'), textResponse('PDF checks are ready.'),
      textResponse('请检查 PDF 的合计数。'),
    ]), { enableComposerPredictions: true })
    try {
      await complete(h, 'Implement PDF and Excel report exports.')
      await complete(h, 'Do not implement Excel; only PDF is authorized.')
      const seq = await complete(h, 'Continue.')
      const context = await h.assistants.getComposerContext(h.lead.id)
      expect(context?.recentTexts.join('\n')).toContain('Do not implement Excel')
      expect(context?.recentTexts.join('\n')).toContain('Continue.')
      await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })
      expect(JSON.stringify(h.adapter.requests.at(-1)!.messages)).toContain('Do not implement Excel')
    } finally { await h.dispose() }
  })
  it('retains failed tool evidence when the early reply sentence claims success', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('verify-report', 'verify_report', {}),
      textResponse('报表已完成。' + '过程说明。'.repeat(1000) + '仍需验证 Excel 导出。'),
      textResponse('请先修复失败的 Excel 验证，再确认导出是否可用。'),
    ])
    const h = await setupAssistantHarness(adapter, { enableComposerPredictions: true })
    try {
      h.lead.ctx.effect(() => h.lead.ctx.tools.register(defineTool({
        name: 'verify_report', description: 'Verify the report', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(): Promise<string> { throw new Error('EXCEL_VALIDATION_FAILED: worksheet totals do not match') },
      })))
      const seq = await complete(h, '实现 PDF 和 Excel 报表导出，并验证所有合计数。')
      const context = await h.assistants.getComposerContext(h.lead.id)
      const text = context?.recentTexts.join('\n') ?? ''
      expect(text).toContain('EXCEL_VALIDATION_FAILED')
      expect(text).toContain('verify_report')
      expect(text).toContain('仍需验证 Excel 导出')
      expect(text).toContain('验证所有合计数')
      const prediction = await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })
      expect(prediction).not.toBeNull()
      const request = adapter.requests.at(-1)!
      expect(request.provider).toBe(adapter.requests[0]!.provider)
      expect(request.model).toBe(adapter.requests[0]!.model)
      const prompt = JSON.stringify(request.messages)
      expect(prompt).toContain('EXCEL_VALIDATION_FAILED')
      expect(prompt).toContain('Assistant: 报表已完成')
      expect(prompt).toContain('untrusted')
    } finally { await h.dispose() }
  })
})


describe('Prediction reasoning budget and safe settlement', () => {
  it('allows reasoning before text while retaining the task route and a bounded output ceiling', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true })
    try {
      const seq = await complete(h)
      vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (options): AsyncIterable<StreamChunk> {
        expect(options.maxTokens).toBe(1024)
        expect(options.provider).toBe(h.adapter.requests[0]!.provider)
        expect(options.model).toBe(h.adapter.requests[0]!.model)
        yield { type: 'block-start', index: 0, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index: 0, text: 'Assessing the recorded evidence.' }
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Assessing the recorded evidence.' } }
        yield { type: 'block-start', index: 1, blockType: 'text' }
        yield { type: 'text-delta', index: 1, text: '请核对报表合计数。' }
        yield { type: 'block-end', index: 1, block: { type: 'text', text: '请核对报表合计数。' } }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 220, totalTokens: 320 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })
      expect((await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' }))?.text).toBe('请核对报表合计数。')
      const result = h.lead.session.snapshotEvents().findLast(e => e.type === 'assistant/auxiliary' && e.data.phase === 'result')
      expect(result?.type === 'assistant/auxiliary' && result.data.phase === 'result' && result.data.usage?.outputTokens).toBe(220)
    } finally { vi.restoreAllMocks(); await h.dispose() }
  })

  it('rejects token-truncated text while retaining observed billing', async () => {
    const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true })
    try {
      const seq = await complete(h)
      vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '请检查报表，然后' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '请检查报表，然后' } }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 1024, totalTokens: 1124 } }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })
      expect(await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })).toBeNull()
      const result = h.lead.session.snapshotEvents().findLast(e => e.type === 'assistant/auxiliary' && e.data.phase === 'result')
      expect(result?.type === 'assistant/auxiliary' && result.data.phase === 'result' && result.data.usage?.outputTokens).toBe(1024)
    } finally { vi.restoreAllMocks(); await h.dispose() }
  })

  it('does not dispatch or log prediction context containing credentials from a tool result', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('inspect-config', 'inspect_config', {}), textResponse('检查已完成。'),
    ])
    const h = await setupAssistantHarness(adapter, { enableComposerPredictions: true })
    try {
      h.lead.ctx.effect(() => h.lead.ctx.tools.register(defineTool({
        name: 'inspect_config', description: 'Inspect a synthetic configuration', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() { return '{"api_key":"synthetic-sensitive-value"}' },
      })))
      const seq = await complete(h)
      expect(await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' })).toBeNull()
      expect(adapter.requests).toHaveLength(2)
      expect(h.lead.session.snapshotEvents().some(e => e.type === 'assistant/auxiliary' && e.data.purpose === 'prediction')).toBe(false)
    } finally { await h.dispose() }
  })
})


it('exposes prediction as a cancellable stream for the serial desktop carrier', async () => {
  const h = await setupAssistantHarness(new MockAdapter([
    textResponse('报表已生成，合计数待核对。'), textResponse('请核对报表合计数。'),
  ]), { enableComposerPredictions: true })
  try {
    const seq = await complete(h)
    const values = []
    for await (const value of h.assistants.streamComposerPrediction({ sessionId: h.lead.id, asOfSeq: seq, draftText: '' },
      new AbortController().signal)) values.push(value)
    expect(values).toHaveLength(1)
    expect(values[0]?.text).toBe('请核对报表合计数。')
  } finally { await h.dispose() }
})
