/** Executor routing, batch scheduling, and step-admission lifecycle. */

import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, HarnessError, ToolCallId, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineContentToolFixture,
  defineTool,
  TOOL_ABORTED,
  TOOL_ABORTED_BEFORE_DISPATCH,
  ToolBatchExecutionError,
  ToolExecutorUnavailableError,
  ToolNotFoundError,
  type ResolvedToolSet,
  type ToolExecutionToken,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { executeToolBatch, ToolExecutionPipeline, type ScheduledToolDispatch } from '@deepseek-ai/dsh-tools/pipeline'
import { TOOL_RUNTIME_EVENTS } from '../src/events.ts'
const signal = new AbortController().signal

async function toolsOf(mode?: 'ptc'): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, mode === undefined ? {} : { mode })
  return ctx
}

async function withAgent(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('coverage-agent'), { provider: 'mock', model: 'mock' })
  return { ctx, agent }
}

function toolCall(id: string, name: string, argumentsText: string): ToolCallBlock {
  return { type: 'tool-call', id: ToolCallId(id), name, arguments: argumentsText }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1000 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 0))
  if (!predicate()) throw new Error('condition never held')
}

class RejectingDispatch extends ToolExecutionPipeline {
  override dispatch(_exec: ToolRunContext): Promise<ScheduledToolDispatch> {
    return Promise.reject(new Error('dispatch failed'))
  }
}

