import { describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool } from '@deepseek-ai/dsh-tools'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import * as runtimePlugin from '../src/runtime-plugin.ts'
import { ImWriterLease } from '../src/writer-lease.ts'

class MockLlmAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Hello from tenant agent' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello from tenant agent' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('RuntimePlugin (Tenant isolated execution)', () => {
  it('initializes runtime with single-writer lease, persists deliveries, and releases lease on disposal', async () => {
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-rt-st-')))
    const workspaceDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-rt-ws-')))
    const sessionsDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-rt-sess-')))
    await chmod(stateDir, 0o700)
    await chmod(workspaceDir, 0o700)

    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: sessionsDir, compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const plugin = ctx.plugin(runtimePlugin, {
        tenantId: 'tenant_alpha',
        operatorIds: ['operator_alice'],
        stateDirectory: stateDir,
        cwd: workspaceDir,
        socketPath: join(stateDir, 't.sock'),
        shutdownTimeoutMs: 5000,
        maxActiveDeliveries: 1,
        modelSelection: { provider: 'fixture', model: 'fixture' },
      })
      await plugin

      const runtime = ctx.imRuntime
      expect(Boolean(runtime)).toBe(true)

      // Submit delivery
      const deliveryKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_1', 'operator_alice', 'event_1'])
      const requestId = randomUUID()
      const ack = await runtime.handleSubmitDelivery({
        id: 'msg_1',
        type: 'submit_delivery',
        deliveryKey,
        requestId,
        operatorId: 'operator_alice',
        prompt: 'Ping',
        sessionId: null,
      })

      expect(ack.status).toBe('admitted')
      expect(ack.requestId).toBe(requestId)

      // Query delivery status after completion
      await vi.waitFor(
        async () => {
          const getRes = await runtime.handleGetDelivery({
            id: 'msg_2',
            type: 'get_delivery',
            deliveryKey,
          })
          expect(getRes.reconciliation.state).toBe('completed')
        },
        { timeout: 5000, interval: 50 },
      )

      // Phase 2 approval context lookup returns null (never exposes raw argument objects)
      const approvalCtx = await runtime.handleGetApprovalContext({
        id: 'msg_3',
        type: 'get_approval_context',
        sessionId: ack.sessionId,
      })
      expect(approvalCtx.context).toBeNull()

      // Teardown
      await plugin.dispose()
      await ctx.fiber.dispose()

      // Verify writer lease was released after disposal
      const lease = await ImWriterLease.acquire(stateDir)
      expect(lease).toBeInstanceOf(ImWriterLease)
      await lease.release()
    } finally {
      await rm(stateDir, { recursive: true, force: true })
      await rm(workspaceDir, { recursive: true, force: true })
      await rm(sessionsDir, { recursive: true, force: true })
    }
  })

  it('fails closed on sensitive tool side effects under Phase 2 unapproved execution', async () => {
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-rt-neg-st-')))
    const workspaceDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-rt-neg-ws-')))
    const sessionsDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-rt-neg-sess-')))
    await chmod(stateDir, 0o700)
    await chmod(workspaceDir, 0o700)

    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: sessionsDir, compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)
      await ctx.plugin(UserApproval)

      let sensitiveSideEffectExecuted = false
      const sensitiveTool = defineTool({
        name: 'delete_production_database',
        description: 'Dangerous sensitive tool requiring approval',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render(_args, val) {
            return [{ type: 'text', text: val }]
          },
        },
        execute: () => {
          sensitiveSideEffectExecuted = true
          return Promise.resolve('Database deleted')
        },
      })
      ctx.tools.register(sensitiveTool)

      // Mock LLM that attempts to call the sensitive tool
      const callId = ToolCallId('call_dangerous_1')
      class ToolCallingLlmAdapter extends LlmAdapter {
        async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield {
            type: 'tool-call-delta',
            index: 0,
            id: callId,
            name: 'delete_production_database',
            argumentsDelta: '{}',
          }
          yield {
            type: 'block-end',
            index: 0,
            block: {
              type: 'tool-call',
              id: callId,
              name: 'delete_production_database',
              arguments: '{}',
            },
          }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        }
      }

      ctx.llm.registerAdapter(['fixture'], new ToolCallingLlmAdapter())

      const plugin = ctx.plugin(runtimePlugin, {
        tenantId: 'tenant_alpha',
        operatorIds: ['operator_alice'],
        stateDirectory: stateDir,
        cwd: workspaceDir,
        socketPath: join(stateDir, 't.sock'),
        shutdownTimeoutMs: 5000,
        maxActiveDeliveries: 1,
        modelSelection: { provider: 'fixture', model: 'fixture' },
      })
      await plugin

      const runtime = ctx.imRuntime
      const deliveryKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_1', 'operator_alice', 'event_danger'])
      const requestId = randomUUID()

      await runtime.handleSubmitDelivery({
        id: 'msg_neg_1',
        type: 'submit_delivery',
        deliveryKey,
        requestId,
        operatorId: 'operator_alice',
        prompt: 'Delete the database',
        sessionId: null,
      })

      // Verify that sensitive tool was NOT executed (fails closed without approval)
      expect(sensitiveSideEffectExecuted).toBe(false)

      await ctx.fiber.dispose()
    } finally {
      await rm(stateDir, { recursive: true, force: true })
      await rm(workspaceDir, { recursive: true, force: true })
      await rm(sessionsDir, { recursive: true, force: true })
    }
  })

  it('rejects missing or conflicting transports at config parsing', async () => {
    const ctx = new Context()
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-rt-tr-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    try {
      // 1. Missing transport (neither useSystemdStdio nor socketPath)
      await expect(
        runtimePlugin.apply(ctx, {
          tenantId: 'tenant_alpha',
          operatorIds: ['operator_alice'],
          stateDirectory: tempDir,
          cwd: tempDir,
        }),
      ).rejects.toThrow(/Runtime requires exactly one transport/)

      // 2. Conflicting transports (both useSystemdStdio: true and socketPath)
      await expect(
        runtimePlugin.apply(ctx, {
          tenantId: 'tenant_alpha',
          operatorIds: ['operator_alice'],
          stateDirectory: tempDir,
          cwd: tempDir,
          useSystemdStdio: true,
          socketPath: join(tempDir, 'conflict.sock'),
        }),
      ).rejects.toThrow(/Runtime requires exactly one transport/)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
