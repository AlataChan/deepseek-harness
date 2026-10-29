import { describe, expect, it } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveBrowserTimeZoneContext } from '@deepseek-ai/dsh-time-context/src/request-zone.ts'
import { applySessionListMetadata } from '@deepseek-ai/dsh-api-session-controller/src/list.ts'
import { turnOutlineProjectionDefinition } from '@deepseek-ai/dsh-session-turn-outline/src/projection.ts'
import { mintImSessionRequestId, createImPromptSource } from '../src/source.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    im: { kind: 'im'; provider: string; eventId: string; chatId: string }
  }
}

describe('Human-turn behavior representative verification (Projections & Context)', () => {
  const requestId = mintImSessionRequestId()
  const optionCSource = createImPromptSource(requestId, 'Asia/Shanghai')
  const optionASource = {
    kind: 'im' as const,
    provider: 'feishu',
    eventId: 'om_fake_event_123',
    chatId: 'oc_fake_chat_456',
  }

  describe('1. Time context resolution (deriveBrowserTimeZoneContext)', () => {
    it('Option (c) resolves valid client time zone from user-rpc source', () => {
      const message: UserMessage = {
        id: MessageId('msg-c'),
        role: 'user',
        content: [{ type: 'text', text: 'What time is it?' }],
        source: optionCSource,
      }

      const result = deriveBrowserTimeZoneContext([message])
      expect(result).toEqual({ kind: 'resolved', timeZone: 'Asia/Shanghai' })
    })

    it('Option (a) fails to resolve client time zone (treated as missing)', () => {
      const message: UserMessage = {
        id: MessageId('msg-a'),
        role: 'user',
        content: [{ type: 'text', text: 'What time is it?' }],
        source: optionASource,
      }

      const result = deriveBrowserTimeZoneContext([message])
      expect(result).toEqual({ kind: 'missing' })
    })
  })

  describe('2. Session list lastPromptAt metadata (applySessionListMetadata)', () => {
    it('Option (c) updates lastPromptAt timestamp on human user message', () => {
      const event: SessionEvent<'user/message'> = {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 1729700000,
        surfaceOp: 'append',
        data: {
          id: MessageId('msg-c'),
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          source: optionCSource,
        },
      }

      const initial = { blank: true, lastPromptAt: null }
      const updated = applySessionListMetadata(initial, event)
      expect(updated.lastPromptAt).toBe(1729700000)
    })

    it('Option (a) does not update lastPromptAt timestamp (ignores non-user kind)', () => {
      const event: SessionEvent<'user/message'> = {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 1729700000,
        surfaceOp: 'append',
        data: {
          id: MessageId('msg-a'),
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          source: optionASource,
        },
      }

      const initial = { blank: true, lastPromptAt: null }
      const updated = applySessionListMetadata(initial, event)
      expect(updated.lastPromptAt).toBeNull()
    })
  })

  describe('3. Session turn outline projection (turnOutlineProjectionDefinition)', () => {
    it('Option (c) captures opening human prompt preview for the turn', () => {
      let state = turnOutlineProjectionDefinition.init()
      const startEvent: SessionEvent<'turn/start'> = {
        type: 'turn/start',
        seq: SessionSeq(0),
        time: 1000,
        data: { turn: 1 },
      }
      state = turnOutlineProjectionDefinition.apply(state, startEvent)

      const userMessageEvent: SessionEvent<'user/message'> = {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 1001,
        surfaceOp: 'append',
        data: {
          id: MessageId('msg-c'),
          role: 'user',
          content: [{ type: 'text', text: 'Summarize quarterly results' }],
          source: optionCSource,
        },
      }
      state = turnOutlineProjectionDefinition.apply(state, userMessageEvent)

      expect(state.turns).toHaveLength(1)
      expect(state.turns[0]?.prompt).toBe('Summarize quarterly results')
    })

    it('Option (a) ignores message content and leaves turn prompt preview empty', () => {
      let state = turnOutlineProjectionDefinition.init()
      const startEvent: SessionEvent<'turn/start'> = {
        type: 'turn/start',
        seq: SessionSeq(0),
        time: 1000,
        data: { turn: 1 },
      }
      state = turnOutlineProjectionDefinition.apply(state, startEvent)

      const userMessageEvent: SessionEvent<'user/message'> = {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 1001,
        surfaceOp: 'append',
        data: {
          id: MessageId('msg-a'),
          role: 'user',
          content: [{ type: 'text', text: 'Summarize quarterly results' }],
          source: optionASource,
        },
      }
      state = turnOutlineProjectionDefinition.apply(state, userMessageEvent)

      expect(state.turns).toHaveLength(1)
      expect(state.turns[0]?.prompt).toBe('')
    })
  })
})
