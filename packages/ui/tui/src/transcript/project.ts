/** Pure durable-event to terminal-transcript projection. @module @deepseek-ai/dsh-tui/transcript/project */

import type {} from '@deepseek-ai/dsh-commands'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import { displayText, type DisplayText, type DisplayTextBudget } from './display-text.ts'

/** One tool call retained until its durable result arrives. */
export interface TranscriptToolCall {
  readonly callId: string
  readonly name: string
  readonly arguments: string
}

/** A finalized terminal transcript row. */
export type ProjectedTranscriptRow =
  | {
    readonly kind: 'message'
    readonly sourceSeq: number
    readonly role: 'user' | 'assistant'
    readonly text: DisplayText
  }
  | { readonly kind: 'reasoning'; readonly sourceSeq: number; readonly text: DisplayText }
  | ({ readonly kind: 'tool-call'; readonly sourceSeq: number } & TranscriptToolCall)
  | ({
    readonly kind: 'tool-result'
    readonly sourceSeq: number
    readonly text: DisplayText
    readonly isError: boolean
    readonly error: { readonly name: string; readonly code: string } | undefined
    readonly meta: JsonValue | undefined
  } & TranscriptToolCall)
  | {
    readonly kind: 'command'
    readonly sourceSeq: number
    readonly commandId: string
    readonly phase: 'running' | 'success' | 'error'
    readonly name: DisplayText | undefined
    readonly text: DisplayText | undefined
  }
  | {
    readonly kind: 'retry'
    readonly sourceSeq: number
    readonly phase: 'waiting' | 'started'
    readonly retry: number
    readonly text: DisplayText
  }
  | { readonly kind: 'status'; readonly sourceSeq: number; readonly text: DisplayText }
  | { readonly kind: 'error'; readonly sourceSeq: number; readonly text: DisplayText; readonly code?: string }

/** Current turn state derived from durable boundaries. */
export type TranscriptTurn =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly turn: number }

/** Complete pure transcript projection for live folding or replay. */
export interface TranscriptProjection {
  readonly rows: readonly ProjectedTranscriptRow[]
  readonly liveAssistant: DisplayText | undefined
  readonly liveReasoning: DisplayText | undefined
  readonly turn: TranscriptTurn
  readonly toolCalls: ReadonlyMap<string, TranscriptToolCall>
  readonly commands: ReadonlyMap<string, DisplayText>
}

/** Create an empty transcript projection. */
export function createTranscriptProjection(): TranscriptProjection {
  return {
    rows: [],
    liveAssistant: undefined,
    liveReasoning: undefined,
    turn: { kind: 'idle' },
    toolCalls: new Map(),
    commands: new Map(),
  }
}

function appendRows(
  state: TranscriptProjection,
  rows: readonly ProjectedTranscriptRow[],
): TranscriptProjection {
  return rows.length === 0 ? state : { ...state, rows: [...state.rows, ...rows] }
}

function contentText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'tool-result':
        parts.push(contentText(block.content))
        break
      case 'image':
        parts.push('[image]')
        break
      case 'reasoning':
      case 'tool-call':
        break
      default:
        break
    }
  }
  return parts.filter(Boolean).join('\n')
}

function messageRows(
  event: SessionEvent<'assistant/message'>,
  budget: DisplayTextBudget,
): ProjectedTranscriptRow[] {
  const rows: ProjectedTranscriptRow[] = []
  for (const block of event.data.message.content) {
    switch (block.type) {
      case 'reasoning':
        if (block.text !== '') {
          rows.push({ kind: 'reasoning', sourceSeq: event.seq, text: displayText(block.text, budget) })
        }
        break
      case 'text':
        if (block.text !== '') {
          rows.push({ kind: 'message', sourceSeq: event.seq, role: 'assistant', text: displayText(block.text, budget) })
        }
        break
      case 'image':
      case 'tool-call':
      case 'tool-result':
        break
      default:
        break
    }
  }
  return rows
}

function turnEndRow(
  event: SessionEvent<'turn/end'>,
  budget: DisplayTextBudget,
): ProjectedTranscriptRow | undefined {
  const reason = event.data.reason
  switch (reason.kind) {
    case 'completed':
      return undefined
    case 'aborted':
      return { kind: 'status', sourceSeq: event.seq, text: displayText('Turn cancelled.', budget) }
    case 'blocked':
      return { kind: 'status', sourceSeq: event.seq, text: displayText('Turn blocked.', budget) }
    case 'max-tokens':
      return { kind: 'status', sourceSeq: event.seq, text: displayText('Turn reached the output-token limit.', budget) }
    case 'interrupted':
      return { kind: 'status', sourceSeq: event.seq, text: displayText('Turn was interrupted.', budget) }
    case 'error':
      return {
        kind: 'error',
        sourceSeq: event.seq,
        text: displayText(reason.error.message, budget),
        code: reason.error.code,
      }
    default:
      return undefined
  }
}

