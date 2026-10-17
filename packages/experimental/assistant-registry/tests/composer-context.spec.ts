/**
 * Tests for Task 3: Bounded suggestion context, UTF-8 byte budgeting, and CJK handling.
 * Verifies:
 * - Synthetic Chinese and English multi-turn conversations where original goal precedes final text blocks.
 * - Role-attributed prompt serialization and UTF-8 byte bounding (Buffer.byteLength).
 * - Single-line concise user message output parsing and validation (rejecting empty, multi-line, over-limit, assistant-persona).
 * - Fixed-overhead overflow zero-call rejection.
 * - Secret pattern screening before inference (zero model calls).
 * - No foreign scope or unrelated private memory enters prediction context.
 */

import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import {
  truncateToUtf8Bytes,
  buildBoundedConversationContext,
  buildBoundedPredictionPrompt,
  parseAndValidatePrediction,
} from '../src/index.ts'

describe('Task 3: Bounded suggestion context & CJK token budgeting', () => {
  describe('Pure utilities: UTF-8 truncation and prompt bounding', () => {
    it('truncates strings cleanly to exact UTF-8 byte limits without splitting characters', () => {
      // ASCII string: 1 byte per char
      expect(truncateToUtf8Bytes('abcdef', 4)).toBe('abcd')
      expect(Buffer.byteLength(truncateToUtf8Bytes('abcdef', 4), 'utf8')).toBe(4)

      // CJK string: 3 bytes per char
      const cjk = '实现报表导出系统' // 8 chars * 3 bytes = 24 bytes
      expect(Buffer.byteLength(cjk, 'utf8')).toBe(24)

      // Cut at 10 bytes -> fits 3 chars (9 bytes), not 4 chars (12 bytes)
      const truncatedCjk = truncateToUtf8Bytes(cjk, 10)
      expect(truncatedCjk).toBe('实现报')
      expect(Buffer.byteLength(truncatedCjk, 'utf8')).toBe(9)

      // Edge cases: 0 bytes, negative bytes
      expect(truncateToUtf8Bytes('test', 0)).toBe('')
      expect(truncateToUtf8Bytes('test', -5)).toBe('')

      // String smaller than limit returns unchanged
      expect(truncateToUtf8Bytes('short', 100)).toBe('short')
    })

    it('assembles and bounds conversation context preserving original goal and latest turn', () => {
      const messages = [
        'User: Build an auth system with OAuth2 and rate limiting.', // Turn 1 (Original goal)
        'Assistant: I will start building auth architecture.',
        'User: Proceed with OAuth2.',
        'Assistant: OAuth2 is complete.',
        'User: Status report?', // Turn 3
        'Assistant: OAuth2 is finished, rate limiting is remaining.',
      ]

      // Budget large enough for everything
      const full = buildBoundedConversationContext(messages, 4000)
      expect(full).toContain('OAuth2 and rate limiting')
      expect(full).toContain('rate limiting is remaining')
      expect(messages.every(m => full!.includes(m))).toBe(true)

      // Budget restricted to 250 bytes: must keep first message (goal) and last turn
      const bounded = buildBoundedConversationContext(messages, 250)
      expect(bounded).not.toBeNull()
      expect(Buffer.byteLength(bounded!, 'utf8')).toBeLessThanOrEqual(250)
      expect(bounded).toContain('OAuth2 and rate limiting') // Original goal preserved
      expect(bounded).toContain('rate limiting is remaining') // Latest status preserved
    })

    it('rejects prompt building when fixed overhead exceeds predictionContextMaxBytes', () => {
      const messages = ['User: Hello', 'Assistant: Hi']
      // Minimum scaffolding is ~350 bytes; 100 bytes is strictly below fixed overhead
      const result = buildBoundedPredictionPrompt(messages, 100)
      expect(result).toBeNull()
    })

    it('validates and parses prediction output according to strict rules', () => {
      // Valid user prompts
      expect(parseAndValidatePrediction('What should we test next?')).toBe('What should we test next?')
      expect(parseAndValidatePrediction('"Please implement the rate limiter."')).toBe('Please implement the rate limiter.')
      expect(parseAndValidatePrediction('User: 请开始实现 Excel 导出功能')).toBe('请开始实现 Excel 导出功能')
      expect(parseAndValidatePrediction('- Can we run integration tests?')).toBe('Can we run integration tests?')
      expect(parseAndValidatePrediction('1. What are the dependencies?')).toBe('What are the dependencies?')

      // Rejects empty or whitespace-only
      expect(parseAndValidatePrediction('')).toBeNull()
      expect(parseAndValidatePrediction('   \n  \t  ')).toBeNull()

      // Rejects multi-line / bulleted lists
      expect(parseAndValidatePrediction('1. First item\n2. Second item')).toBeNull()
      expect(parseAndValidatePrediction('Paragraph one\n\nParagraph two')).toBeNull()

      // Rejects over-limit (> 200 characters)
      const longOutput = 'a'.repeat(201)
      expect(parseAndValidatePrediction(longOutput)).toBeNull()

      // Rejects assistant persona replies
      expect(parseAndValidatePrediction('I can help you build the Excel exporter.')).toBeNull()
      expect(parseAndValidatePrediction('I will now implement rate limiting.')).toBeNull()
      expect(parseAndValidatePrediction('Here is the plan for testing.')).toBeNull()
      expect(parseAndValidatePrediction('Sure, let me check the database.')).toBeNull()
      expect(parseAndValidatePrediction('好的，我现在为您开始实现。')).toBeNull()
      expect(parseAndValidatePrediction('我可以帮您生成代码。')).toBeNull()
      expect(parseAndValidatePrediction('我已经完成了所有工作。')).toBeNull()

      // Rejects output containing secrets
      expect(parseAndValidatePrediction('Use key sk-1234567890abcdef12345678 for access')).toBeNull()
    })
  })

  describe('Multi-turn synthetic conversation workflows', () => {
    it('preserves earlier Chinese goal in prompt when important goal precedes final text blocks', async () => {
      const script = [
        textResponse('架构规划已完成。'),
        textResponse('PDF 导出功能已实现并通过单元测试。'),
        textResponse('PDF 导出已就绪，但 Excel 导出功能尚未实现。'),
        textResponse('请开始实现 Excel 导出功能'), // Prediction response
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
        predictionContextMaxBytes: 2048,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        // Turn 1: User states the overarching goal (occurs well before the final turn)
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-1' as never,
          content: [{ type: 'text', text: '为项目实现一个带有 PDF 和 Excel 导出功能的报表系统' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        // Turn 2: Intermediary work
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-2' as never,
          content: [{ type: 'text', text: '先实现 PDF 导出' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        // Turn 3: Inquiry on remaining items
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-3' as never,
          content: [{ type: 'text', text: '目前进度如何？' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).not.toBeNull()
        expect(prediction?.text).toBe('请开始实现 Excel 导出功能')

        // Verify that the prediction request sent to the model contains the earlier overarching goal
        const predictionAdapterRequest = adapter.requests.find(r =>
          r.messages.some(m => JSON.stringify(m).includes('Suggested user next message')),
        )
        expect(predictionAdapterRequest).toBeDefined()
        const promptText = JSON.stringify(predictionAdapterRequest?.messages)

        // The original goal from Turn 1 must be present in the prompt
        expect(promptText).toContain('带有 PDF 和 Excel 导出功能的报表系统')
        // Role attribution must be present
        expect(promptText).toContain('User:')
        expect(promptText).toContain('Assistant:')
        // Bounded to predictionContextMaxBytes
        expect(Buffer.byteLength(promptText, 'utf8')).toBeLessThanOrEqual(2048 * 2) // allowance for JSON envelope
      } finally {
        await harness.dispose()
      }
    })

    it('preserves earlier English goal in prompt when important goal precedes final text blocks', async () => {
      const script = [
        textResponse('Foundation setup is complete.'),
        textResponse('OAuth2 provider integration is done and tested.'),
        textResponse('OAuth2 is operational. Rate limiting is still pending implementation.'),
        textResponse('Let us implement rate limiting next.'), // Prediction response
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
        predictionContextMaxBytes: 2048,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        // Turn 1: Overarching goal
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-en-1' as never,
          content: [{ type: 'text', text: 'Implement an authentication gateway with OAuth2 and rate limiting.' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        // Turn 2: OAuth2 phase
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-en-2' as never,
          content: [{ type: 'text', text: 'Focus on OAuth2 first.' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        // Turn 3: Status check
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-en-3' as never,
          content: [{ type: 'text', text: 'What is the current status?' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).not.toBeNull()
        expect(prediction?.text).toBe('Let us implement rate limiting next.')

        const predRequest = adapter.requests.find(r =>
          r.messages.some(m => JSON.stringify(m).includes('Suggested user next message')),
        )
        expect(predRequest).toBeDefined()
        const promptText = JSON.stringify(predRequest?.messages)
        expect(promptText).toContain('OAuth2 and rate limiting')
        expect(promptText).toContain('User:')
        expect(promptText).toContain('Assistant:')
      } finally {
        await harness.dispose()
      }
    })

    it('screens secrets from context and skips prediction with zero model calls without logging secret in diagnostics', async () => {
      const script = [
        textResponse('Got it, I recorded your credentials.'),
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        // Turn containing a secret token
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-secret' as never,
          content: [{ type: 'text', text: 'Here is the token: ghp_1234567890123456789012345' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const initialCallCount = adapter.requests.length

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        // Skipped: returns null
        expect(prediction).toBeNull()

        // Zero additional calls to the model adapter
        expect(adapter.requests.length).toBe(initialCallCount)

        // No auxiliary event was logged for prediction
        const auxEvents = liveSession.snapshotEvents().filter(e => e.type === 'assistant/auxiliary')
        expect(auxEvents).toHaveLength(0)
      } finally {
        await harness.dispose()
      }
    })

    it('rejects prediction when predictionContextMaxBytes is below fixed scaffolding overhead with zero calls', async () => {
      const script = [
        textResponse('Turn 1 completed.'),
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
        predictionContextMaxBytes: 150, // Fixed overhead is > 300 bytes
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-small-limit' as never,
          content: [{ type: 'text', text: 'Some user message' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const callsBefore = adapter.requests.length
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).toBeNull()
        expect(adapter.requests.length).toBe(callsBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('bounds massive CJK conversation text to predictionContextMaxBytes UTF-8 limit', async () => {
      const script = [
        textResponse('这是一段非常长的分析结果。'.repeat(50)), // Large assistant text
        textResponse('下一步建议是验证数据一致性'),
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
        predictionContextMaxBytes: 1024, // Strict 1024 UTF-8 byte limit
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-huge-cjk' as never,
          content: [{ type: 'text', text: '请处理海量数据分析任务：' + '中文测试内容'.repeat(100) }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).not.toBeNull()
        expect(prediction?.text).toBe('下一步建议是验证数据一致性')

        // Verify the prompt sent to the model does not exceed 1024 bytes (excluding Message wrapper)
        const predRequest = adapter.requests.find(r =>
          r.messages.some(m => JSON.stringify(m).includes('Suggested user next message')),
        )
        expect(predRequest).toBeDefined()
        const rawPrompt = (predRequest!.messages[0]!.content[0] as { text: string }).text
        expect(Buffer.byteLength(rawPrompt, 'utf8')).toBeLessThanOrEqual(1024)
      } finally {
        await harness.dispose()
      }
    })

    it('verifies no foreign scope or unrelated private memory enters prediction context', async () => {
      const script = [
        textResponse('Turn completed.'),
        textResponse('Next action'),
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        // Create a foreign profile with private memory
        const profile = await assistants.createProfile({
          name: 'Foreign Private Profile',
          responsibility: 'Handles sensitive secrets',
        })
        await assistants.saveMemory(
          { kind: 'profile', profileId: profile.id },
          'PRIVATE_FOREIGN_MEMORY_TOKEN_9988',
        )

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-scope-test' as never,
          content: [{ type: 'text', text: 'Tell me about the weather' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).not.toBeNull()

        // Inspect prompt sent to adapter: must NEVER contain foreign memory
        const predRequest = adapter.requests.find(r =>
          r.messages.some(m => JSON.stringify(m).includes('Suggested user next message')),
        )
        const prompt = (predRequest!.messages[0]!.content[0] as { text: string }).text
        expect(prompt).not.toContain('PRIVATE_FOREIGN_MEMORY_TOKEN_9988')
        expect(prompt).not.toContain('Foreign Private Profile')
      } finally {
        await harness.dispose()
      }
    })
  })
})
