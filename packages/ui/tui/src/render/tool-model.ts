/** Tool-owned presentation projection for terminal cards. @module @deepseek-ai/dsh-tui/render/tool-model */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  FileDiff,
  ToolCallView,
  ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { displayText, type DisplayText, type DisplayTextBudget } from '../transcript/display-text.ts'
import type { ProjectedTranscriptRow } from '../transcript/project.ts'

type ToolRow = Extract<ProjectedTranscriptRow, { kind: 'tool-call' | 'tool-result' }>

/** One safe diff entry ready for terminal rendering. */
export interface ToolDiffModel {
  readonly path: DisplayText
  readonly oldText: DisplayText | null
  readonly newText: DisplayText
}

/** One safe numbered read line. */
export interface ToolReadLineModel {
  readonly number: number
  readonly text: DisplayText
}

/** Framework-free terminal card content selected from a tool presentation intent. */
export type ToolCardDetail =
  | { readonly card: 'generic'; readonly content: readonly DisplayText[] }
  | {
    readonly card: 'terminal'
    readonly command: DisplayText | undefined
    readonly description: DisplayText | undefined
    readonly cwd: DisplayText | undefined
    readonly output: DisplayText | undefined
    readonly exit: DisplayText | undefined
  }
  | { readonly card: 'diff'; readonly diffs: readonly ToolDiffModel[] }
  | {
    readonly card: 'read'
    readonly path: DisplayText
    readonly lines: readonly ToolReadLineModel[]
    readonly totalLines: number
    readonly offset: number
    readonly lang: DisplayText | undefined
  }
  | {
    readonly card: 'search'
    readonly summary: DisplayText
    readonly rows: readonly DisplayText[]
  }
  | {
    readonly card: 'web'
    readonly summary: DisplayText
    readonly rows: readonly DisplayText[]
  }

/** Complete safe presentation for one durable tool call or result row. */
export interface ToolCardModel {
  readonly callId: string
  readonly name: DisplayText
  readonly title: DisplayText
  readonly phase: 'call' | 'result'
  readonly isError: boolean
  readonly detail: ToolCardDetail
}

function text(value: string, budget: DisplayTextBudget): DisplayText {
  return displayText(value, budget)
}

function contentText(content: readonly ContentBlock[]): string[] {
  const values: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        values.push(block.text)
        break
      case 'image':
        values.push('[image]')
        break
      case 'tool-call':
        values.push(`${block.name} ${block.arguments}`)
        break
      case 'tool-result':
        values.push(...contentText(block.content))
        break
    }
  }
  return values
}

function safeContent(content: readonly ContentBlock[], budget: DisplayTextBudget): DisplayText[] {
  return contentText(content).map(value => text(value, budget))
}

function safeJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized: unknown = JSON.stringify(value, null, 2)
    return typeof serialized === 'string' ? serialized : String(value)
  } catch {
    return String(value)
  }
}

function safeDiffs(diffs: readonly FileDiff[], budget: DisplayTextBudget): ToolDiffModel[] {
  return diffs.map(diff => ({
    path: text(diff.path, budget),
    oldText: diff.oldText === null ? null : text(diff.oldText, budget),
    newText: text(diff.newText, budget),
  }))
}

function fallback(
  row: ToolRow,
  budget: DisplayTextBudget,
  parsedArguments: unknown,
): ToolCardModel {
  const content = row.kind === 'tool-call'
    ? [text(parsedArguments === undefined ? row.arguments : safeJson(parsedArguments), budget)]
    : [row.text]
  return {
    callId: row.callId,
    name: text(row.name === '' ? 'unknown tool' : row.name, budget),
    title: text(row.name === '' ? 'Unknown tool' : row.name, budget),
    phase: row.kind === 'tool-call' ? 'call' : 'result',
    isError: row.kind === 'tool-result' && row.isError,
    detail: { card: 'generic', content },
  }
}

function titleOf(view: ToolCallView | undefined, row: ToolRow): string {
  if (view === undefined || typeof view !== 'object' || !('title' in view)) return row.name
  return typeof view.title === 'string' ? view.title : row.name
}

function callModel(
  row: ToolRow,
  view: ToolCallView,
  budget: DisplayTextBudget,
): ToolCardModel | undefined {
  const base = {
    callId: row.callId,
    name: text(row.name, budget),
    title: text(titleOf(view, row), budget),
    phase: 'call' as const,
    isError: false,
  }
  switch (view.card) {
    case 'generic': {
      const content = [
        ...view.rawInput === undefined ? [] : [text(safeJson(view.rawInput), budget)],
        ...view.content === undefined ? [] : safeContent(view.content, budget),
      ]
      return { ...base, detail: { card: 'generic', content } }
    }
    case 'terminal':
      return {
        ...base,
        detail: {
          card: 'terminal', command: text(view.title, budget),
          description: view.description === undefined ? undefined : text(view.description, budget),
          cwd: view.cwd === undefined ? undefined : text(view.cwd, budget),
          output: undefined, exit: undefined,
        },
      }
    case 'diff':
      return { ...base, detail: { card: 'diff', diffs: safeDiffs(view.diffs, budget) } }
    default:
      return undefined
  }
}

