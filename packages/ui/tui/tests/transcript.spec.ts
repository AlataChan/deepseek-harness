import { describe, expect, it } from 'vitest'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import {
  createTranscriptProjection,
  foldSessionEvent,
  projectSessionEvents,
} from '../src/transcript/project.ts'
import { retainTranscriptRows } from '../src/transcript/retention.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'tui-test/unknown': { value: string }
  }
}

let sequence = 0
function event<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent<T> {
  sequence += 1
  return { type, seq: sequence, time: sequence * 10, data } as SessionEvent<T>
}

const budget = { maxBytes: 32_768, maxColumns: 32_768 }

describe('session transcript projection', () => {
  it('replaces streamed chunks with the settled assistant message', () => {
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] })
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'model' },
      content: [
        { type: 'reasoning', text: 'thought' },
        { type: 'text', text: 'Hello' },
      ],
    })
    const events = [
      event('turn/start', { turn: 1 }),
      event('user/message', user),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'thou' } }),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'Hel' } }),
      event('assistant/message', { turn: 1, step: 1, message: assistant }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]

    const projection = projectSessionEvents(events, budget)
    expect(projection.rows.map(row => [row.kind, 'text' in row ? row.text : undefined])).toEqual([
      ['message', 'hello'],
      ['reasoning', 'thought'],
      ['message', 'Hello'],
    ])
    expect(projection.liveAssistant).toBeUndefined()
    expect(projection.liveReasoning).toBeUndefined()
    expect(projection.turn).toEqual({ kind: 'idle' })
  })

  it('keeps tool pairing and result metadata structured', () => {
    const callId = CallId('call-1')
    const call = event('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'bash',
      arguments: '{"command":"pwd"}',
    })
    const result = event('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: '/workspace' }],
        isError: false,
      }),
      meta: { durationMs: 2 },
    })
    const projection = projectSessionEvents([call, result], budget)

    expect(projection.rows).toEqual([
      expect.objectContaining({
        kind: 'tool-call', callId, name: 'bash', arguments: '{"command":"pwd"}',
      }),
      expect.objectContaining({
        kind: 'tool-result', callId, name: 'bash', arguments: '{"command":"pwd"}',
        text: '/workspace', isError: false, meta: { durationMs: 2 },
      }),
    ])
  })

  it('projects command, retry, cancellation, and failure lifecycle rows', () => {
    const commandId = CommandId('command-1')
    const retryId = RetryId('retry-1')
    const projection = projectSessionEvents([
      event('command/run', { commandId, name: 'help', args: ' topic', source: { kind: 'user' } }),
      event('command/done', { commandId, kind: 'success', text: 'done' }),
      event('llm/retry', {
        retryId,
        turn: 1,
        step: 1,
        provider: 'test',
        mode: 'normal',
        policyKey: 'default',
        retry: 1,
        maxRetries: 2,
        delayMs: 5,
        failure: { message: 'busy', code: 'RATE_LIMIT' },
      }),
      event('llm/retry-started', { retryId, turn: 1, step: 1, retry: 1 }),
      event('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
      event('turn/start', { turn: 2 }),
      event('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } } }),
      event('tui-test/unknown', { value: 'ignored' }),
    ], budget)

    expect(projection.rows.map(row => row.kind)).toEqual([
      'command', 'command', 'retry', 'retry', 'status', 'error',
    ])
    expect(projection.rows.at(-1)).toEqual(expect.objectContaining({ kind: 'error', text: 'failed' }))
  })

  it('produces the same state through live folding and replay', () => {
    const events = [
      event('turn/start', { turn: 3 }),
      event('assistant/chunk', { turn: 3, step: 1, chunk: { type: 'text-delta', index: 0, text: 'live' } }),
    ]
    const live = events.reduce(
      (state, value) => foldSessionEvent(state, value, budget),
      createTranscriptProjection(),
    )
    expect(live).toEqual(projectSessionEvents(events, budget))
    expect(live.liveAssistant).toBe('live')
  })
})

describe('resume transcript retention', () => {
  it('keeps the newest rows and emits one explicit omission row', () => {
    const rows = projectSessionEvents([
      event('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'one' }] })),
      event('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'two' }] })),
      event('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'three' }] })),
    ], budget).rows
    expect(retainTranscriptRows(rows, 2)).toEqual([
      { kind: 'omission', omitted: 1, text: '1 earlier transcript row omitted' },
      rows[1],
      rows[2],
    ])
    expect(retainTranscriptRows(rows, 3)).toEqual(rows)
  })
})
