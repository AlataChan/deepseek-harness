import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { TerminalRenderer } from '../src/render.ts'
import { InteractionProvider, lookupApprovalArguments, redactSecrets, summarizeArguments } from '../src/interaction.ts'
import { getLocale } from '../src/locales.ts'
import { createTestAgent, createTestSession } from './fixtures.ts'

interface RedactedShape {
  password: string
  nested: {
    api_key: string
    auth: string
    profile: {
      token: string
    }
    safe: string
  }
  list: [{ secret: string }, { item: string }]
  objectPassword: string
}

interface DeepTree {
  level?: number
  child?: DeepTree
  leaf?: string
}

describe('InteractionProvider: Approval & User Questions', () => {
  it('correctly recursively masks nested sensitive argument fields', () => {
    const raw = {
      user: 'alice',
      password: 'supersecretpassword123',
      nested: {
        api_key: 'sk-1234567890abcdef',
        auth: {
          token: 'jwt-token-val',
        },
        profile: {
          token: 'session-token-xyz',
        },
        safe: 'public-data',
      },
      list: [
        { secret: 'array-secret' },
        { item: 'regular' },
      ],
      command: 'echo safe',
      // Object-valued sensitive key test
      objectPassword: { value: 'secret-in-obj' },
    }
    const redacted = redactSecrets(raw) as RedactedShape
    expect(redacted.password).toBe('********')
    expect(redacted.nested.api_key).toBe('********')
    expect(redacted.nested.auth).toBe('********')
    expect(redacted.nested.profile.token).toBe('********')
    expect(redacted.nested.safe).toBe('public-data')
    expect(redacted.list[0].secret).toBe('********')
    expect(redacted.list[1].item).toBe('regular')
    expect(redacted.objectPassword).toBe('********')

    const summary = summarizeArguments(raw)
    expect(summary).not.toContain('supersecretpassword123')
    expect(summary).not.toContain('sk-1234567890abcdef')
    expect(summary).not.toContain('jwt-token-val')
    expect(summary).not.toContain('array-secret')
    expect(summary).not.toContain('secret-in-obj')
    expect(summary).toContain('echo safe')

    // Deep structure truncation test
    let deep: DeepTree = { leaf: 'deep-secret' }
    for (let d = 0; d < 12; d++) {
      deep = { level: d, child: deep }
    }
    const deepRedacted = redactSecrets(deep)
    expect(JSON.stringify(deepRedacted)).toContain('[Truncated]')
  })

  it('looks up approval arguments for native tool calls and nested PTC dispatch calls', () => {
    const mockSession = createTestSession('lookup-session')
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call_1'),
      name: 'bash',
      arguments: JSON.stringify({ cmd: 'ls -la' }),
    })
    mockSession.append('tool/ptc-dispatch-start', {
      rootCallId: ToolCallId('root_1'),
      parentCallId: ToolCallId('root_1'),
      subCallId: ToolCallId('ptc_sub_1'),
      name: 'write_file',
      arguments: { path: '/tmp/foo.txt', content: 'bar' },
    })

    // 1. Native lookup
    const nativeInfo = lookupApprovalArguments(mockSession, 'call_1', 'bash')
    expect(nativeInfo.found).toBe(true)
    expect(nativeInfo.kind).toBe('native')
    expect(nativeInfo.argumentsSummary).toContain('ls -la')

    // 2. PTC lookup
    const ptcInfo = lookupApprovalArguments(mockSession, 'ptc_sub_1', 'write_file')
    expect(ptcInfo.found).toBe(true)
    expect(ptcInfo.kind).toBe('ptc')
    expect(ptcInfo.argumentsSummary).toContain('/tmp/foo.txt')

    // 3. Name mismatch fails lookup
    const mismatchInfo = lookupApprovalArguments(mockSession, 'call_1', 'other_tool')
    expect(mismatchInfo.found).toBe(false)

    // 4. Unknown callId fails lookup
    const unknownInfo = lookupApprovalArguments(mockSession, 'call_999', 'bash')
    expect(unknownInfo.found).toBe(false)
  })

  it('enforces that argument unavailable requests cannot be approved (reject/cancel only)', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)

    const mockSession = createTestSession('interaction-test-sess')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'hi' }],
    }), { surfaceOp: 'append' })

    const mockAgent = createTestAgent({
      id: 'interaction-test-sess',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(mockAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => mockAgent,
    }, dict)

    const requestPromise = ctx.approval.request({
      agent: mockAgent,
      toolName: 'dangerous_tool',
      callId: ToolCallId('missing_call_id'),
    })

    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

    // Attempting to approve must fail and keep active interaction open
    const approveAttempt = provider.handleInput('y')
    expect(approveAttempt).toBe(true)
    expect(provider.hasActiveInteraction).toBe(true)

    // Rejecting is accepted
    const rejectAttempt = provider.handleInput('n')
    expect(rejectAttempt).toBe(true)
    expect(provider.hasActiveInteraction).toBe(false)

    const outcome = await requestPromise
    expect(outcome).toBe('rejected')
  })

  it('cancels pending interactions cleanly during cancelPending()', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)

    const mockSession = createTestSession('cancel-sess')
    mockSession.append('turn/start', { turn: 1 })

    const mockAgent = createTestAgent({
      id: 'cancel-sess',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(mockAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => mockAgent,
    }, dict)

    const requestPromise = ctx.approval.request({
      agent: mockAgent,
      toolName: 'any_tool',
      callId: ToolCallId('any_call'),
    })

    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

    // Trigger cancelPending
    provider.cancelPending()
    expect(provider.hasActiveInteraction).toBe(false)

    const outcome = await requestPromise
    expect(outcome).toBe('cancelled')
  })

  it('serializes concurrent interaction requests into a FIFO queue without dropping any', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)

    const mockSession = createTestSession('queue-sess')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call_a'),
      name: 'tool_a',
      arguments: '{}',
    })
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call_b'),
      name: 'tool_b',
      arguments: '{}',
    })

    const mockAgent = createTestAgent({
      id: 'queue-sess',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(mockAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    let startCount = 0
    let endCount = 0
    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => { startCount++ },
      onInteractionEnd: () => { endCount++ },
      getActiveAgent: () => mockAgent,
    }, dict)

    // Fire two concurrent approval requests
    const promiseA = ctx.approval.request({
      agent: mockAgent,
      toolName: 'tool_a',
      callId: ToolCallId('call_a'),
    })
    const promiseB = ctx.approval.request({
      agent: mockAgent,
      toolName: 'tool_b',
      callId: ToolCallId('call_b'),
    })

    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })
    expect(startCount).toBe(1)

    // Answer request A (allow)
    provider.handleInput('y')
    const outcomeA = await promiseA
    expect(outcomeA).toBe('allowed-once')

    // Request B should now be active immediately
    expect(provider.hasActiveInteraction).toBe(true)
    expect(startCount).toBe(2)

    // Answer request B (reject)
    provider.handleInput('n')
    const outcomeB = await promiseB
    expect(outcomeB).toBe('rejected')

    // Now queue should be empty and interaction ended
    expect(provider.hasActiveInteraction).toBe(false)
    expect(endCount).toBe(1)
  })

  it('answers multi-question batch with multiSelect and custom response in sequence', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)

    const mockSession = createTestSession('batch-q-sess')
    const mockAgent = createTestAgent({
      id: 'batch-q-sess',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(mockAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => mockAgent,
    }, dict)

    const questionBatchPromise = ctx.userQuestions.ask({
      agent: mockAgent,
      questions: [
        {
          id: 'q1',
          question: 'Select components to build',
          multiSelect: true,
          options: [
            { label: 'Frontend' },
            { label: 'Backend' },
            { label: 'CLI' },
          ],
        },
        {
          id: 'q2',
          question: 'Deployment environment',
          options: [
            { label: 'Staging' },
            { label: 'Production' },
          ],
        },
      ],
    })

    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

    // First question: multi-select "1, 3"
    provider.handleInput('1, 3')

    // Second question should now be pending
    expect(provider.hasActiveInteraction).toBe(true)

    // Second question: custom text "Custom Cloud"
    provider.handleInput('Custom Cloud')

    const result = await questionBatchPromise
    expect(result.answers).toEqual([
      { id: 'q1', selected: ['Frontend', 'CLI'] },
      { id: 'q2', selected: [], custom: 'Custom Cloud' },
    ])
    expect(provider.hasActiveInteraction).toBe(false)
  })

  it('cleans up AbortSignal listeners on settlement to avoid memory leaks', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)

    const mockSession = createTestSession('abort-leak-sess')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('abort_call'),
      name: 'test_tool',
      arguments: '{}',
    })

    const mockAgent = createTestAgent({
      id: 'abort-leak-sess',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(mockAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => mockAgent,
    }, dict)

    const ac = new AbortController()
    const removeListenerSpy = vi.spyOn(ac.signal, 'removeEventListener')

    const promise = ctx.approval.request({
      agent: mockAgent,
      toolName: 'test_tool',
      callId: ToolCallId('abort_call'),
      signal: ac.signal,
    })

    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

    // User settles interaction
    provider.handleInput('y')
    const outcome = await promise
    expect(outcome).toBe('allowed-once')

    // Verify removeEventListener was called
    expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('guarantees zero side-effects on rejection for both native and PTC tool execution', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)

    let nativeMutations = 0
    let ptcMutations = 0

    const mockSession = createTestSession('side-effects-sess')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('native_mut'),
      name: 'danger_exec',
      arguments: JSON.stringify({ cmd: 'rm -rf /' }),
    })
    mockSession.append('tool/ptc-dispatch-start', {
      rootCallId: ToolCallId('root_mut'),
      parentCallId: ToolCallId('root_mut'),
      subCallId: ToolCallId('ptc_mut'),
      name: 'danger_ptc',
      arguments: { rm: true },
    })

    const mockAgent = createTestAgent({
      id: 'side-effects-sess',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(mockAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => mockAgent,
    }, dict)

    // Execute native tool guarded by approval
    async function executeNative() {
      const outcome = await ctx.approval.request({
        agent: mockAgent,
        toolName: 'danger_exec',
        callId: ToolCallId('native_mut'),
      })
      if (outcome === 'allowed-once') {
        nativeMutations++
        return { success: true }
      }
      return { success: false, error: 'rejected' }
    }

    // Execute PTC tool guarded by approval
    async function executePtc() {
      const outcome = await ctx.approval.request({
        agent: mockAgent,
        toolName: 'danger_ptc',
        callId: ToolCallId('ptc_mut'),
      })
      if (outcome === 'allowed-once') {
        ptcMutations++
        return { success: true }
      }
      return { success: false, error: 'rejected' }
    }

    // 1. Reject native
    const nativePromise = executeNative()
    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })
    provider.handleInput('n')
    const nativeRes = await nativePromise
    expect(nativeRes.success).toBe(false)
    expect(nativeMutations).toBe(0)

    // 2. Reject PTC
    const ptcPromise = executePtc()
    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })
    provider.handleInput('n')
    const ptcRes = await ptcPromise
    expect(ptcRes.success).toBe(false)
    expect(ptcMutations).toBe(0)
  })

  it('cancels pending interactions when active agent changes or disconnects', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)

    const mockSession = createTestSession('agent-a')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('switch_call'),
      name: 'tool_x',
      arguments: '{}',
    })

    let currentAgent: Agent | undefined = createTestAgent({
      id: 'agent-a',
      session: mockSession,
      ctx,
    })

    await ctx.agents.register(currentAgent)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => currentAgent,
    }, dict)

    const promise = ctx.approval.request({
      agent: currentAgent,
      toolName: 'tool_x',
      callId: ToolCallId('switch_call'),
    })

    await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

    // Switch active agent
    currentAgent = undefined

    // Attempting to input input with no active agent cancels pending
    provider.handleInput('y')
    const outcome = await promise
    expect(outcome).toBe('cancelled')
    expect(provider.hasActiveInteraction).toBe(false)
  })
})