describe('public executor routing', () => {
  it('returns the selected executor result and encodes a missing argument list as null', async () => {
    const { ctx, agent } = await withAgent()
    const ran: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo',
      parameters: {},
      async execute() {
        ran.push('body')
        return []
      },
    }))
    const toolSet: ResolvedToolSet = { dispose() {}, view: () => new Map() }
    const seen: { id: string; arguments: string; hasAgent: boolean; hasToolSet: boolean }[] = []
    ctx.tools.setExecutor({
      describe: () => ({ schemas: [], knownNames: [] }),
      async execute(input) {
        const call = input.calls[0]
        if (call === undefined) return { results: [], additionalContexts: [], concluded: false }
        seen.push({
          id: call.id,
          arguments: call.arguments,
          hasAgent: input.agent !== undefined,
          hasToolSet: input.toolSet !== undefined,
        })
        return {
          results: [{
            callId: call.id,
            result: { isError: false, value: 'routed', content: [{ type: 'text', text: 'routed' }] },
          }],
          additionalContexts: [],
          concluded: false,
        }
      },
    })
    const routed = await ctx.tools.execute({
      signal, callId: ToolCallId('object-args'), name: 'echo', arguments: { text: 'hi' }, agent, toolSet,
    })
    const missing = await ctx.tools.execute({
      signal, callId: ToolCallId('missing-args'), name: 'echo', arguments: undefined,
    })
    expect(ran).toEqual([])
    expect(routed.content).toEqual([{ type: 'text', text: 'routed' }])
    expect(missing.content).toEqual([{ type: 'text', text: 'routed' }])
    expect(seen).toEqual([
      { id: 'object-args', arguments: JSON.stringify({ text: 'hi' }), hasAgent: true, hasToolSet: true },
      { id: 'missing-args', arguments: 'null', hasAgent: false, hasToolSet: false },
    ])
  })

  it('rejects a selected executor that settles no result', async () => {
    const ctx = await toolsOf()
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {}, async execute() { return [] },
    }))
    ctx.tools.setExecutor({
      describe: () => ({ schemas: [], knownNames: [] }),
      async execute() {
        return { results: [], additionalContexts: [], concluded: false }
      },
    })
    await expect(ctx.tools.execute({
      signal, callId: ToolCallId('empty'), name: 'echo', arguments: {},
    })).rejects.toThrow('selected executor returned no result')
  })

  it('refuses an aborted ready call before the refusal text and keeps an already final argument error', async () => {
    const ctx = await toolsOf()
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {}, async execute() { return [{ type: 'text', text: 'ran' }] },
    }))
    const pipeline = new ToolExecutionPipeline(ctx.tools, {
      reject: name => new ToolNotFoundError(name, 'refused by executor'),
    })
    const aborted = new AbortController()
    aborted.abort()
    const ready = await pipeline.prepare({
      signal: aborted.signal, callId: ToolCallId('ready'), name: 'echo', arguments: {},
    })
    expect(ready.kind).toBe('final-result')
    if (ready.kind === 'final-result' && ready.result.isError) {
      expect(ready.result.error.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
      expect(ready.result.error.message).not.toContain('refused by executor')
    }

    const invalid = await pipeline.prepare({
      signal: aborted.signal, callId: ToolCallId('invalid'), name: 'echo', arguments: undefined,
    })
    expect(invalid.kind).toBe('final-result')
    if (invalid.kind === 'final-result') {
      expect(invalid.result.content).toEqual([{
        type: 'text', text: 'Error: tool execution arguments must be losslessly JSON-serializable',
      }])
    }

    const liveInvalid = await pipeline.prepare({
      signal, callId: ToolCallId('invalid-live'), name: 'echo', arguments: undefined,
    })
    expect(liveInvalid.kind).toBe('final-result')
    if (liveInvalid.kind === 'final-result' && liveInvalid.result.isError) {
      expect(liveInvalid.result.error.message).toContain('refused by executor')
      expect(liveInvalid.result.error.info?.code).not.toBe(TOOL_ABORTED_BEFORE_DISPATCH)
    }
  })

  it('keeps a pre-dispatch cancellation when a collapsed call is already aborted', async () => {
    const ctx = await toolsOf('ptc')
    const ran: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { ran.push('body'); return [] },
    }))
    const pipeline = new ToolExecutionPipeline(ctx.tools, {
      reject: name => new ToolNotFoundError(name, 'refused by executor'),
    })
    const aborted = new AbortController()
    aborted.abort()
    const prepared = await pipeline.prepare({
      signal: aborted.signal, callId: ToolCallId('collapsed'), name: 'echo', arguments: {},
    })
    const live = await pipeline.prepare({
      signal, callId: ToolCallId('collapsed-live'), name: 'echo', arguments: {},
    })
    expect(ran).toEqual([])
    expect(prepared.kind).toBe('final-result')
    if (prepared.kind === 'final-result' && prepared.result.isError) {
      expect(prepared.result.error.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
    }
    expect(live.kind).toBe('final-result')
    if (live.kind === 'final-result' && live.result.isError) {
      expect(live.result.error.message).toContain('refused by executor')
    }
  })
})

describe('step admission', () => {
  it('hides tools for another scope, after replacement, and after dispose', async () => {
    const { ctx, agent } = await withAgent()
    const other = await ctx.agentLoop.create(SessionId('other-agent'), { provider: 'mock', model: 'mock' })
    const calls: string[] = []
    const remove = ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { calls.push('old'); return [] },
    }))
    const admitted = await ctx.tools.resolve({
      agent,
      modelSelection: { provider: 'mock', model: 'mock' },
      signal,
    })
    expect([...admitted.view(agent).keys()]).toEqual(['echo'])
    expect(admitted.view(other).size).toBe(0)
    remove()
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { calls.push('new'); return [] },
    }))
    expect(admitted.view(agent).size).toBe(0)
    admitted.dispose()
    expect(admitted.view(agent).size).toBe(0)
    expect(calls).toEqual([])
  })

  it('leaves the deployment presentation in place when the root disposer runs', async () => {
    const ctx = await toolsOf('ptc')
    const dispose = ctx.tools.requirePtcPresentation()
    dispose()
    expect(() => ctx.tools.requirePtcPresentation()).not.toThrow()
  })

  it('stops a later call after the selected executor unloads', async () => {
    const ctx = await toolsOf()
    const calls: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { calls.push('body'); return [] },
    }))
    const dispose = ctx.tools.setExecutor({
      describe: () => ({ schemas: [], knownNames: [] }),
      async execute() {
        return { results: [], additionalContexts: [], concluded: false }
      },
    })
    void dispose()
    expect(() => ctx.tools.selectedExecutor()).toThrow(ToolExecutorUnavailableError)
    await expect(ctx.tools.execute({
      signal, callId: ToolCallId('after-unload'), name: 'echo', arguments: {},
    })).rejects.toThrow(ToolExecutorUnavailableError)
    expect(calls).toEqual([])
  })
})

