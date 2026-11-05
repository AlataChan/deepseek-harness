import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { describe, expect, it } from 'vitest'
import { SESSION_MARKDOWN_EXPORT_PATH, apply, formatSessionMarkdown, inject } from '../src/index.ts'

const sid = (value: string): SessionId => value as SessionId
const sequence = (value: number): SessionSeq => brandNumber<SessionSeq>(value)
const messageId = (value: string): MessageId => brandString<MessageId>(value)

function events(): SessionEvent[] {
  return [
    {
      type: 'session/title',
      seq: sequence(0),
      time: 0,
      data: { title: 'Copied history', messageSeqs: [], source: { kind: 'fallback' } },
    },
    { type: 'turn/start', seq: sequence(1), time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: sequence(2),
      time: 2,
      surfaceOp: 'append',
      data: {
        role: 'user',
        id: messageId('user-2'),
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'OLDER_QUESTION' }],
      },
    },
    {
      type: 'developer/message',
      seq: sequence(3),
      time: 3,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'developer',
          id: messageId('developer-3'),
          source: { kind: 'tool-registry' },
          content: [
            { type: 'tool-removal', toolName: 'STORED_QUESTION_STATUS' },
            { type: 'tool-removal', toolName: 'pending' },
          ],
        },
      },
    },
    {
      type: 'assistant/message',
      seq: sequence(4),
      time: 4,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          id: messageId('assistant-4'),
          source: { kind: 'model', provider: 'test', model: 'test' },
          content: [{ type: 'text', text: 'Visible answer' }],
        },
        stream: [],
      },
    },
    {
      type: 'turn/end',
      seq: sequence(5),
      time: 5,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

function notFound(): Error {
  return Object.assign(new Error('missing /Users/secret/session'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
}

interface MountOptions {
  readonly sessionQuery?: boolean
  readonly readSession?: (sessionId: SessionId) => Promise<{
    session: { id: string }
    inheritedEventCount: number
    events: SessionEvent[]
  }>
  readonly sessions?: {
    get: (id: SessionId) => object | undefined
    flush: (session: object) => Promise<void>
  }
}

async function mounted(options: MountOptions = {}): Promise<{
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  ctx.provide('commands', { register: () => () => {} } as never)
  if (options.sessionQuery !== false) {
    ctx.provide('sessionQuery', {
      readSession: options.readSession ?? (async () => ({
        session: { id: 'session-1' },
        inheritedEventCount: 2,
        events: events(),
      })),
    } as never)
  }
  if (options.sessions !== undefined) ctx.provide('sessions', options.sessions as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  return { connection, dispose: () => fiber.dispose() }
}

describe('Session Markdown export Fetch route', () => {
  it('flushes the live Session, then returns the complete readSession transcript once', async () => {
    const order: string[] = []
    const snapshot = events()
    const { connection, dispose } = await mounted({
      sessions: {
        get: () => {
          order.push('get')
          return { id: 'session-1' }
        },
        flush: async () => { order.push('flush') },
      },
      readSession: async () => {
        order.push('read')
        return { session: { id: 'session-1' }, inheritedEventCount: 2, events: snapshot }
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const response = await shared.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('session-1')}`,
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    const body = await response.text()
    expect(body).toBe(formatSessionMarkdown(snapshot))
    expect(body).toContain('# Copied history')
    expect(body).toContain('> OLDER_QUESTION')
    expect(body).toContain('Visible answer')
    expect(body).not.toContain('Session file:')
    expect(body).not.toContain('STORED_QUESTION_STATUS')
    expect(order).toEqual(['get', 'flush', 'read'])
    await dispose()
    expect((await shared.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('session-1')}`,
    ))).status).toBe(404)
  })

  it('answers HEAD with the same status and no body', async () => {
    const { connection, dispose } = await mounted()
    const shared = connection.createSharedFetchHandler('/api')
    const head = await shared.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('session-1')}`,
      { method: 'HEAD' },
    ))
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(head.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    await dispose()
  })

  it('rejects a missing session id before reading', async () => {
    const { connection, dispose } = await mounted({ sessionQuery: false })
    const shared = connection.createSharedFetchHandler('/api')
    expect((await shared.fetch(new Request(`http://host${SESSION_MARKDOWN_EXPORT_PATH}`))).status).toBe(400)
    expect((await shared.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=`,
    ))).status).toBe(400)
    expect((await shared.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('session-1')}`,
    ))).status).toBe(500)
    await dispose()
  })

  it('maps a missing Session to 404 and hides other read failures', async () => {
    const missing = await mounted({
      readSession: () => Promise.reject(notFound()),
    })
    const missingFetch = missing.connection.createSharedFetchHandler('/api')
    const missingResponse = await missingFetch.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('gone')}`,
    ))
    expect(missingResponse.status).toBe(404)
    expect(await missingResponse.text()).toBe('session not found')
    await missing.dispose()

    const failed = await mounted({
      readSession: () => Promise.reject(Object.assign(
        new Error('failed at /Users/secret/session.jsonl'),
        { code: 'SESSION_QUERY_PERSISTENCE_FAILED' },
      )),
    })
    const failedFetch = failed.connection.createSharedFetchHandler('/api')
    const failedResponse = await failedFetch.fetch(new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('session-1')}`,
    ))
    expect(failedResponse.status).toBe(500)
    expect(await failedResponse.text()).toBe('session markdown export failed to read the stored log')
    await failed.dispose()
  })

  it('rethrows an aborted flush instead of publishing a transcript', async () => {
    const controller = new AbortController()
    const { connection, dispose } = await mounted({
      sessions: {
        get: () => ({ id: 'session-1' }),
        flush: async () => { controller.abort() },
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const request = new Request(
      `http://host${SESSION_MARKDOWN_EXPORT_PATH}?sessionId=${sid('session-1')}`,
      { signal: controller.signal },
    )
    await expect(shared.fetch(request)).rejects.toThrow(/abort/i)
    await dispose()
  })
})
