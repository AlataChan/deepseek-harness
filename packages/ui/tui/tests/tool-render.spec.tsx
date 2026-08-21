import { renderToString } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  type ToolCallView,
  type ToolDefinition,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { ToolCard } from '../src/render/tool.tsx'
import { projectToolCard } from '../src/render/tool-model.ts'
import type { ProjectedTranscriptRow } from '../src/transcript/project.ts'

const agent = {} as Agent
const budget = { maxBytes: 1_024, maxColumns: 1_024 }

type ToolRow = Extract<ProjectedTranscriptRow, { kind: 'tool-call' | 'tool-result' }>

function definition(
  name: string,
  execute: ReturnType<typeof vi.fn>,
  presentCall?: (args: unknown) => ToolCallView | undefined,
  presentResult?: (args: unknown) => ToolResultView | undefined,
): ToolDefinition {
  return {
    name,
    description: `${name} fixture`,
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'null' }, render: () => [] },
    execute,
    ...(presentCall === undefined ? {} : { presentCall }),
    ...(presentResult === undefined ? {} : {
      presentResult: args => presentResult(args),
    }),
  }
}

function callRow(name: string, argumentsText = '{}', sourceSeq = 1): ToolRow {
  return { kind: 'tool-call', sourceSeq, callId: `call-${sourceSeq}`, name, arguments: argumentsText }
}

function resultRow(
  name: string,
  content: readonly ContentBlock[] = [{ type: 'text', text: 'raw result' }],
  argumentsText = '{}',
  sourceSeq = 2,
): ToolRow {
  return {
    kind: 'tool-result', sourceSeq, callId: `call-${sourceSeq}`, name,
    arguments: argumentsText, text: 'raw result' as never, content,
    isError: false, error: undefined, meta: undefined,
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const execute = vi.fn(async () => null)
  return { ctx, execute }
}

function output(model: ReturnType<typeof projectToolCard>): string {
  return renderToString(<ToolCard model={model} />, { columns: 120 })
}

describe('tool call card projection', () => {
  it('keeps the call-side generic, terminal, and diff variants distinct', async () => {
    const test = await bench()
    test.ctx.tools.register(definition('generic', test.execute, () => ({
      card: 'generic', title: 'Search files', kind: 'search', rawInput: { query: 'needle' },
    })))
    test.ctx.tools.register(definition('terminal', test.execute, () => ({
      card: 'terminal', title: 'pwd', description: 'Print directory', cwd: '/workspace',
    })))
    test.ctx.tools.register(definition('diff', test.execute, () => ({
      card: 'diff', title: 'Edit file', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }],
    })))

    expect(output(projectToolCard(test.ctx, agent, callRow('generic'), budget)))
      .toContain('Search files')
    expect(output(projectToolCard(test.ctx, agent, callRow('terminal'), budget)))
      .toContain('$ pwd')
    const diff = output(projectToolCard(test.ctx, agent, callRow('diff'), budget))
    expect(diff).toContain('@@')
    expect(diff).toContain('-old')
    expect(diff).toContain('+new')
    expect(test.execute).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })
})

describe('tool result card projection', () => {
  it('renders generic, terminal, diff, read, search, and web result variants', async () => {
    const test = await bench()
    const views: Record<string, ToolResultView> = {
      generic: { card: 'generic', title: 'Generic result', content: [{ type: 'text', text: 'done' }] },
      terminal: { card: 'terminal', output: 'line one\nline two', exitCode: 3 },
      diff: { card: 'diff', title: 'Applied edit', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] },
      read: { card: 'read', path: 'a.ts', offset: 3, lines: [{ number: 3, text: 'const a = 1' }], totalLines: 8, lang: 'ts' },
      searchMatches: { card: 'search', shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 3, line: 'needle' }] }], truncated: false, total: 1 },
      searchPaths: { card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: true, total: 5 },
      webSearch: { card: 'web', kind: 'search', sources: [{ title: 'Example', url: 'https://example.test' }], answer: 'answer', truncated: false },
      webFetch: { card: 'web', kind: 'fetch', url: 'https://example.test/page', statusCode: 200, truncated: true },
    }
    for (const [name, view] of Object.entries(views)) {
      test.ctx.tools.register(definition(name, test.execute, () => ({ card: 'generic', title: name }), () => view))
    }

    expect(output(projectToolCard(test.ctx, agent, resultRow('generic'), budget))).toContain('done')
    expect(output(projectToolCard(test.ctx, agent, resultRow('terminal'), budget))).toContain('exit 3')
    expect(output(projectToolCard(test.ctx, agent, resultRow('diff'), budget))).toContain('@@')
    expect(output(projectToolCard(test.ctx, agent, resultRow('read'), budget))).toContain('3 │ const a = 1')
    expect(output(projectToolCard(test.ctx, agent, resultRow('searchMatches'), budget))).toContain('1 match')
    expect(output(projectToolCard(test.ctx, agent, resultRow('searchPaths'), budget))).toContain('2 of 5 paths')
    expect(output(projectToolCard(test.ctx, agent, resultRow('webSearch'), budget))).toContain('Example · https://example.test')
    expect(output(projectToolCard(test.ctx, agent, resultRow('webFetch'), budget))).toContain('HTTP 200')
    expect(test.execute).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('falls back safely for missing definitions, absent presenters, rejected arguments, and future cards', async () => {
    const test = await bench()
    test.ctx.tools.register(definition('absent', test.execute))
    test.ctx.tools.register(definition('rejecting', test.execute, args => (
      typeof args === 'object' && args !== null && 'accepted' in args
        ? { card: 'generic', title: 'accepted' }
        : undefined
    )))
    test.ctx.tools.register(definition('future', test.execute, undefined, () => (
      { card: 'chart', title: 'unsafe future' } as unknown as ToolResultView
    )))

    expect(output(projectToolCard(test.ctx, agent, callRow('missing', '{"x":1}'), budget)))
      .toContain('missing')
    expect(output(projectToolCard(test.ctx, agent, callRow('absent'), budget)))
      .toContain('{}')
    expect(output(projectToolCard(test.ctx, agent, callRow('rejecting', '{"wrong":true}'), budget)))
      .toContain('wrong')
    expect(output(projectToolCard(test.ctx, agent, callRow('rejecting', '{broken'), budget)))
      .toContain('{broken')
    expect(output(projectToolCard(test.ctx, agent, resultRow('future'), budget)))
      .toContain('raw result')
    expect(test.execute).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('bounds and sanitizes terminal output before rendering', async () => {
    const test = await bench()
    test.ctx.tools.register(definition('terminal', test.execute, undefined, () => ({
      card: 'terminal', output: '\u001B]0;owned\u0007abcdefghijklmno', exitCode: 0,
    })))
    const rendered = output(projectToolCard(test.ctx, agent, resultRow('terminal'), {
      maxBytes: 24, maxColumns: 24,
    }))

    expect(rendered).not.toContain('\u001B')
    expect(rendered).toContain('…')
    expect(rendered).toContain('exit 0')
    await test.ctx.fiber.dispose()
  })
})
