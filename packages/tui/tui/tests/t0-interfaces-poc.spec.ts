import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { ToolCallId, LlmAttemptId, createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { TerminalRenderer } from '../src/render.ts'
import { InteractionProvider } from '../src/interaction.ts'
import { SessionAdapter } from '../src/session.ts'
import { getLocale } from '../src/locales.ts'
import { createTestAgent, createTestSession } from './fixtures.ts'

describe('T0 Interfaces PoC: End-to-end Loop & Approval Security Invariant', () => {
  it('proves session creation, streaming, question answer, rejected approvals, and zero tool side effects', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(UserQuestionService)

    const mockSession = createTestSession('t0-test-session')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'start' }],
    }), { surfaceOp: 'append' })

    let cancelledCause: unknown
    let turnCount = 0
    const followupMock = vi.fn((_msg) => {
      turnCount++
    })

    const mockAgent = createTestAgent({
      id: 't0-test-session',
      session: mockSession,
      ctx,
      followup: followupMock,
      cancel: (cause) => {
        cancelledCause = cause
      },
    })

    let unregisterAgent: (() => unknown) | undefined
    const disposeMock = vi.fn(async () => {
      await unregisterAgent?.()
    })

    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: disposeMock,
    }

    const factory: AgentFactory = {
      createAgent: () => {
        unregisterAgent = ctx.agents.register(mockAgent)
        return Promise.resolve(mockHandle)
      },
      resume: () => {
        unregisterAgent = ctx.agents.register(mockAgent)
        return Promise.resolve(mockHandle)
      },
    }
    ctx.agents.setFactory(factory)

    const dict = getLocale('zh')
    const renderer = new TerminalRenderer(100)

    let currentStatus = 'idle'
    let currentModel = ''
    let currentSessionId = ''

    const sessionAdapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: (status) => { currentStatus = status },
      onModelChange: (model) => { currentModel = model },
      onSessionChange: (sid) => { currentSessionId = sid },
      onRenderRequest: () => {},
    }, dict)

    const interactionProvider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => sessionAdapter.agent,
    }, dict)

    // 1. Session creation
    await sessionAdapter.createSession(SessionId('t0-test-session'))
    expect(currentSessionId).toBe('t0-test-session')
    expect(sessionAdapter.agent).toBe(mockAgent)

    // 2. Prompt submission & streaming output
    await sessionAdapter.submitPrompt('Hello world')
    expect(currentStatus).toBe('running')
    expect(followupMock.mock.calls.length).toBe(1)
    expect(turnCount).toBe(1)
    expect(currentModel).toBe('mock-model')

    // Simulate session user/message event
    const userEvent = mockSession.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Hello world' }],
    }), { surfaceOp: 'append' })
    ctx.emit('session/event', mockSession, userEvent)

    // Simulate assistant streaming frames
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: {
        type: 'start',
        attemptId: LlmAttemptId('att-1'),
        revision: 0,
        turn: 0,
        step: 0,
      },
    })
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: {
        type: 'chunk',
        attemptId: LlmAttemptId('att-1'),
        revision: 0,
        index: 0,
        time: Date.now(),
        chunk: { type: 'text-delta', index: 0, text: 'Assistant ' },
      },
    })
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: {
        type: 'chunk',
        attemptId: LlmAttemptId('att-1'),
        revision: 0,
        index: 1,
        time: Date.now(),
        chunk: { type: 'text-delta', index: 1, text: 'response streaming' },
      },
    })
    ctx.emit('agent/assistant-stream', {
      agent: mockAgent,
      frame: {
        type: 'end',
        attemptId: LlmAttemptId('att-1'),
        revision: 0,
        index: 2,
        outcome: { kind: 'committed', eventType: 'assistant/message', seq: SessionSeq(1) },
      },
    })

    // Simulate session assistant/message commit event
    const assistantEvent = mockSession.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { model: 'mock-model', provider: 'deepseek' },
        content: [{ type: 'text', text: 'Assistant response streaming' }],
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    ctx.emit('session/event', mockSession, assistantEvent)

    const lines = renderer.getLines()
    expect(lines.some(l => l.text.includes('Hello world'))).toBe(true)
    expect(lines.some(l => l.text.includes('Assistant response streaming'))).toBe(true)

    // 3. User questions waterfall
    const questionPromise = ctx.userQuestions.ask({
      agent: mockAgent,
      questions: [{
        id: 'confirm-step',
        question: 'Continue execution?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      }],
    })

    expect(interactionProvider.hasActiveInteraction).toBe(true)
    // Human answers '1' (selecting 'Yes')
    const consumedQuestion = interactionProvider.handleInput('1')
    expect(consumedQuestion).toBe(true)

    const questionResult = await questionPromise
    expect(questionResult).toEqual({
      answers: [{ id: 'confirm-step', selected: ['Yes'] }],
    })
    expect(interactionProvider.hasActiveInteraction).toBe(false)

    // 4. Sensitive Tool Approvals & Side Effect Verification
    let sensitiveSideEffects = 0
    const executeToolWithApproval = async (callId: string, toolName: string): Promise<string> => {
      const outcome: ApprovalOutcome = await ctx.approval.request({
        agent: mockAgent,
        toolName,
        callId: ToolCallId(callId),
      })
      if (outcome === 'allowed-once') {
        sensitiveSideEffects++
        return 'executed'
      }
      return 'aborted'
    }

    // 4A: Native tool approval with lookup and rejection
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call_native_rm'),
      name: 'file_delete',
      arguments: JSON.stringify({ path: '/tmp/test.txt', force: true }),
    })

    const nativeToolPromise = executeToolWithApproval('call_native_rm', 'file_delete')
    await vi.waitFor(() => { expect(interactionProvider.hasActiveInteraction).toBe(true) })

    // User rejects the native tool call
    const consumedRejectNative = interactionProvider.handleInput('n')
    expect(consumedRejectNative).toBe(true)

    const nativeResult = await nativeToolPromise
    expect(nativeResult).toBe('aborted')
    expect(sensitiveSideEffects).toBe(0) // Tool side effects strictly zero!

    // 4B: PTC nested tool approval with subCallId lookup and rejection
    mockSession.append('tool/ptc-dispatch-start', {
      rootCallId: ToolCallId('call_root'),
      parentCallId: ToolCallId('call_root'),
      subCallId: ToolCallId('ptc_subcall_bash'),
      name: 'bash_exec',
      arguments: JSON.stringify({ command: 'rm -rf /' }),
    })

    const ptcToolPromise = executeToolWithApproval('ptc_subcall_bash', 'bash_exec')
    await vi.waitFor(() => { expect(interactionProvider.hasActiveInteraction).toBe(true) })

    // User rejects the PTC nested tool call
    const consumedRejectPtc = interactionProvider.handleInput('n')
    expect(consumedRejectPtc).toBe(true)

    const ptcResult = await ptcToolPromise
    expect(ptcResult).toBe('aborted')
    expect(sensitiveSideEffects).toBe(0) // Tool side effects strictly zero!

    // 4C: Missing arguments tool call (fail-closed, approval prohibited)
    const missingArgsPromise = executeToolWithApproval('call_non_existent', 'dangerous_tool')
    await vi.waitFor(() => { expect(interactionProvider.hasActiveInteraction).toBe(true) })

    // Attempting to approve when arguments are unavailable must be prohibited
    const attemptApprove = interactionProvider.handleInput('y')
    expect(attemptApprove).toBe(true)
    expect(interactionProvider.hasActiveInteraction).toBe(true) // Still active because 'y' was rejected!

    // Rejecting is allowed
    interactionProvider.handleInput('n')
    const missingArgsResult = await missingArgsPromise
    expect(missingArgsResult).toBe('aborted')
    expect(sensitiveSideEffects).toBe(0) // Tool side effects strictly zero!

    // 5. Turn cancellation
    sessionAdapter.cancelActiveTurn()
    expect(cancelledCause).toEqual({ kind: 'user' })
    expect(currentStatus).toBe('cancelling')

    // 6. Dispose & teardown
    await sessionAdapter.dispose()
    expect(disposeMock.mock.calls.length).toBe(1)
  })
})
