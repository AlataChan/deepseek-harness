import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentHandle, type AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId, createUserMessage, createAssistantMessage, createToolResultMessage, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { TerminalRenderer } from '../src/render.ts'
import { SessionAdapter } from '../src/session.ts'
import { getLocale } from '../src/locales.ts'
import { createTestAgent, createTestSession } from './fixtures.ts'

describe('SessionAdapter & Command Routing', () => {
  it('creates and resumes sessions, managing model selection and status updates', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const mockSession = createTestSession('sess-1')
    const mockAgent = createTestAgent({
      id: 'sess-1',
      session: mockSession,
      options: { model: 'initial-model' },
      ctx,
    })

    const disposeMock = vi.fn(async () => {})
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    let activeStatus = ''
    let activeModel = ''
    let activeSessionId = ''

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: (s) => { activeStatus = s },
      onModelChange: (m) => { activeModel = m },
      onSessionChange: (id) => { activeSessionId = id },
      onRenderRequest: () => {},
    }, dict)

    // 1. Create session
    await adapter.createSession(SessionId('sess-1'))
    expect(activeSessionId).toBe('sess-1')
    expect(activeStatus).toBe('idle')
    expect(adapter.sessionId).toBe('sess-1')

    // 2. Set model selection
    adapter.setModel({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(activeModel).toBe('deepseek/deepseek-chat')
    expect(adapter.modelLabel).toBe('deepseek/deepseek-chat')

    // 3. Command: /help
    await adapter.submitPrompt('/help')
    expect(renderer.getLines().some(l => l.text.includes('/help') || l.text.includes('可用命令帮助'))).toBe(true)

    // 4. Command: /model with reasoning effort
    await adapter.submitPrompt('/model deepseek/deepseek-reasoner high')
    expect(adapter.modelLabel).toBe('deepseek/deepseek-reasoner [high]')

    // 5. Command: /clear
    await adapter.submitPrompt('/clear')
    expect(renderer.getLines().length).toBe(0)

    // 6. Resume session & bounded history replay
    mockSession.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'historical user query' }],
    }), { surfaceOp: 'append' })
    mockSession.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { model: 'mock-model', provider: 'deepseek' },
        content: [{ type: 'text', text: 'historical assistant answer' }],
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    await adapter.resumeSession(SessionId('sess-1'))
    const replayed = renderer.getLines()
    expect(replayed.some(l => l.text.includes('historical user query'))).toBe(true)
    expect(replayed.some(l => l.text.includes('historical assistant answer'))).toBe(true)

    // 7. Teardown
    await adapter.dispose()
    expect(disposeMock.mock.calls.length).toBe(2) // Once on resume (quiesce old), once on dispose
  })

  it('handles SessionAlreadyOwnedError gracefully without crashing or corrupting state', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => {
        throw new SessionAlreadyOwnedError(SessionId('locked-session'))
      }),
      resume: vi.fn(async () => {
        throw new SessionAlreadyOwnedError(SessionId('locked-session'))
      }),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    await adapter.createSession(SessionId('locked-session'))
    expect(renderer.getLines().some(l => l.text.includes(dict.sessionConflictError))).toBe(true)

    await adapter.resumeSession(SessionId('locked-session'))
    expect(renderer.getLines().some(l => l.text.includes(dict.sessionConflictError))).toBe(true)
  })

  it('delivers streaming text deltas to renderer and clears on idle', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const mockSession = createTestSession('stream-sess')
    const mockAgent = createTestAgent({
      id: 'stream-sess',
      session: mockSession,
      options: { model: 'default' },
      ctx,
    })

    const disposeMock = vi.fn(async () => {})
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const streamingCaptures: string[] = []
    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: (streaming) => {
        if (streaming !== undefined) streamingCaptures.push(streaming)
      },
    }, dict)

    await adapter.createSession(SessionId('stream-sess'))

    // Emit streaming frames
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: { type: 'start', attemptId: 'att-1', revision: 0, turn: 0, step: 0 } as AssistantStreamFrame,
    })
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: { type: 'chunk', attemptId: 'att-1', revision: 0, index: 0, time: 0, chunk: { type: 'text-delta', text: 'Hello ' } } as AssistantStreamFrame,
    })
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: { type: 'chunk', attemptId: 'att-1', revision: 0, index: 1, time: 0, chunk: { type: 'text-delta', text: 'World!' } } as AssistantStreamFrame,
    })

    expect(streamingCaptures).toContain('Hello ')
    expect(streamingCaptures).toContain('Hello World!')

    // End stream
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: { type: 'end', attemptId: 'att-1', revision: 0, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: SessionSeq(1) } } as AssistantStreamFrame,
    })
    expect(streamingCaptures[streamingCaptures.length - 1]).toBe('')
  })

  it('queues drafts during active turns (draft-until-idle) and dispatches on idle', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const mockSession = createTestSession('draft-sess')
    const followupSpy = vi.fn()
    const mockAgent = createTestAgent({
      id: 'draft-sess',
      session: mockSession,
      options: { model: 'default' },
      ctx,
      followup: followupSpy,
    })

    const disposeMock = vi.fn(async () => {})
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    await adapter.createSession(SessionId('draft-sess'))

    // 1. Submit first prompt while idle
    await adapter.submitPrompt('First query')
    expect(followupSpy).toHaveBeenCalledTimes(1)

    // 2. Submit second prompt while status is running
    await adapter.submitPrompt('Queued query')
    expect(followupSpy).toHaveBeenCalledTimes(1) // Still 1, queued!
    expect(renderer.getLines().some(l => l.text.includes(dict.draftQueuedNotice))).toBe(true)

    // 3. Agent signals idle -> queued prompt is dispatched
    ctx.emit('agent/status', { agent: mockAgent, status: 'idle' })
    await vi.waitFor(() => { expect(followupSpy).toHaveBeenCalledTimes(2) })
  })

  it('validates model and provider against LLM catalog and rejects invalid selections', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    // Provide mock LLM service
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listModels: async (provider: string) => {
        if (provider === 'deepseek') {
          return [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
          ]
        }
        return []
      },
    } as LlmRuntime)

    const mockSession = createTestSession('val-sess')
    const mockAgent = createTestAgent({
      id: 'val-sess',
      session: mockSession,
      options: { model: 'default' },
      ctx,
    })

    const disposeMock = vi.fn(async () => {})
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    await adapter.createSession(SessionId('val-sess'))

    // 1. Invalid provider -> rejected
    await adapter.submitPrompt('/model non_existent_prov/model_x')
    expect(renderer.getLines().some(l => l.text.includes(dict.modelUnknownError))).toBe(true)

    // 2. Invalid model for valid provider -> rejected
    await adapter.submitPrompt('/model deepseek/non_existent_model')
    expect(renderer.getLines().some(l => l.text.includes(dict.modelUnknownError))).toBe(true)

    // 3. Invalid reasoning effort -> rejected
    await adapter.submitPrompt('/model deepseek/deepseek-chat invalid_effort')
    expect(renderer.getLines().some(l => l.text.includes(dict.modelEffortInvalidError))).toBe(true)

    // 4. Valid provider, model, and effort -> accepted
    await adapter.submitPrompt('/model deepseek/deepseek-reasoner high')
    expect(adapter.modelLabel).toBe('deepseek/deepseek-reasoner [high]')
  })

  it('queues multiple pending prompts during running turn without dropping any', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const mockSession = createTestSession('multi-draft-sess')
    const followupSpy = vi.fn()
    const mockAgent = createTestAgent({
      id: 'multi-draft-sess',
      session: mockSession,
      options: { model: 'default' },
      ctx,
      followup: followupSpy,
    })

    const disposeMock = vi.fn(async () => {})
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    await adapter.createSession(SessionId('multi-draft-sess'))

    // First prompt -> running
    await adapter.submitPrompt('Prompt 1')
    expect(followupSpy).toHaveBeenCalledTimes(1)

    // Second prompt -> queued
    await adapter.submitPrompt('Prompt 2')
    // Third prompt -> queued
    await adapter.submitPrompt('Prompt 3')
    expect(followupSpy).toHaveBeenCalledTimes(1) // Still 1

    // Finish turn 1
    ctx.emit('agent/status', { agent: mockAgent, status: 'idle' })
    await vi.waitFor(() => { expect(followupSpy).toHaveBeenCalledTimes(2) })

    // Finish turn 2
    ctx.emit('agent/status', { agent: mockAgent, status: 'idle' })
    await vi.waitFor(() => { expect(followupSpy).toHaveBeenCalledTimes(3) })
  })

  it('renders tool results using persisted tool presenter metadata from session log', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    // Register a tool with custom presentResult
    ctx.tools.register(
      defineContentToolFixture({
        name: 'calc_test',
        description: 'Calculator test tool',
        parameters: {},
        async execute() {
          return [{ type: 'text', text: '42' }]
        },
        presentResult: (args: unknown, result: { content: { type: string; text?: string }[] }) => ({
          card: 'generic',
          title: `Calculator computed: ${result.content[0]?.text} for ${(args as { expr?: string } | undefined)?.expr}`,
        }),
      }),
    )

    const mockSession = createTestSession('tool-pres-sess')
    const mockAgent = createTestAgent({
      id: 'tool-pres-sess',
      session: mockSession,
      options: { model: 'default' },
      ctx,
    })

    const disposeMock = vi.fn(async () => {})
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    await adapter.createSession(SessionId('tool-pres-sess'))

    // Emit tool/call calc_call_1
    const callEvent = mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('calc_call_1'),
      name: 'calc_test',
      arguments: JSON.stringify({ expr: '6 * 7' }),
    })
    ctx.emit('session/event', mockSession, callEvent)

    // Emit tool/result matching calc_call_1
    const resultEvent = mockSession.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('calc_call_1'),
        content: [{ type: 'text', text: '42' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    ctx.emit('session/event', mockSession, resultEvent)

    const lines = renderer.getLines()
    expect(lines.some(l => l.text.includes('Calculator computed: 42 for 6 * 7'))).toBe(true)
  })

  it('handles deferred factory resolution and disposes late handle cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    let resolveFactory!: (handle: AgentHandle) => void
    const factoryPromise = new Promise<AgentHandle>((resolve) => {
      resolveFactory = resolve
    })

    const cancelFn = vi.fn()
    const disposeFn = vi.fn(async () => {})
    const mockAgent = createTestAgent({
      id: 'deferred-agent',
      options: { model: 'test' },
      cancel: cancelFn,
    })
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeFn,
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(() => factoryPromise),
      resume: vi.fn(() => factoryPromise),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')
    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    // Start creation in background (will block on factoryPromise)
    const createPromise = adapter.createSession(SessionId('deferred-agent'))

    // Trigger disposal while factory is still pending
    const disposePromise = adapter.dispose()

    // Resolve the factory now
    resolveFactory(mockHandle)

    // Both should settle cleanly
    await createPromise
    await disposePromise

    // Verify late handle was canceled and disposed
    expect(cancelFn).toHaveBeenCalled()
    expect(disposeFn).toHaveBeenCalled()
  })

  it('rejects with timeout AggregateError when factory never settles during dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const neverSettlingFactory = new Promise<AgentHandle>(() => {})

    ctx.agents.setFactory({
      createAgent: vi.fn(() => neverSettlingFactory),
      resume: vi.fn(() => neverSettlingFactory),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')
    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    // Start creation in background (never settles)
    void adapter.createSession(SessionId('stuck-agent'))

    // Disposal must time out and throw AggregateError rather than falsely reporting success
    await expect(adapter.dispose()).rejects.toThrow(/Active session transition timed out during dispose/)
  }, 10000)

  it('rejects with AggregateError when handle.dispose never settles during teardown', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const neverSettlingDispose = new Promise<void>(() => {})
    const mockAgent = createTestAgent({
      id: 'stuck-dispose',
      options: { model: 'test' },
    })
    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: vi.fn(() => neverSettlingDispose),
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')
    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    await adapter.createSession(SessionId('stuck-dispose'))

    // Disposal must time out on handle.dispose and throw AggregateError rather than falsely reporting success
    await expect(adapter.dispose()).rejects.toThrow(/Agent handle disposal timed out/)
  }, 10000)

  it('enforces custom maxStreamAccumulatorChars by bounding streaming text accumulator', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)

    const mockSession = createTestSession('stream-bounded-sess')
    const mockAgent = createTestAgent({
      id: 'stream-bounded-sess',
      session: mockSession,
      options: { model: 'default' },
      ctx,
    })

    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: vi.fn(async () => {}),
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => mockHandle),
      resume: vi.fn(async () => mockHandle),
    })

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')
    let lastStream = ''

    const adapter = new SessionAdapter(
      ctx,
      renderer,
      {
        onStatusChange: () => {},
        onModelChange: () => {},
        onSessionChange: () => {},
        onRenderRequest: (streaming) => {
          if (streaming !== undefined) {
            lastStream = streaming
          }
        },
      },
      dict,
      { maxStreamAccumulatorChars: 10 },
    )

    await adapter.createSession(SessionId('stream-bounded-sess'))

    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: { type: 'start', attemptId: 'att-bounded', revision: 0, turn: 0, step: 0 } as AssistantStreamFrame,
    })
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: { type: 'chunk', attemptId: 'att-bounded', revision: 0, index: 0, time: 0, chunk: { type: 'text-delta', text: '0123456789ABCDEF' } } as AssistantStreamFrame,
    })

    // Accumulator was configured to max 10 chars, so text is clamped to at most 10 chars
    expect(lastStream.length).toBeLessThanOrEqual(10)
  })
})