describe('tool batch lifecycle', () => {
  it('rejects a concurrency override that is not a positive integer', async () => {
    const ctx = await toolsOf()
    const calls: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { calls.push('body'); return [] },
    }))
    const pipeline = new ToolExecutionPipeline(ctx.tools)
    const input = {
      calls: [toolCall('c1', 'echo', '{}')],
      signal,
    }
    await expect(executeToolBatch({ ...input, maxParallelToolCalls: 0 }, pipeline, () => 4)).rejects.toThrow(RangeError)
    await expect(executeToolBatch({ ...input, maxParallelToolCalls: 1.5 }, pipeline, () => 4)).rejects.toThrow(
      'maxParallelToolCalls must be a positive integer',
    )
    expect(calls).toEqual([])
  })

  it('maps an empty argument string to an object and preserves malformed JSON as an error', async () => {
    const ctx = await toolsOf()
    const seen: unknown[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute(args) {
        seen.push(args)
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    const batch = await executeToolBatch({
      calls: [
        toolCall('empty', 'echo', ''),
        toolCall('bad', 'echo', 'not-json'),
      ],
      signal,
    }, new ToolExecutionPipeline(ctx.tools), () => 1)
    expect(seen).toEqual([{}])
    expect(batch.results[0]?.result.isError).toBe(false)
    expect(batch.results[1]?.result.isError).toBe(true)
  })

  it('holds an exclusive call until the parallel calls ahead of it drain', async () => {
    const ctx = await toolsOf()
    const started: string[] = []
    const release = new Map<string, () => void>()
    ctx.tools.register(defineContentToolFixture({
      name: 'lane',
      description: 'lane',
      parameters: { id: { type: 'string', required: true }, lane: { type: 'string', required: true } },
      isConcurrencySafe: args => args.lane === 'parallel',
      async execute(args) {
        started.push(args.id)
        await new Promise<void>((resolve) => { release.set(args.id, resolve) })
        return [{ type: 'text', text: args.id }]
      },
    }))
    const pending = executeToolBatch({
      calls: [
        toolCall('a', 'lane', JSON.stringify({ id: 'a', lane: 'parallel' })),
        toolCall('b', 'lane', JSON.stringify({ id: 'b', lane: 'parallel' })),
        toolCall('c', 'lane', JSON.stringify({ id: 'c', lane: 'exclusive' })),
      ],
      signal,
    }, new ToolExecutionPipeline(ctx.tools), () => 2)
    await until(() => started.includes('a') && started.includes('b'))
    expect(started).not.toContain('c')
    release.get('a')?.()
    release.get('b')?.()
    await until(() => started.includes('c'))
    release.get('c')?.()
    const batch = await pending
    expect(started).toEqual(['a', 'b', 'c'])
    expect(batch.results.map(item => item.callId)).toEqual(['a', 'b', 'c'])
    expect(batch.results.every(item => ! item.result.isError)).toBe(true)
  })

  it('does not start a later call when pre-execute aborts the batch', async () => {
    const ctx = await toolsOf()
    const started: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: { id: { type: 'string', required: true } },
      async execute(args) { started.push(args.id); return [{ type: 'text', text: args.id }] },
    }))
    const controller = new AbortController()
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.callId === ToolCallId('first')) controller.abort()
      return next()
    })
    const batch = await executeToolBatch({
      calls: [
        toolCall('first', 'echo', JSON.stringify({ id: 'first' })),
        toolCall('second', 'echo', JSON.stringify({ id: 'second' })),
      ],
      signal: controller.signal,
    }, new ToolExecutionPipeline(ctx.tools), () => 1)
    expect(started).toEqual([])
    expect(batch.results).toHaveLength(2)
    for (const item of batch.results) {
      expect(item.result.isError).toBe(true)
      if (item.result.isError) expect(item.result.error.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
    }
  })

  it('drains a started body and skips the calls that have not started', async () => {
    const ctx = await toolsOf()
    const started: string[] = []
    const release = new Map<string, () => void>()
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: { id: { type: 'string', required: true } },
      async execute(args) {
        started.push(args.id)
        await new Promise<void>((resolve) => { release.set(args.id, resolve) })
        return [{ type: 'text', text: args.id }]
      },
    }))
    const controller = new AbortController()
    const pending = executeToolBatch({
      calls: [
        toolCall('first', 'echo', JSON.stringify({ id: 'first' })),
        toolCall('second', 'echo', JSON.stringify({ id: 'second' })),
      ],
      signal: controller.signal,
    }, new ToolExecutionPipeline(ctx.tools), () => 1)
    await until(() => started.includes('first'))
    controller.abort()
    release.get('first')?.()
    const batch = await pending
    expect(started).toEqual(['first'])
    expect(batch.results[0]?.result.isError).toBe(true)
    if (batch.results[0]?.result.isError) expect(batch.results[0].result.error.info?.code).toBe(TOOL_ABORTED)
    expect(batch.results[1]?.result.isError).toBe(true)
    if (batch.results[1]?.result.isError) {
      expect(batch.results[1].result.error.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
    }
  })

  it('drains a rejected dispatch and does not start the next call', async () => {
    const ctx = await toolsOf()
    const seen: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {}, async execute() { return [] },
    }))
    ctx.on('tools/pre-execute', async (exec, next) => {
      seen.push(exec.callId)
      return next()
    })
    const error = await executeToolBatch({
      calls: [toolCall('first', 'echo', '{}'), toolCall('second', 'echo', '{}')],
      signal,
    }, new RejectingDispatch(ctx.tools), () => 1).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ToolBatchExecutionError)
    if (error instanceof ToolBatchExecutionError) expect(error.cause).toEqual(new Error('dispatch failed'))
    expect(seen).toEqual(['first'])
  })

  it('records a denial and a listener failure without running the body', async () => {
    const denied = await toolsOf()
    const deniedCalls: string[] = []
    denied.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { deniedCalls.push('body'); return [] },
    }))
    denied.tools.guard(() => 'a question is waiting')
    const denial = await executeToolBatch({
      calls: [toolCall('deny', 'echo', '{}')],
      signal,
    }, new ToolExecutionPipeline(denied.tools), () => 1)
    expect(deniedCalls).toEqual([])
    expect(denial.results[0]?.result.isError).toBe(true)
    if (denial.results[0]?.result.isError) expect(denial.results[0].result.error.message).toContain('a question is waiting')

    const broken = await toolsOf()
    broken.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {}, async execute() { return [] },
    }))
    broken.on('tools/pre-execute', () => { throw new Error('pre failed') })
    const failure = await executeToolBatch({
      calls: [toolCall('pre', 'echo', '{}')],
      signal,
    }, new ToolExecutionPipeline(broken.tools), () => 1)
    expect(failure.results[0]?.result.isError).toBe(true)
    if (failure.results[0]?.result.isError) expect(failure.results[0].result.error.message).toContain('pre failed')
  })

  it('logs an error code and presentation metadata for a committed batch', async () => {
    const { ctx, agent } = await withAgent()
    ctx.tools.register(defineContentToolFixture({
      name: 'coded', description: 'coded', parameters: {},
      async execute() { throw new HarnessError('coded failure', 'CODED') },
    }))
    ctx.tools.register(defineTool({
      name: 'card',
      description: 'card',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'shown' }],
        presentationMeta: () => ({ card: true }),
      },
      async execute() { return 'shown' },
    }))
    await executeToolBatch({
      calls: [toolCall('coded', 'coded', '{}'), toolCall('card', 'card', '{}')],
      signal,
      agent,
      log: { turn: 1, step: 1 },
    }, new ToolExecutionPipeline(ctx.tools), () => 1)
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toMatchObject([
      { data: { error: { name: 'HarnessError', code: 'CODED' } } },
      { data: { meta: { card: true } } },
    ])
  })
})

