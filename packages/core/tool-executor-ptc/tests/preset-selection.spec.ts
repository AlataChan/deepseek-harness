/** PTC preset selection, unload, and the shipped web preset row. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import ToolRuntime, { RUN_CODE_NAME, ToolExecutorUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import * as PtcToolExecutor from '@deepseek-ai/dsh-tool-executor-ptc'

class FakeRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }

  run(): Promise<PtcRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

describe('PTC preset executor selection', () => {
  it('selects the executor in its scope and refuses that scope after unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeRuntime)
    let ran = false
    ctx.tools.register(defineTool({
      name: 'echo',
      description: 'echo',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute() {
        ran = true
        return Promise.resolve('native')
      },
    }))
    const key: ScopeKey = {}
    const scope = createScope(ctx, key)
    const fiber = await scope.ctx.plugin(PtcToolExecutor)
    expect(ctx.tools.selectedExecutor(key)).toBeDefined()
    expect(ctx.tools.selectedExecutor()).toBeUndefined()
    const prompt = await ctx.systemPrompt.assemble({ scope: key })
    expect(prompt.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    await fiber.dispose()
    expect(() => ctx.tools.selectedExecutor(key)).toThrow(ToolExecutorUnavailableError)
    await expect(ctx.systemPrompt.assemble({ scope: key })).rejects.toThrow(ToolExecutorUnavailableError)
    const native = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('native'),
      name: 'echo',
      arguments: {},
    })
    expect(native.isError).toBe(false)
    expect(ran).toBe(true)
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it.each(['native', 'both'] as const)('rejects a root executor when tools.mode is %s', async (mode) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, mode === 'native' ? {} : { mode })
    await ctx.plugin(FakeRuntime)
    await expect(ctx.plugin(PtcToolExecutor)).rejects.toThrow('tools.mode "ptc"')
    expect(ctx.tools.selectedExecutor()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('selects the executor on a root tools row that is already ptc', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(FakeRuntime)
    await ctx.plugin(PtcToolExecutor)
    expect(ctx.tools.selectedExecutor()).toBeDefined()
    const prompt = await ctx.systemPrompt.assemble({})
    expect(prompt.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    await ctx.fiber.dispose()
  })

  it('keeps two preset subcall caps isolated and clears only the unloaded scope', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeRuntime)
    const leftKey: ScopeKey = {}
    const rightKey: ScopeKey = {}
    const left = createScope(ctx, leftKey)
    const right = createScope(ctx, rightKey)
    const leftFiber = await left.ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 2 })
    const rightFiber = await right.ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 4 })
    expect(ctx.tools.nestedSubcallLimit(leftKey)).toBe(2)
    expect(ctx.tools.nestedSubcallLimit(rightKey)).toBe(4)
    expect(ctx.tools.nestedSubcallLimit()).toBe(10)
    await leftFiber.dispose()
    expect(() => ctx.tools.selectedExecutor(leftKey)).toThrow(ToolExecutorUnavailableError)
    expect(ctx.tools.nestedSubcallLimit(leftKey)).toBe(10)
    expect(ctx.tools.nestedSubcallLimit(rightKey)).toBe(4)
    expect(ctx.tools.selectedExecutor(rightKey)).toBeDefined()
    await rightFiber.dispose()
    await left.dispose()
    await right.dispose()
    await ctx.fiber.dispose()
  })

  it('does not clear an equal cap in another scope, and root unload does not fall through', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(FakeRuntime)
    const rootFiber = await ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 3 })
    const key: ScopeKey = {}
    const scope = createScope(ctx, key)
    const scoped = await scope.ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 3 })
    expect(ctx.tools.nestedSubcallLimit()).toBe(3)
    expect(ctx.tools.nestedSubcallLimit(key)).toBe(3)
    await scoped.dispose()
    expect(() => ctx.tools.selectedExecutor(key)).toThrow(ToolExecutorUnavailableError)
    expect(ctx.tools.nestedSubcallLimit()).toBe(3)
    expect(ctx.tools.selectedExecutor()).toBeDefined()
    await rootFiber.dispose()
    expect(() => ctx.tools.selectedExecutor()).toThrow(ToolExecutorUnavailableError)
    expect(ctx.tools.nestedSubcallLimit()).toBe(10)
    expect(ctx.tools.nestedSubcallLimit(key)).toBe(10)
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the incumbent cap when the same scope rejects a second executor', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(FakeRuntime)
    const rootFiber = await ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 2 })
    await expect(ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 7 })).rejects.toThrow('Only one tool executor')
    expect(ctx.tools.nestedSubcallLimit()).toBe(2)
    const key: ScopeKey = {}
    const scope = createScope(ctx, key)
    const scoped = await scope.ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 4 })
    await expect(scope.ctx.plugin(PtcToolExecutor, { maxParallelSubCalls: 9 })).rejects.toThrow(/Only one tool executor|already declared/)
    expect(ctx.tools.nestedSubcallLimit(key)).toBe(4)
    expect(ctx.tools.nestedSubcallLimit()).toBe(2)
    await scoped.dispose()
    expect(ctx.tools.nestedSubcallLimit(key)).toBe(2)
    expect(ctx.tools.selectedExecutor()).toBeDefined()
    await rootFiber.dispose()
    expect(ctx.tools.nestedSubcallLimit()).toBe(10)
    expect(ctx.tools.nestedSubcallLimit(key)).toBe(10)
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('ships the web ptc preset on the executor row and keeps the fork goal row', () => {
    const source = readFileSync(new URL('../../../bundle/web-app/presets/ptc.patch.yml', import.meta.url), 'utf8')
    expect(source).toContain("name: '@deepseek-ai/dsh-tool-executor-ptc'")
    expect(source).not.toContain('@deepseek-ai/dsh-agent-tool-presentation')
    expect(source).toContain("name: '@deepseek-ai/dsh-command-goal'")
  })
})