/**
 * Fold one committed durable event into terminal projection state.
 * @param state - previous pure projection.
 * @param event - committed session event.
 * @param budget - display limits applied to every visible external string.
 * @returns the next projection; unknown merge-extensible events contribute no row.
 */
export function foldSessionEvent(
  state: TranscriptProjection,
  event: SessionEvent,
  budget: DisplayTextBudget,
): TranscriptProjection {
  switch (event.type) {
    case 'turn/start':
      return { ...state, turn: { kind: 'running', turn: event.data.turn } }
    case 'turn/end': {
      const row = turnEndRow(event, budget)
      return {
        ...state,
        rows: row === undefined ? state.rows : [...state.rows, row],
        turn: { kind: 'idle' },
        liveAssistant: undefined,
        liveReasoning: undefined,
      }
    }
    case 'user/message': {
      const text = contentText(event.data.content)
      return text === '' ? state : appendRows(state, [{
        kind: 'message', sourceSeq: event.seq, role: 'user', text: displayText(text, budget),
      }])
    }
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        return {
          ...state,
          liveAssistant: displayText(`${state.liveAssistant ?? ''}${chunk.text}`, budget),
        }
      }
      if (chunk.type === 'reasoning-delta') {
        return {
          ...state,
          liveReasoning: displayText(`${state.liveReasoning ?? ''}${chunk.text}`, budget),
        }
      }
      return state
    }
    case 'assistant/message':
      return {
        ...appendRows(state, messageRows(event, budget)),
        liveAssistant: undefined,
        liveReasoning: undefined,
      }
    case 'tool/call': {
      const call: TranscriptToolCall = {
        callId: event.data.callId,
        name: event.data.name,
        arguments: event.data.arguments,
      }
      return {
        ...appendRows(state, [{ kind: 'tool-call', sourceSeq: event.seq, ...call }]),
        toolCalls: new Map(state.toolCalls).set(call.callId, call),
      }
    }
    case 'tool/result': {
      const callId = event.data.message.source.callId
      const call = state.toolCalls.get(callId) ?? { callId, name: '', arguments: '' }
      const block = event.data.message.content[0]
      const nextCalls = new Map(state.toolCalls)
      nextCalls.delete(callId)
      return {
        ...appendRows(state, [{
          kind: 'tool-result',
          sourceSeq: event.seq,
          ...call,
          text: displayText(contentText(block.content), budget),
          isError: block.isError === true,
          error: event.data.error,
          meta: event.data.meta,
        }]),
        toolCalls: nextCalls,
      }
    }
    case 'command/run': {
      const name = displayText(event.data.name, budget)
      return {
        ...appendRows(state, [{
          kind: 'command', sourceSeq: event.seq, commandId: event.data.commandId,
          phase: 'running', name, text: event.data.args === undefined ? undefined : displayText(event.data.args, budget),
        }]),
        commands: new Map(state.commands).set(event.data.commandId, name),
      }
    }
    case 'command/done': {
      const commands = new Map(state.commands)
      const name = commands.get(event.data.commandId)
      commands.delete(event.data.commandId)
      return {
        ...appendRows(state, [{
          kind: 'command', sourceSeq: event.seq, commandId: event.data.commandId,
          phase: event.data.kind, name,
          text: event.data.text === undefined ? undefined : displayText(event.data.text, budget),
        }]),
        commands,
      }
    }
    case 'llm/retry':
      return appendRows(state, [{
        kind: 'retry', sourceSeq: event.seq, phase: 'waiting', retry: event.data.retry,
        text: displayText(event.data.failure.message, budget),
      }])
    case 'llm/retry-started':
      return appendRows(state, [{
        kind: 'retry', sourceSeq: event.seq, phase: 'started', retry: event.data.retry,
        text: displayText(`Retry ${event.data.retry} started.`, budget),
      }])
    case 'step/start':
    case 'step/end':
    case 'todo/write':
    case 'request/header':
    case 'request/context':
    case 'session/end-seed':
      return state
    default:
      return state
  }
}

/**
 * Replay a complete durable event list through the live folding function.
 * @param events - ordered session events.
 * @param budget - display limits applied to visible text.
 * @returns the same projection live delivery would produce.
 */
export function projectSessionEvents(
  events: readonly SessionEvent[],
  budget: DisplayTextBudget,
): TranscriptProjection {
  return events.reduce(
    (state, event) => foldSessionEvent(state, event, budget),
    createTranscriptProjection(),
  )
}