describe('nested presentation and runtime event names', () => {
  it('keeps a nested conclusion after dropping presentation metadata', async () => {
    const ctx = await toolsOf()
    ctx.tools.register(defineTool({
      name: 'nested-card',
      description: 'nested card',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
        presentationMeta: () => ({ card: true }),
      },
      async execute(_args, exec) {
        exec.concludeTurn()
        return 'done'
      },
    }))
    const nested = await ctx.tools.execute({
      signal,
      callId: ToolCallId('nested'),
      name: 'nested-card',
      arguments: {},
      parent: Symbol('outer') as ToolExecutionToken,
    })
    expect(nested.meta).toBeUndefined()
    expect(nested.isError ? undefined : nested.concludesTurn).toBe(true)
  })

  it('uses only the abort line when a cancelled body produced no content', async () => {
    const ctx = await toolsOf()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<string>()
    ctx.tools.register(defineTool({
      name: 'blank',
      description: 'blank',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: () => [],
      },
      execute() {
        entered.resolve(undefined)
        return release.promise
      },
    }))
    const controller = new AbortController()
    const pending = ctx.tools.execute({
      signal: controller.signal, callId: ToolCallId('blank'), name: 'blank', arguments: {},
    })
    await entered.promise
    controller.abort()
    release.resolve('')
    await expect(pending).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: tool call aborted' }],
      error: { info: { code: TOOL_ABORTED } },
    })
  })

  it('names the notifications a registration and a call emit', async () => {
    const ctx = await toolsOf()
    const seen = new Set<string>()
    ctx.on('tools/change', () => { seen.add('tools/change') })
    ctx.on('tools/pre-execute', async (_exec, next) => { seen.add('tools/pre-execute'); return next() })
    ctx.on('tools/execute', async (_exec, next) => { seen.add('tools/execute'); return next() })
    ctx.on('tools/post-execute', async (_exec, _result, next) => { seen.add('tools/post-execute'); return next() })
    ctx.on('tools/result', () => { seen.add('tools/result') })
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {}, async execute() { return [] },
    }))
    await ctx.tools.execute({ signal, callId: ToolCallId('events'), name: 'echo', arguments: {} })
    expect(seen).toEqual(new Set(TOOL_RUNTIME_EVENTS))
  })

  it('attaches deferred context from a nested success that also concludes', async () => {
    const ctx = await toolsOf()
    const note = createUserMessage({
      content: [{ type: 'text', text: 'nested note' }],
      source: { kind: 'user' },
    })
    ctx.tools.register(defineTool({
      name: 'nested-note',
      description: 'nested note',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
        presentationMeta: () => ({ card: true }),
      },
      async execute(_args, exec) {
        exec.deferContext(note)
        exec.concludeTurn()
        return 'done'
      },
    }))
    const nested = await ctx.tools.execute({
      signal,
      callId: ToolCallId('nested-note'),
      name: 'nested-note',
      arguments: {},
      parent: Symbol('outer') as ToolExecutionToken,
    })
    expect(nested.meta).toBeUndefined()
    expect(nested.additionalContexts).toEqual([note])
    expect(nested.isError ? undefined : nested.concludesTurn).toBe(true)
  })
})
