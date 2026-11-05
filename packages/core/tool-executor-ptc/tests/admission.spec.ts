/** PTC batch admission for a nested call under a captured step tool set. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import ToolRuntime, { RUN_CODE_NAME, defineTool, type ResolvedToolSet, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc'

class FakeRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: PtcRunRequest) => Promise<PtcRunResult> = () => Promise.resolve({ logs: [] })

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }

  run(request: PtcRunSpec): Promise<PtcRunResult> {
    return this.behavior(request)
  }
}

function bindingLog(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function echo(label: string, calls: string[]): ToolDefinition {
  return defineTool({
    name: 'echo',
    description: label,
    parameters: { value: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      calls.push(label)
      return Promise.resolve(`${label}:${args.value}`)
    },
  })
}

describe('PTC nested admission', () => {
  it('runs an admitted nested tool through the executor', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(FakeRuntime)
    const runtime = ctx.ptcRuntime as FakeRuntime
    const calls: string[] = []
    ctx.tools.register(echo('body', calls))
    runtime.behavior = async (request) => {
      const binding = request.bindings[0]?.functions.echo
      if (binding === undefined) return { logs: ['unbound'] }
      return { logs: [bindingLog(await binding({ value: 'x' }))] }
    }
    const batch = await new PtcExecutor(ctx).execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('c1'),
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code: 'await tools.echo({ value: "x" })', description: 'nested' }),
      }],
      signal: new AbortController().signal,
    })
    expect(calls).toEqual(['body'])
    expect(batch.results[0]?.result.isError).toBe(false)
  })

  it('does not run a nested body after the admitted definition was replaced', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(FakeRuntime)
    const runtime = ctx.ptcRuntime as FakeRuntime
    const calls: string[] = []
    const admitted = echo('old', calls)
    const remove = ctx.tools.register(admitted)
    const toolSet: ResolvedToolSet = {
      dispose() {},
      view: () => new Map([['echo', admitted]]),
    }
    remove()
    ctx.tools.register(echo('new', calls))
    runtime.behavior = async (request) => {
      const binding = request.bindings[0]?.functions.echo
      if (binding === undefined) return { logs: ['unbound'] }
      try {
        return { logs: [bindingLog(await binding({ value: 'x' }))] }
      } catch (error: unknown) {
        return { logs: [error instanceof Error ? error.message : 'failed'] }
      }
    }
    const executor = new PtcExecutor(ctx)
    ctx.tools.setExecutor(executor)
    const batch = await executor.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('c1'),
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code: 'await tools.echo({ value: "x" })', description: 'nested' }),
      }],
      signal: new AbortController().signal,
      toolSet,
    })
    expect(calls).toEqual([])
    const nested = batch.results[0]?.result
    expect(nested?.isError).toBe(false)
    if (nested !== undefined && !nested.isError) {
      expect(JSON.stringify(nested.value)).toContain('unknown tool')
    }
  })

  it('does not run a nested body a guard denied', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(FakeRuntime)
    const runtime = ctx.ptcRuntime as FakeRuntime
    const calls: string[] = []
    ctx.tools.register(echo('body', calls))
    ctx.tools.guard(exec => exec.name === 'echo' ? 'a question is waiting' : undefined)
    runtime.behavior = async (request) => {
      const binding = request.bindings[0]?.functions.echo
      if (binding === undefined) return { logs: ['unbound'] }
      try {
        return { logs: [bindingLog(await binding({ value: 'x' }))] }
      } catch (error: unknown) {
        return { logs: [error instanceof Error ? error.message : 'failed'] }
      }
    }
    const batch = await new PtcExecutor(ctx).execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('c1'),
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code: 'await tools.echo({ value: "x" })', description: 'guarded' }),
      }],
      signal: new AbortController().signal,
    })
    expect(calls).toEqual([])
    const guarded = batch.results[0]?.result
    expect(guarded?.isError).toBe(false)
    if (guarded !== undefined && !guarded.isError) {
      expect(JSON.stringify(guarded.value)).toContain('a question is waiting')
    }
  })

  it('applies a nondefault executor subcall limit to nested bindings', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc', maxParallelSubCalls: 4 })
    await ctx.plugin(FakeRuntime)
    const runtime = ctx.ptcRuntime as FakeRuntime
    let releaseLeft: () => void = () => {}
    const hold = new Promise<void>((resolve) => { releaseLeft = resolve })
    let markLeft: () => void = () => {}
    const leftStarted = new Promise<void>((resolve) => { markLeft = resolve })
    const order: string[] = []
    const lane = (name: 'left' | 'right'): ToolDefinition => defineTool({
      name,
      description: name,
      parameters: {},
      isConcurrencySafe: () => true,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        order.push(`${name}:start`)
        if (name === 'left') {
          markLeft()
          await hold
        }
        order.push(`${name}:end`)
        return name
      },
    })
    ctx.tools.register(lane('left'))
    ctx.tools.register(lane('right'))
    runtime.behavior = async (request) => {
      const functions = request.bindings[0]?.functions
      const left = functions?.left
      const right = functions?.right
      if (left === undefined || right === undefined) return { logs: ['unbound'] }
      const pending = Promise.all([left({}), right({})])
      await leftStarted
      if (order.includes('right:start')) return { logs: ['overlapped'] }
      releaseLeft()
      await pending
      return { logs: [...order] }
    }
    const executor = new PtcExecutor(ctx, { maxParallelSubCalls: 1 })
    const release = ctx.tools.setExecutor(executor)
    const batch = await executor.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('c1'),
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code: 'await Promise.all([tools.left({}), tools.right({})])', description: 'limit' }),
      }],
      signal: new AbortController().signal,
    })
    const limited = batch.results[0]?.result
    expect(limited?.isError).toBe(false)
    if (limited !== undefined && !limited.isError) {
      expect(JSON.stringify(limited.value)).not.toContain('overlapped')
      expect(JSON.stringify(limited.value)).toContain('left:start')
      expect(JSON.stringify(limited.value)).toContain('right:end')
    }
    expect(order).toEqual(['left:start', 'left:end', 'right:start', 'right:end'])
    await release()
  })
})
