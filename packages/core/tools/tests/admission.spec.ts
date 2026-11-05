/** Step admission: a definition that is no longer the captured one does not run. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  TOOL_ABORTED_BEFORE_DISPATCH,
  ToolExecutorUnavailableError,
  defineContentToolFixture,
  type ResolvedToolSet,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc'

const signal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function echo(name: string, calls: string[], label: string): ToolDefinition {
  return defineContentToolFixture({
    name,
    description: label,
    parameters: {},
    async execute() {
      calls.push(label)
      return []
    },
  })
}

describe('step admission', () => {
  it('does not run a tool that replaced the admitted definition', async () => {
    const ctx = await setup()
    const calls: string[] = []
    const admitted = echo('echo', calls, 'old')
    const remove = ctx.tools.register(admitted)
    const toolSet: ResolvedToolSet = {
      dispose() {},
      view: () => new Map([['echo', admitted]]),
    }
    remove()
    ctx.tools.register(echo('echo', calls, 'new'))
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('c1'), name: 'echo', arguments: {}, toolSet,
    })
    expect(calls).toEqual([])
    expect(result.isError).toBe(true)
  })

  it('does not run a body a guard has denied', async () => {
    const ctx = await setup()
    const calls: string[] = []
    ctx.tools.guard(() => 'a question is waiting')
    ctx.tools.register(echo('echo', calls, 'body'))
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('c1'), name: 'echo', arguments: {},
    })
    expect(calls).toEqual([])
    expect(result.isError).toBe(true)
    if (result.isError) expect(result.error.message).toContain('a question is waiting')
  })

  it('does not run a model-direct tool body through the PTC executor', async () => {
    const ctx = await setup()
    const calls: string[] = []
    ctx.tools.register(echo('echo', calls, 'body'))
    const executor = new PtcExecutor(ctx)
    ctx.tools.setExecutor(executor)
    const batch = await executor.execute({
      calls: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'echo', arguments: '{}' }],
      signal,
    })
    expect(calls).toEqual([])
    expect(batch.results[0]?.result.isError).toBe(true)
    if (batch.results[0]?.result.isError) {
      expect(batch.results[0].result.error.message).toContain('callable directly')
    }
  })

  it('refuses every later call after the selected executor unloads', async () => {
    const ctx = await setup()
    const calls: string[] = []
    ctx.tools.register(echo('echo', calls, 'body'))
    const dispose = ctx.tools.setExecutor(new PtcExecutor(ctx))
    void dispose()
    expect(() => ctx.tools.selectedExecutor()).toThrow(ToolExecutorUnavailableError)
    await expect(ctx.tools.execute({
      signal, callId: ToolCallId('c1'), name: 'echo', arguments: {},
    })).rejects.toThrow(ToolExecutorUnavailableError)
    expect(calls).toEqual([])
  })

  it('records pre-dispatch cancellation and does not run the body', async () => {
    const ctx = await setup()
    const calls: string[] = []
    ctx.tools.register(echo('echo', calls, 'body'))
    const executor = new PtcExecutor(ctx)
    const controller = new AbortController()
    controller.abort()
    const batch = await executor.execute({
      calls: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'echo', arguments: '{}' }],
      signal: controller.signal,
    })
    expect(calls).toEqual([])
    const result = batch.results[0]?.result
    expect(result?.isError).toBe(true)
    if (result?.isError) expect(result.error.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
  })
})
