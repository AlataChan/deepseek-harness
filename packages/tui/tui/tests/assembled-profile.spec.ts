import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, Session } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ToolRuntime, { defineTool, RUN_CODE_NAME, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-cmdline'
import { apply as applyTuiBundle } from '@deepseek-ai/dsh-tui-bundle'
import * as TuiPlugin from '../src/index.ts'
import { InteractionProvider } from '../src/interaction.ts'
import { TerminalRenderer } from '../src/render.ts'
import { getLocale } from '../src/locales.ts'
import { createTestAgent, createTestSession, TestReadStream, TestWriteStream } from './fixtures.ts'

describe('T5 Assembled Profile Acceptance', () => {
  it('mounts the experimental profile plugins and executes interactive turns', async () => {
    const ctx = new Context()
    ctx.appExit = vi.fn()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(UserQuestionService)

    // Mount bundle marker
    await ctx.plugin({ name: 'tui-bundle', apply: applyTuiBundle })

    const mockSession = createTestSession('assembled-sess')
    mockSession.append('turn/start', { turn: 1 })
    mockSession.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'start' }],
    }), { surfaceOp: 'append' })

    const followupMock = vi.fn()
    const cancelMock = vi.fn()

    const mockAgent = createTestAgent({
      id: 'assembled-sess',
      session: mockSession,
      ctx,
      followup: followupMock,
      cancel: cancelMock,
    })

    const mockHandle: AgentHandle = {
      agent: mockAgent,
      dispose: vi.fn(async () => {}),
    }

    ctx.agents.setFactory({
      createAgent: vi.fn(async () => {
        await ctx.agents.register(mockAgent)
        return mockHandle
      }),
      resume: vi.fn(async () => {
        await ctx.agents.register(mockAgent)
        return mockHandle
      }),
    })

    // Simulated TTY streams
    const fakeStdin = new TestReadStream()
    const fakeStdout = new TestWriteStream({ columns: 80, rows: 24 })

    const origStdin = process.stdin
    const origStdout = process.stdout
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true })
    Object.defineProperty(process, 'stdout', { value: fakeStdout, configurable: true })

    try {
      // Apply the TUI plugin
      await ctx.plugin(TuiPlugin, { maxScrollbackLines: 500, locale: 'zh' })

      // Wait for input controller to attach data listener
      await vi.waitFor(() => {
        expect(fakeStdin.listenerCount('data')).toBeGreaterThan(0)
      })
      fakeStdin.emit('data', 'Hello from assembled profile\r')
      await vi.waitFor(() => {
        expect(followupMock.mock.calls.length).toBeGreaterThan(0)
      })

      // Send cancel via Ctrl+C on empty buffer during active turn
      fakeStdin.emit('data', '\x03')
      expect(cancelMock.mock.calls).toEqual([[{ kind: 'user' }]])
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true })
      await ctx.fiber.dispose()
    }
  })

  it('executes real run_code PTC nested execution with approval rejection and positive allow controls', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(FileSystem)
    await ctx.plugin(Subprocess)
    await ctx.plugin(Sandbox, {})
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
    await ctx.plugin(NodePtcRuntime, {})
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(ApprovalService)

    let mutateCalls = 0
    let lastSaved = ''
    ctx.tools.register(defineTool({
      name: 'save_record',
      description: 'Mutate disk record',
      parameters: { key: { type: 'string', required: true }, value: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: () => [],
      },
      execute(args) {
        mutateCalls += 1
        lastSaved = `${args.key}=${args.value}`
        return Promise.resolve(`saved:${args.key}`)
      },
    }))

    // Guard save_record with ask pre-execute decision
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.name === 'save_record') {
        return { kind: 'ask', reason: 'Guarded mutating record save' }
      }
      return next()
    })

    const session = Session.create(SessionId('ptc-nested-sess'))
    session.append('turn/start', { turn: 1 })

    const mockAgent = {
      id: SessionId('ptc-nested-sess'),
      session,
      options: { model: 'default' },
    } as Agent

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')
    const provider = new InteractionProvider(ctx, renderer, {
      onInteractionStart: () => {},
      onInteractionEnd: () => {},
      getActiveAgent: () => mockAgent,
    }, dict)

    try {
      // 1. Rejection control: run_code executes, nested tool asks approval, user answers 'n'
      const runCodePromiseReject = ctx.tools.execute({
        callId: ToolCallId('ptc_run_1'),
        name: RUN_CODE_NAME,
        arguments: {
          description: 'Run test script',
          code: 'try { await tools.save_record({ key: "forbidden", value: "secret" }); } catch (e: any) { console.log("REJECT_CAUGHT:" + e.message); }',
        },
        agent: mockAgent,
        signal: new AbortController().signal,
      })

      // Wait for interaction provider to receive approval request from real PTC bridge
      await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

      // User rejects the operation
      provider.handleInput('n')
      expect(provider.hasActiveInteraction).toBe(false)

      const rejectResult = await runCodePromiseReject
      // Mutating tool was NOT executed (zero side effects)
      expect(mutateCalls).toBe(0)
      expect(lastSaved).toBe('')
      expect(rejectResult.isError).toBe(false)
      expect(JSON.stringify(rejectResult)).toContain('the user rejected tool')

      // Assert session ordering: tool/ptc-dispatch-start appears before approval/asked
      const events = session.snapshotEvents()
      const startEvent = events.find(e => e.type === 'tool/ptc-dispatch-start')
      const askEvent = events.find(e => e.type === 'approval/asked')
      expect(startEvent).toBeDefined()
      expect(askEvent).toBeDefined()
      expect(startEvent!.seq).toBeLessThan(askEvent!.seq)

      // 2. Allow control (positive control): run_code executes, user answers 'y'
      const runCodePromiseAllow = ctx.tools.execute({
        callId: ToolCallId('ptc_run_2'),
        name: RUN_CODE_NAME,
        arguments: {
          description: 'Run test script 2',
          code: 'const res = await tools.save_record({ key: "allowed", value: "data_123" }); console.log("ALLOW_RESULT:" + res);',
        },
        agent: mockAgent,
        signal: new AbortController().signal,
      })

      await vi.waitFor(() => { expect(provider.hasActiveInteraction).toBe(true) })

      // User allows the operation
      provider.handleInput('y')
      expect(provider.hasActiveInteraction).toBe(false)

      const allowResult = await runCodePromiseAllow
      // Mutating tool WAS executed, producing the real side effect
      expect(mutateCalls).toBe(1)
      expect(lastSaved).toBe('allowed=data_123')
      expect(JSON.stringify(allowResult)).toContain('ALLOW_RESULT:saved:allowed')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