function resultModel(
  row: Extract<ToolRow, { kind: 'tool-result' }>,
  callView: ToolCallView | undefined,
  view: ToolResultView,
  budget: DisplayTextBudget,
): ToolCardModel | undefined {
  const resultTitle = 'title' in view && typeof view.title === 'string'
    ? view.title
    : titleOf(callView, row)
  const base = {
    callId: row.callId,
    name: text(row.name, budget),
    title: text(resultTitle, budget),
    phase: 'result' as const,
    isError: row.isError,
  }
  switch (view.card) {
    case 'generic':
      return {
        ...base,
        detail: {
          card: 'generic',
          content: view.content === undefined ? [row.text] : safeContent(view.content, budget),
        },
      }
    case 'terminal': {
      const terminalCall = callView?.card === 'terminal' ? callView : undefined
      const exit = view.exitCode === undefined
        ? view.signal === undefined ? undefined : text(`signal ${view.signal}`, budget)
        : text(`exit ${view.exitCode}`, budget)
      return {
        ...base,
        detail: {
          card: 'terminal',
          command: terminalCall === undefined ? undefined : text(terminalCall.title, budget),
          description: terminalCall?.description === undefined ? undefined : text(terminalCall.description, budget),
          cwd: terminalCall?.cwd === undefined ? undefined : text(terminalCall.cwd, budget),
          output: view.output === undefined ? undefined : text(view.output, budget),
          exit,
        },
      }
    }
    case 'diff':
      return { ...base, detail: { card: 'diff', diffs: safeDiffs(view.diffs, budget) } }
    case 'read':
      return {
        ...base,
        detail: {
          card: 'read', path: text(view.path, budget), offset: view.offset,
          lines: view.lines.map(line => ({ number: line.number, text: text(line.text, budget) })),
          totalLines: view.totalLines,
          lang: view.lang === undefined ? undefined : text(view.lang, budget),
        },
      }
    case 'search':
      if (view.shape === 'matches') {
        return {
          ...base,
          detail: {
            card: 'search',
            summary: text(`${view.total} ${view.total === 1 ? 'match' : 'matches'}${view.truncated ? ' · truncated' : ''}`, budget),
            rows: view.files.flatMap(file => [
              text(file.path, budget),
              ...file.matches.map(match => text(`${match.lineNumber} │ ${match.line}`, budget)),
            ]),
          },
        }
      }
      return {
        ...base,
        detail: {
          card: 'search',
          summary: text(`${view.paths.length} of ${view.total} paths${view.truncated ? ' · truncated' : ''}`, budget),
          rows: view.paths.map(path => text(path, budget)),
        },
      }
    case 'web':
      if (view.kind === 'search') {
        return {
          ...base,
          detail: {
            card: 'web',
            summary: text(`${view.sources.length} web ${view.sources.length === 1 ? 'source' : 'sources'}${view.truncated ? ' · truncated' : ''}`, budget),
            rows: [
              ...view.answer === undefined ? [] : [text(view.answer, budget)],
              ...view.sources.map(source => text(`${source.title ?? source.url} · ${source.url}`, budget)),
            ],
          },
        }
      }
      return {
        ...base,
        detail: {
          card: 'web',
          summary: text(`HTTP ${view.statusCode}${view.truncated ? ' · truncated' : ''}`, budget),
          rows: [text(view.url, budget)],
        },
      }
    default:
      return undefined
  }
}

/**
 * Resolve and invoke only one tool's pure presentation methods for a durable row.
 * @param ctx - context carrying the scoped tool registry.
 * @param agent - exact Agent whose visible definition produced the row.
 * @param row - paired durable call or result projection.
 * @param budget - display limits applied to every untrusted visible field.
 * @returns a safe known card or generic fallback; tool execution is never invoked.
 */
export function projectToolCard(
  ctx: Context,
  agent: Agent,
  row: ToolRow,
  budget: DisplayTextBudget,
): ToolCardModel {
  let parsedArguments: unknown
  try {
    parsedArguments = JSON.parse(row.arguments) as unknown
  } catch {
    return fallback(row, budget, undefined)
  }
  const definition = ctx.tools.get(row.name, agent)
  if (definition === undefined) return fallback(row, budget, parsedArguments)
  let callView: ToolCallView | undefined
  try {
    callView = definition.presentCall?.(parsedArguments)
  } catch {
    return fallback(row, budget, parsedArguments)
  }
  if (row.kind === 'tool-call') {
    return callView === undefined
      ? fallback(row, budget, parsedArguments)
      : callModel(row, callView, budget) ?? fallback(row, budget, parsedArguments)
  }
  let resultView: ToolResultView | undefined
  try {
    resultView = definition.presentResult?.(parsedArguments, {
      content: [...row.content], isError: row.isError,
      ...(row.meta === undefined ? {} : { meta: row.meta }),
    })
  } catch {
    return fallback(row, budget, parsedArguments)
  }
  return resultView === undefined
    ? fallback(row, budget, parsedArguments)
    : resultModel(row, callView, resultView, budget) ?? fallback(row, budget, parsedArguments)
}
