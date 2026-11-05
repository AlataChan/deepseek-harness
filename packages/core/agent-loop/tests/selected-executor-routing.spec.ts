/** Selected-executor routing around one step's tool batch. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineContentToolFixture,
  ToolBatchExecutionError,
  type ToolExecutor,
} from '@deepseek-ai/dsh-tools'
import { executeToolCalls } from '../src/tool-calls.ts'
import { MockAdapter } from './mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  return ctx
}

const signal = new AbortController().signal
const call = {
  type: 'tool-call' as const,
  id: ToolCallId('c1'),
  name: 'echo',
  arguments: '{}',
}

function executor(execute: ToolExecutor['execute']): ToolExecutor {
  return { describe: () => ({ schemas: [], knownNames: [] }), execute }
}

describe('selected executor routing', () => {
  it('runs an omitted admission against the live registry', async () => {
    const ctx = await harness()
    const seen: unknown[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo',
      parameters: {},
      async execute(args) {
        seen.push(args)
        return [{ type: 'text', text: 'live' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('live-registry'), { provider: 'mock', model: 'mock' })
    const accepted: UserMessage[] = []
    const outcome = await ctx.agents.withInitiator(agent, () => executeToolCalls(
      ctx, 1, 1, [call], signal, (message) => { accepted.push(message) },
    ))
    expect(outcome).toEqual({ concluded: false })
    expect(seen).toEqual([{}])
    expect(accepted).toEqual([])
    expect(agent.session.snapshotEvents().some(event => event.type === 'tool/result')).toBe(true)
  })

  it('accepts executor context and stops the turn when the batch concludes', async () => {
    const ctx = await harness()
    const note = createUserMessage({
      content: [{ type: 'text', text: 'from the executor' }],
      source: { kind: 'user' },
    })
    let sawToolSet = false
    ctx.tools.setExecutor(executor(async (input) => {
      sawToolSet = input.toolSet !== undefined
      const requested = input.calls[0]
      if (requested === undefined) throw new Error('expected the model call')
      return {
        results: [{
          callId: requested.id,
          result: {
            isError: false,
            value: 'routed',
            content: [{ type: 'text', text: 'routed' }],
            concludesTurn: true,
          },
        }],
        additionalContexts: [note],
        concluded: true,
      }
    }))
    const agent = await ctx.agentLoop.create(SessionId('routed'), { provider: 'mock', model: 'mock' })
    const accepted: UserMessage[] = []
    const outcome = await ctx.agents.withInitiator(agent, () => executeToolCalls(
      ctx, 1, 1, [call], signal, (message) => { accepted.push(message) },
    ))
    expect(sawToolSet).toBe(false)
    expect(outcome).toEqual({ concluded: true })
    expect(accepted).toEqual([note])
    expect(agent.session.snapshotEvents().some(event => event.type === 'tool/result')).toBe(false)
  })

  it('rethrows an executor failure that is not a drained batch', async () => {
    const ctx = await harness()
    ctx.tools.setExecutor(executor(async () => {
      throw new Error('executor exploded')
    }))
    const agent = await ctx.agentLoop.create(SessionId('plain-failure'), { provider: 'mock', model: 'mock' })
    const accepted: UserMessage[] = []
    await expect(ctx.agents.withInitiator(agent, () => executeToolCalls(
      ctx, 1, 1, [call], signal, (message) => { accepted.push(message) },
    ))).rejects.toThrow('executor exploded')
    expect(accepted).toEqual([])
  })

  it('keeps partial context when a drained batch has no nested cause', async () => {
    const ctx = await harness()
    const note = createUserMessage({
      content: [{ type: 'text', text: 'partial context' }],
      source: { kind: 'user' },
    })
    ctx.tools.setExecutor(executor(async () => {
      throw new ToolBatchExecutionError(undefined, {
        results: [],
        additionalContexts: [note],
        concluded: false,
      })
    }))
    const agent = await ctx.agentLoop.create(SessionId('partial'), { provider: 'mock', model: 'mock' })
    const accepted: UserMessage[] = []
    const pending = ctx.agents.withInitiator(agent, () => executeToolCalls(
      ctx, 1, 1, [call], signal, (message) => { accepted.push(message) },
    ))
    await expect(pending).rejects.toBeInstanceOf(ToolBatchExecutionError)
    expect(accepted).toEqual([note])
  })
})
