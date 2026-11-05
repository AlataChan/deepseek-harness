/** Captured model selection stays fixed for one step, including retries. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.llm.registerAdapter(['other'], adapter)
  return ctx
}

function fail(message: string, code: string): () => never {
  return () => {
    throw new LlmError(message, code)
  }
}

async function send(ctx: Context, id: string, text: string): Promise<void> {
  const agent = await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('captured model selection', () => {
  it('serves model.current from the public factory after plugin startup', async () => {
    const ctx = await harness(new MockAdapter([textResponse('unused')]))
    const agent = await ctx.agentLoop.create(SessionId('factory-ready'), { provider: 'mock', model: 'mock' })
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('rejects a late provider or model change and allows a maxTokens cap', async () => {
    const adapter = new MockAdapter([textResponse('ok'), textResponse('capped')])
    const ctx = await harness(adapter)
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    ctx.on('agent/request', async (_payload, next) => {
      const config = await next()
      return { ...config, provider: 'other', model: 'later' }
    })
    await send(ctx, 'late-route', 'go')
    expect(adapter.requests).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(new Error(
      'agent "late-route": agent/request proposed "other/later" after step preparation fixed "mock/mock"; use agent.model.select() before step preparation',
    ))

    const capped = new Context()
    contexts.push(capped)
    await capped.plugin(LlmRuntime)
    await capped.plugin(SessionStore)
    await capped.plugin(SessionProjectionRegistry)
    await capped.plugin(SystemPrompt)
    await capped.plugin(ToolRuntime)
    await capped.plugin(AgentRegistry)
    await capped.plugin(AgentLoop, { agents: [] })
    const second = new MockAdapter([textResponse('capped')])
    capped.llm.registerAdapter(['mock'], second)
    capped.on('agent/request', async (_payload, next) => {
      const config = await next()
      return { ...config, maxTokens: 32 }
    })
    const agent = await capped.agentLoop.create(SessionId('max-tokens'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cap' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(second.requests).toHaveLength(1)
    expect(second.requests[0]).toMatchObject({ provider: 'mock', model: 'mock', maxTokens: 32 })
    expect(second.requests[0]?.reasoningEffort).toBeUndefined()
  })

  it('rejects a late reasoning-effort change and keeps an absent effort absent', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    ctx.on('agent/request', async (_payload, next) => {
      const config = await next()
      return { ...config, reasoningEffort: ReasoningEffortId('high') }
    })
    await send(ctx, 'late-effort', 'go')
    expect(adapter.requests).toHaveLength(0)
    expect(errors[0]).toEqual(new Error(
      'agent "late-effort": agent/request proposed reasoning effort "high" after step preparation fixed "adapter default"; use agent.model.select() before step preparation',
    ))

    const quiet = await harness(new MockAdapter([textResponse('ok')]))
    const agent = await quiet.agentLoop.create(SessionId('no-effort'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plain' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const header = agent.session.snapshotEvents().find(event => event.type === 'request/header')
    expect(header?.type === 'request/header' && header.data.header.config.reasoningEffort).toBeUndefined()
    expect(header?.type === 'request/header' && header.data.header.adapterDefaults?.reasoningEffort).toBeUndefined()
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('rejects a waterfall that drops a reasoning effort fixed before the step', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    ctx.on('agent/request', async (_payload, next) => {
      const config = await next()
      const { reasoningEffort: _fixed, ...rest } = config
      return rest
    })
    const agent = await ctx.agentLoop.create(SessionId('clear-effort'), {
      provider: 'mock', model: 'mock', reasoningEffort: ReasoningEffortId('high'),
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(errors[0]).toEqual(new Error(
      'agent "clear-effort": agent/request proposed reasoning effort "adapter default" after step preparation fixed "high"; use agent.model.select() before step preparation',
    ))
  })

  it('retries the captured route after a concurrent selection', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry-route'), { provider: 'mock', model: 'mock' })
    const seen: string[] = []
    ctx.on('agent/request', async ({ agent: subject }, next) => {
      const config = await next()
      seen.push(`${config.provider}/${config.model}/${config.reasoningEffort ?? 'adapter default'}`)
      subject.model.select({ provider: 'other', model: 'later', reasoningEffort: ReasoningEffortId('low') })
      return config
    })
    ctx.on('agent/request-error', () => Promise.resolve({ kind: 'retry' as const }))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(seen).toEqual(['mock/mock/adapter default', 'mock/mock/adapter default'])
    expect(adapter.requests.map(request => `${request.provider}/${request.model}`)).toEqual(['mock/mock', 'mock/mock'])
    expect(agent.model.current()).toEqual({
      provider: 'other', model: 'later', reasoningEffort: ReasoningEffortId('low'),
    })
  })

  it('releases the admitted tool set when opening the step fails', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('step-start-release'), { provider: 'mock', model: 'mock' })
    let disposed = 0
    const resolve = ctx.tools.resolve.bind(ctx.tools)
    vi.spyOn(ctx.tools, 'resolve').mockImplementation(async (context) => {
      const toolSet = await resolve(context)
      return {
        view: scope => toolSet.view(scope),
        dispose: () => {
          disposed += 1
          toolSet.dispose()
        },
      }
    })
    const append = agent.session.append.bind(agent.session)
    const guarded: typeof agent.session.append = (type, data, ...opts) => {
      if (type === 'step/start') throw new Error('step/start failed')
      return append(type, data, ...opts)
    }
    vi.spyOn(agent.session, 'append').mockImplementation(guarded)
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(disposed).toBe(1)
    expect(adapter.requests).toHaveLength(0)
    expect(errors[0]).toEqual(new Error('step/start failed'))
  })
})
