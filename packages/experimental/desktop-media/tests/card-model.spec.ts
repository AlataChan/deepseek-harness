import { describe, expect, it } from 'vitest'
import { firstLine, mediaCardModel, resultText } from '../src/client/card-model.ts'

const running = {
  callId: 'c1',
  name: 'media_create_video',
  argsRaw: '{}',
  turn: 1,
  step: 1,
  time: 0,
  subCalls: [],
}

function settled(extra: {
  content?: readonly { type: string; text?: string }[]
  isError?: boolean
  error?: { name: string; code: string }
  meta?: unknown
}) {
  return {
    kind: 'tool-result' as const,
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'media_create_video', argsRaw: '{}' },
    callTime: 0,
    content: extra.content ?? [],
    isError: extra.isError ?? false,
    subCalls: [],
    ...extra.error === undefined ? {} : { error: extra.error },
    ...extra.meta === undefined ? {} : { meta: extra.meta },
  }
}

describe('card-model', () => {
  it('takes the first physical line', () => {
    expect(firstLine('one')).toBe('one')
    expect(firstLine('one\ntwo')).toBe('one')
  })

  it('flattens result text and derives lifecycle from the call slice', () => {
    expect(resultText(running as never)).toBeNull()
    expect(resultText(settled({}) as never)).toBeNull()
    expect(resultText(settled({
      error: { name: 'ToolError', code: 'interrupted' },
    }) as never)).toBe('ToolError: interrupted')
    expect(resultText(settled({
      content: [{ type: 'text', text: 'ok' }, { type: 'json' }],
    }) as never)).toContain('ok')

    expect(mediaCardModel(running as never)).toMatchObject({
      state: 'running',
      kind: null,
      requestId: null,
      output: null,
    })
    expect(mediaCardModel(settled({
      isError: true,
      error: { name: 'ToolError', code: 'interrupted' },
    }) as never).state).toBe('stopped')
    expect(mediaCardModel(settled({
      isError: true,
      error: { name: 'ToolError', code: 'failed' },
    }) as never).state).toBe('error')
    expect(mediaCardModel(settled({
      meta: {
        kind: 'video',
        requestId: 'r_1',
        jobId: 'j_1',
        artifactId: 'a_1',
        voiceId: 'v_1',
      },
      content: [{ type: 'text', text: 'done' }],
    }) as never)).toMatchObject({
      state: 'ok',
      kind: 'video',
      requestId: 'r_1',
      jobId: 'j_1',
      artifactId: 'a_1',
      voiceId: 'v_1',
      output: 'done',
    })
    expect(mediaCardModel(settled({ meta: 'nope' }) as never).kind).toBeNull()
    expect(mediaCardModel(settled({ meta: { kind: 'other' } }) as never).kind).toBeNull()
    expect(mediaCardModel(settled({ meta: [] }) as never).kind).toBeNull()
  })
})
