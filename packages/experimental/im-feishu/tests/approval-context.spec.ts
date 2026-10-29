import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools/types'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { resolveApprovalContext } from '../src/approval-context.ts'

class ScriptableFakeRuntime extends PtcRuntime {
  override readonly language = 'typescript'
  override readonly isolation = 'fake'
  behavior: (request: PtcRunRequest) => Promise<PtcRunResult> = () => Promise.resolve({ logs: [] })

  resolve(request: PtcRunRequest): PtcRunSpec {
    return {
      ...request,
      cwd: request.cwd ?? '/workspace',
      timeoutMs: request.timeoutMs ?? 10_000,
    }
  }

  run(request: PtcRunRequest): Promise<PtcRunResult> {
    return this.behavior(request)
  }
}

describe('Private Approval-Context Resolver', () => {
  const nativeCallId = ToolCallId('native-call-1')
  const ptcSubCallId = ToolCallId('ptc-sub-call-2')
  const rootCallId = ToolCallId('root-call-0')

  it('fails closed (undefined) when signal is already aborted (C3 regression)', () => {
    const controller = new AbortController()
    controller.abort()

    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/call',
        data: {
          turn: 1,
          step: 1,
          callId: nativeCallId,
          name: 'bash',
          arguments: '{"cmd":"echo hi"}',
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'bash',
      callId: nativeCallId,
      signal: controller.signal,
    })

    expect(resolved).toBeUndefined()
  })

  it('fails closed (undefined) on malformed native argument JSON, never returning null arguments (C3 regression)', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/call',
        data: {
          turn: 1,
          step: 1,
          callId: nativeCallId,
          name: 'bash',
          arguments: '{ malformed json syntax',
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'bash',
      callId: nativeCallId,
    })

    expect(resolved).toBeUndefined()
  })

  it('fails closed (undefined) when native tool call is already settled by tool/result (C3 regression)', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/call',
        data: {
          turn: 1,
          step: 1,
          callId: nativeCallId,
          name: 'bash',
          arguments: '{"cmd":"echo settled"}',
        },
      },
      {
        seq: SessionSeq(2),
        time: 2,
        type: 'tool/result',
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({
            callId: nativeCallId,
            content: [{ type: 'text', text: 'settled' }],
            isError: false,
          }),
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'bash',
      callId: nativeCallId,
    })

    expect(resolved).toBeUndefined()
  })

  it('fails closed (undefined) when nested PTC call is already settled by tool/ptc-dispatch (C3 regression)', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/ptc-dispatch-start',
        data: {
          rootCallId,
          parentCallId: rootCallId,
          subCallId: ptcSubCallId,
          name: 'read_file',
          arguments: { path: '/tmp/test.txt' },
        },
      },
      {
        seq: SessionSeq(2),
        time: 2,
        type: 'tool/ptc-dispatch',
        data: {
          rootCallId,
          parentCallId: rootCallId,
          subCallId: ptcSubCallId,
          name: 'read_file',
          arguments: { path: '/tmp/test.txt' },
          isError: false,
          content: [{ type: 'text', text: 'settled' }],
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'read_file',
      callId: ptcSubCallId,
    })

    expect(resolved).toBeUndefined()
  })

  it('fails closed (undefined) when crossing completed turn boundary', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/call',
        data: {
          turn: 1,
          step: 1,
          callId: nativeCallId,
          name: 'bash',
          arguments: '{"cmd":"echo hi"}',
        },
      },
      {
        seq: SessionSeq(2),
        time: 2,
        type: 'turn/end',
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'bash',
      callId: nativeCallId,
    })

    expect(resolved).toBeUndefined()
  })

  it('fails closed (undefined) when tool name mismatches', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/call',
        data: {
          turn: 1,
          step: 1,
          callId: nativeCallId,
          name: 'bash',
          arguments: '{"cmd":"echo hi"}',
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'edit_file',
      callId: nativeCallId,
    })

    expect(resolved).toBeUndefined()
  })

  it('resolves valid native tool/call context with parsed arguments', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/call',
        data: {
          turn: 1,
          step: 1,
          callId: nativeCallId,
          name: 'bash',
          arguments: '{"cmd":"ls -la"}',
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'bash',
      callId: nativeCallId,
    })

    expect(resolved).toEqual({
      kind: 'native',
      callId: nativeCallId,
      name: 'bash',
      arguments: { cmd: 'ls -la' },
    })
  })

  it('resolves valid nested PTC tool/ptc-dispatch-start context', () => {
    const events: SessionEvent[] = [
      {
        seq: SessionSeq(1),
        time: 1,
        type: 'tool/ptc-dispatch-start',
        data: {
          rootCallId,
          parentCallId: rootCallId,
          subCallId: ptcSubCallId,
          name: 'read_file',
          arguments: { path: '/workspace/README.md' },
        },
      },
    ]

    const resolved = resolveApprovalContext(events, {
      toolName: 'read_file',
      callId: ptcSubCallId,
    })

    expect(resolved).toEqual({
      kind: 'ptc',
      subCallId: ptcSubCallId,
      rootCallId,
      parentCallId: rootCallId,
      name: 'read_file',
      arguments: { path: '/workspace/README.md' },
    })
  })

  it('verifies real PTC dispatch records dispatch-start before approval and checks allow/reject side effects', async () => {
    const ctx = new Context()
    onTestFinished(async () => {
      await ctx.fiber.dispose()
    })
    await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'ptc' } })
    await ctx.plugin(ScriptableFakeRuntime)
    await ctx.plugin(ApprovalService)
    const harness = await mountAgentLoopTestHarness(ctx)

    const runtime = ctx.ptcRuntime as ScriptableFakeRuntime
    let sideEffectCount = 0

    ctx.tools.register(
      defineTool({
        name: 'dangerous_write',
        description: 'Dangerous filesystem mutation',
        parameters: { path: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: () => {
          sideEffectCount += 1
          return Promise.resolve('written')
        },
      }),
    )

    // Configure pre-execute policy: allow run_code, ask for dangerous_write
    ctx.on('tools/pre-execute', (exec, next) => {
      if (exec.name === RUN_CODE_NAME) {
        return Promise.resolve({ kind: 'allow' })
      }
      if (exec.name === 'dangerous_write') {
        return Promise.resolve({ kind: 'ask', reason: 'Dangerous mutation' })
      }
      return next()
    })

    const agent = await harness.create(SessionId('real-ptc-session'))
    agent.session.append('turn/start', { turn: 1 })

    // 1. Allow path
    let approvalObservedDispatchStart = false
    ctx.on('approval/request', (req) => {
      if (req.toolName === RUN_CODE_NAME) {
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      }

      // For the inner tool call inside PTC:
      // Check session events at approval request time: tool/ptc-dispatch-start must be present
      const events = agent.session.snapshotEvents()
      const hasDispatchStart = events.some(
        e => e.type === 'tool/ptc-dispatch-start' && e.data.subCallId === req.callId,
      )
      if (hasDispatchStart) {
        approvalObservedDispatchStart = true
      }

      const context = resolveApprovalContext(events, {
        toolName: req.toolName,
        callId: req.callId,
        signal: req.signal,
      })
      expect(context).toBeDefined()
      expect(context?.name).toBe('dangerous_write')

      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    runtime.behavior = async (req) => {
      const funcs = req.bindings[0]?.functions
      if (funcs?.dangerous_write) {
        try {
          await funcs.dangerous_write({ path: '/tmp/test.txt' })
        } catch {
          // Rejection or error caught
        }
      }
      return { logs: [] }
    }

    await ctx.tools.execute({
      callId: ToolCallId('ptc-run-1'),
      name: RUN_CODE_NAME,
      arguments: {
        code: 'dangerous_write({ path: "/tmp/allowed.txt" })',
        description: 'Test allowed execution',
      },
      agent,
      signal: new AbortController().signal,
    })

    expect(approvalObservedDispatchStart).toBe(true)
    expect(sideEffectCount).toBe(1)

    // 2. Reject path
    sideEffectCount = 0
    // Override listener with prepend for inner tool rejection
    ctx.on('approval/request', (req) => {
      if (req.toolName === RUN_CODE_NAME) {
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      }
      return Promise.resolve<ApprovalOutcome>('rejected')
    }, { prepend: true })

    await ctx.tools.execute({
      callId: ToolCallId('ptc-run-2'),
      name: RUN_CODE_NAME,
      arguments: {
        code: 'dangerous_write({ path: "/tmp/rejected.txt" })',
        description: 'Test rejected execution',
      },
      agent,
      signal: new AbortController().signal,
    })

    expect(sideEffectCount).toBe(0)
  })
})
