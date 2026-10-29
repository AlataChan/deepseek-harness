import { describe, expect, it, vi } from 'vitest'
import * as lark from '@larksuiteoapi/node-sdk'
import {
  FeishuTransport,
  type FeishuEventDispatcherLike,
  type FeishuWSClientLike,
  type FeishuClientFactory,
  type FeishuTransportConfig,
  type CardActionDurableAcceptor,
  type FeishuWSConnectionState,
  type FeishuWSConnectionStatus,
} from '../src/feishu-transport.ts'
import {
  normalizeFeishuMessage,
  normalizeFeishuCardAction,
  type NormalizedFeishuCardAction,
  sanitizeOutboundText,
  FeishuNormalizerError,
} from '../src/feishu-normalizer.ts'
import {
  FeishuOutboundClient,
  FeishuAmbiguousTimeoutError,
  FeishuOutboundError,
  type HttpFetchFn,
} from '../src/feishu-outbound.ts'
import type {
  IncomingImMessage,
  IngressAcceptResult,
  IngressDurableAcceptor,
} from '../src/types.ts'

class MockEventDispatcher implements FeishuEventDispatcherLike {
  public readonly handlers = new Map<string, (data: unknown) => Promise<unknown>>()

  register(handlers: Record<string, (data: unknown) => Promise<unknown>>): this {
    for (const [key, fn] of Object.entries(handlers)) {
      this.handlers.set(key, fn)
    }
    return this
  }

  async invoke(data: unknown, _options?: { needCheck?: boolean }): Promise<unknown> {
    const raw = data as Record<string, unknown>
    // Real Feishu SDK invokes with either event_type at root or header.event_type
    const eventType =
      (raw?.event_type as string | undefined) ??
      (raw?.header as { event_type?: string } | undefined)?.event_type
    if (eventType && this.handlers.has(eventType)) {
      return this.handlers.get(eventType)!(data)
    }
    return undefined
  }
}

class MockWSClient implements FeishuWSClientLike {
  public isStarted = false
  public isClosed = false
  public dispatcher: FeishuEventDispatcherLike | null = null
  public customState: FeishuWSConnectionState | null = null
  public onStartHook?: (() => Promise<void> | void) | undefined

  async start(params: { eventDispatcher: FeishuEventDispatcherLike }): Promise<void> {
    if (this.onStartHook) {
      await this.onStartHook()
    }
    this.isStarted = true
    this.dispatcher = params.eventDispatcher
  }

  close(_params?: { force?: boolean }): void {
    this.isClosed = true
    this.isStarted = false
  }

  getConnectionStatus(): FeishuWSConnectionStatus {
    if (this.customState !== null) {
      return { state: this.customState, reconnectAttempts: 0 }
    }
    return { state: this.isStarted ? 'connected' : 'idle', reconnectAttempts: 0 }
  }
}

function createMockFactory(): {
  factory: FeishuClientFactory
  mockWS: MockWSClient
  mockDispatcher: MockEventDispatcher
} {
  const mockWS = new MockWSClient()
  const mockDispatcher = new MockEventDispatcher()
  const factory: FeishuClientFactory = {
    createWSClient: () => mockWS,
    createEventDispatcher: () => mockDispatcher,
  }
  return { factory, mockWS, mockDispatcher }
}

const baseConfig: FeishuTransportConfig = {
  appId: 'cli_test_app_12345',
  appSecret: 'test_secret_abcdef',
  domain: 'https://open.feishu.cn',
  maxMessageLength: 1000,
  maxMessageBytes: 2000,
  maxMessageAgeMs: 60_000,
  maxFutureSkewMs: 30_000,
  startupTimeoutMs: 1000,
  sendTimeoutMs: 1000,
  shutdownTimeoutMs: 100,
  maxInboundConcurrency: 100,
  autoReconnect: true,
  connectionStatusPollIntervalMs: 10,
}

/** Creates a flattened payload matching the real Lark Node SDK EventDispatcher.invokeWithHandle output */
function makeRealSdkFlattenedEvent(overrides: Record<string, unknown> = {}) {
  const now = 1_700_000_000_000
  return {
    event_id: 'evt_123456789',
    event_type: 'im.message.receive_v1',
    create_time: String(now),
    app_id: 'cli_test_app_12345',
    tenant_key: 'tenant_test_xyz',
    token: 'token_mock',
    sender: {
      sender_type: 'user',
      sender_id: {
        open_id: 'ou_human_operator_1',
        user_id: 'usr_human_1',
      },
    },
    message: {
      message_id: 'om_message_001',
      chat_id: 'oc_private_chat_001',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'Hello from real SDK flattened event.' }),
    },
    ...overrides,
  }
}

/** Creates a nested wire format payload */
function makeValidRawFeishuEvent(overrides: Record<string, unknown> = {}) {
  const now = 1_700_000_000_000
  return {
    schema: '2.0',
    header: {
      event_id: 'evt_123456789',
      event_type: 'im.message.receive_v1',
      create_time: String(now),
      app_id: 'cli_test_app_12345',
      tenant_key: 'tenant_test_xyz',
      ...((overrides.header as Record<string, unknown>) ?? {}),
    },
    event: {
      sender: {
        sender_type: 'user',
        sender_id: {
          open_id: 'ou_human_operator_1',
          user_id: 'usr_human_1',
        },
        ...((overrides.sender as Record<string, unknown>) ?? {}),
      },
      message: {
        message_id: 'om_message_001',
        chat_id: 'oc_private_chat_001',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'Hello, please inspect the system.' }),
        ...((overrides.message as Record<string, unknown>) ?? {}),
      },
      ...((overrides.event as Record<string, unknown>) ?? {}),
    },
  }
}

describe('FeishuNormalizer', () => {
  it('normalizes real SDK flattened event (produced by Lark Node SDK EventDispatcher)', () => {
    const raw = makeRealSdkFlattenedEvent()
    const normalized = normalizeFeishuMessage(raw, {
      expectedAppId: 'cli_test_app_12345',
      referenceTimeMs: 1_700_000_005_000,
    })

    expect(normalized).toEqual({
      provider: 'feishu',
      appId: 'cli_test_app_12345',
      tenantId: 'tenant_test_xyz',
      chatId: 'oc_private_chat_001',
      senderId: 'ou_human_operator_1',
      eventId: 'evt_123456789',
      messageId: 'om_message_001',
      createTime: 1_700_000_000_000,
      chatType: 'p2p',
      text: 'Hello from real SDK flattened event.',
    })
  })

  it('normalizes valid incoming Feishu human p2p message in nested wire format', () => {
    const raw = makeValidRawFeishuEvent()
    const normalized = normalizeFeishuMessage(raw, {
      expectedAppId: 'cli_test_app_12345',
      referenceTimeMs: 1_700_000_005_000,
    })

    expect(normalized).toEqual({
      provider: 'feishu',
      appId: 'cli_test_app_12345',
      tenantId: 'tenant_test_xyz',
      chatId: 'oc_private_chat_001',
      senderId: 'ou_human_operator_1',
      eventId: 'evt_123456789',
      messageId: 'om_message_001',
      createTime: 1_700_000_000_000,
      chatType: 'p2p',
      text: 'Hello, please inspect the system.',
    })
  })

  it('rejects bot senders with BOT_MESSAGE code', () => {
    const raw = makeRealSdkFlattenedEvent({
      sender: {
        sender_type: 'bot',
        sender_id: { open_id: 'ou_bot_999' },
      },
    })
    expect(() => normalizeFeishuMessage(raw)).toThrow(FeishuNormalizerError)
    expect(() => normalizeFeishuMessage(raw)).toThrow(/BOT_MESSAGE/)
  })

  it('rejects group chats with NON_P2P_CHAT code', () => {
    const raw = makeRealSdkFlattenedEvent({
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'hi' }),
      },
    })
    expect(() => normalizeFeishuMessage(raw)).toThrow(/NON_P2P_CHAT/)
  })

  it('rejects foreign application events with APP_ID_MISMATCH', () => {
    const raw = makeRealSdkFlattenedEvent({
      app_id: 'cli_foreign_app_999',
    })
    expect(() =>
      normalizeFeishuMessage(raw, { expectedAppId: 'cli_test_app_12345' }),
    ).toThrow(/APP_ID_MISMATCH/)
  })

  it('rejects foreign enterprise tenant events with TENANT_ID_MISMATCH', () => {
    const raw = makeRealSdkFlattenedEvent({
      tenant_key: 'tenant_foreign_evil',
    })
    expect(() =>
      normalizeFeishuMessage(raw, { expectedTenantId: 'tenant_my_company' }),
    ).toThrow(/TENANT_ID_MISMATCH/)
  })

  it('rejects oversized prompts exceeding UTF-8 byte limit', () => {
    // 3-byte Chinese characters: 10 chars = 30 bytes
    const text = '测试中文长度限制'
    const raw = makeRealSdkFlattenedEvent({
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text }),
      },
    })
    expect(() =>
      normalizeFeishuMessage(raw, { maxMessageBytes: 15 }),
    ).toThrow(/MESSAGE_OVERSIZED/)
  })

  it('rejects future timestamps exceeding allowed clock skew tolerance', () => {
    const raw = makeRealSdkFlattenedEvent({
      create_time: String(1_700_000_100_000), // 100s in the future
    })
    expect(() =>
      normalizeFeishuMessage(raw, {
        referenceTimeMs: 1_700_000_000_000,
        maxFutureSkewMs: 30_000, // only 30s allowed
      }),
    ).toThrow(/FUTURE_TIMESTAMP/)
  })

  it('rejects expired messages exceeding freshness window', () => {
    const raw = makeRealSdkFlattenedEvent({
      create_time: String(1_700_000_000_000),
    })
    expect(() =>
      normalizeFeishuMessage(raw, {
        referenceTimeMs: 1_700_000_500_000, // 500s later (max is 60s)
        maxMessageAgeMs: 60_000,
      }),
    ).toThrow(/MESSAGE_EXPIRED/)
  })

  it('rejects non-text formats (images, audio, files)', () => {
    const raw = makeRealSdkFlattenedEvent({
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_xxx' }),
      },
    })
    expect(() => normalizeFeishuMessage(raw)).toThrow(/UNSUPPORTED_FORMAT/)
  })

  it('sanitizes outbound text by stripping thinking tags and credential tokens', () => {
    const rawOutbound = `
<think>
Internal chain of thought: inspecting /etc/passwd and checking credentials.
</think>
Here is your analysis report.
Authorization: Bearer secret_jwt_token_12345.
And lowercase: bearer secret_lower_token_67890.
And uppercase: BEARER secret_upper_token_99999.
And API key: sk-abcdef12345678901234567890.
`
    const cleaned = sanitizeOutboundText(rawOutbound)
    expect(cleaned).not.toContain('<think>')
    expect(cleaned).not.toContain('Internal chain of thought')
    expect(cleaned).not.toContain('secret_jwt_token_12345')
    expect(cleaned).not.toContain('secret_lower_token_67890')
    expect(cleaned).not.toContain('secret_upper_token_99999')
    expect(cleaned).not.toContain('sk-abcdef12345678901234567890')
    expect(cleaned).toContain('Here is your analysis report.')
    expect(cleaned).toContain('Bearer [REDACTED]')
    expect(cleaned).toContain('[REDACTED_KEY]')
  })

  it('normalizes real v2 card.action.trigger payload with operator, context and action', () => {
    const rawV2Card = {
      schema: '2.0',
      header: {
        event_id: 'evt_card_001',
        token: 'tok_card_001',
        event_type: 'card.action.trigger',
        app_id: 'cli_test_app_12345',
        tenant_key: 'tenant_test_xyz',
      },
      event: {
        operator: {
          operator_id: {
            open_id: 'ou_approver_v2',
            user_id: 'usr_approver_v2',
          },
          tenant_key: 'tenant_test_xyz',
        },
        action: {
          tag: 'button',
          value: { decision: 'allow', toolCallId: 'call_123' },
        },
        context: {
          open_message_id: 'om_card_msg_v2',
          open_chat_id: 'oc_card_chat_v2',
        },
      },
    }

    const normalized = normalizeFeishuCardAction(rawV2Card, {
      expectedAppId: 'cli_test_app_12345',
    })

    expect(normalized).toEqual({
      provider: 'feishu',
      appId: 'cli_test_app_12345',
      tenantKey: 'tenant_test_xyz',
      chatId: 'oc_card_chat_v2',
      operatorId: 'ou_approver_v2',
      openId: 'ou_approver_v2',
      openMessageId: 'om_card_msg_v2',
      actionTag: 'button',
      actionValue: { decision: 'allow', toolCallId: 'call_123' },
      token: 'tok_card_001',
    })
  })

  it('rejects card action with mismatched app ID', () => {
    const rawV2Card = {
      schema: '2.0',
      header: {
        app_id: 'cli_foreign_app_999',
        tenant_key: 'tenant_test_xyz',
      },
      event: {
        operator: { operator_id: { open_id: 'ou_123' } },
        action: { tag: 'button' },
      },
    }

    expect(() =>
      normalizeFeishuCardAction(rawV2Card, { expectedAppId: 'cli_test_app_12345' }),
    ).toThrow(/APP_ID_MISMATCH/)
  })
})

describe('FeishuOutboundClient', () => {
  it('acquires token, sanitizes text, and maps real message ID on successful dispatch', async () => {
    let callCount = 0
    let secondCallInit: RequestInit | undefined
    const mockFetch: HttpFetchFn = vi.fn(async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token_12345',
            expire: 7200,
          }),
          { status: 200 },
        )
      }
      secondCallInit = init
      return new Response(
        JSON.stringify({
          code: 0,
          msg: 'ok',
          data: { message_id: 'om_real_feishu_message_id_999' },
        }),
        { status: 200 },
      )
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      domain: 'https://open.feishu.cn',
      fetchFn: mockFetch,
    })

    const result = await client.sendTextMessage({
      chatId: 'oc_chat_1',
      text: '<think>hidden</think>Hello human operator!',
    })

    expect(result.status).toBe('sent')
    expect(result.messageId).toBe('om_real_feishu_message_id_999')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Verify token was passed in Authorization header
    expect((secondCallInit?.headers as Record<string, string>)?.Authorization).toBe(
      'Bearer t-mock_token_12345',
    )
  })

  it('marks status as UNKNOWN on ambiguous timeout and NEVER retries automatically', async () => {
    let callCount = 0
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token_12345',
            expire: 7200,
          }),
          { status: 200 },
        )
      }
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      timeoutMs: 100,
      fetchFn: mockFetch,
    })

    let caughtError: unknown
    try {
      await client.sendTextMessage({
        chatId: 'oc_chat_1',
        text: 'Critical command dispatched',
      })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(FeishuAmbiguousTimeoutError)
    const timeoutErr = caughtError as FeishuAmbiguousTimeoutError
    expect(timeoutErr.status).toBe('unknown')
    expect(timeoutErr.message).toContain('delivery status is UNKNOWN')

    // Crucial requirement: only ONE send attempt was made, no automatic retry!
    expect(mockFetch).toHaveBeenCalledTimes(2) // 1 token + 1 send attempt
  })

  it('marks status as UNKNOWN on ambiguous network reset error after dispatch', async () => {
    let callCount = 0
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token_12345',
            expire: 7200,
          }),
          { status: 200 },
        )
      }
      throw new TypeError('fetch failed: ECONNRESET')
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      timeoutMs: 500,
      fetchFn: mockFetch,
    })

    let caughtError: unknown
    try {
      await client.sendTextMessage({
        chatId: 'oc_chat_1',
        text: 'Deploy production service',
      })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(FeishuAmbiguousTimeoutError)
    const timeoutErr = caughtError as FeishuAmbiguousTimeoutError
    expect(timeoutErr.status).toBe('unknown')
    expect(timeoutErr.message).toContain('delivery status is unknown (do not retry)')
    expect(mockFetch).toHaveBeenCalledTimes(2) // No retry
  })

  it('marks status as UNKNOWN when Feishu responds with HTTP 500 or HTTP 408', async () => {
    let callCount = 0
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        statusText: 'Internal Server Error',
      })
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      fetchFn: mockFetch,
    })

    let caughtError: unknown
    try {
      await client.sendTextMessage({ chatId: 'oc_chat_1', text: 'Hello' })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(FeishuAmbiguousTimeoutError)
    expect((caughtError as FeishuAmbiguousTimeoutError).status).toBe('unknown')
    expect((caughtError as FeishuAmbiguousTimeoutError).message).toContain('uncertain HTTP response')
  })

  it('marks status as UNKNOWN when Feishu response body is malformed or invalid JSON', async () => {
    let callCount = 0
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token',
          }),
          { status: 200 },
        )
      }
      return new Response('Not Valid JSON {{{', { status: 200 })
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      fetchFn: mockFetch,
    })

    let caughtError: unknown
    try {
      await client.sendTextMessage({ chatId: 'oc_chat_1', text: 'Hello' })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(FeishuAmbiguousTimeoutError)
    expect((caughtError as FeishuAmbiguousTimeoutError).status).toBe('unknown')
  })

  it('marks status as UNKNOWN when Feishu response omits message_id on 200 OK', async () => {
    let callCount = 0
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token',
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          code: 0,
          msg: 'ok',
          data: {}, // Missing message_id!
        }),
        { status: 200 },
      )
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      fetchFn: mockFetch,
    })

    let caughtError: unknown
    try {
      await client.sendTextMessage({ chatId: 'oc_chat_1', text: 'Hello' })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(FeishuAmbiguousTimeoutError)
    expect((caughtError as FeishuAmbiguousTimeoutError).status).toBe('unknown')
    expect((caughtError as FeishuAmbiguousTimeoutError).message).toContain('omitted its message ID')
  })

  it('rejects non-official domain to prevent open network egress', () => {
    expect(
      () =>
        new FeishuOutboundClient({
          appId: 'cli_app_1',
          appSecret: 'sec_1',
          domain: 'https://evil.example.com',
        }),
    ).toThrow(TypeError)
  })

  it('throws FeishuOutboundError on deterministic platform rejection', async () => {
    let callCount = 0
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 't-mock_token',
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          code: 99991663,
          msg: 'User is not in chat',
        }),
        { status: 200 },
      )
    })

    const client = new FeishuOutboundClient({
      appId: 'cli_app_1',
      appSecret: 'sec_1',
      fetchFn: mockFetch,
    })

    await expect(
      client.sendTextMessage({ chatId: 'oc_invalid', text: 'Hello' }),
    ).rejects.toThrow(FeishuOutboundError)
  })
})

describe('FeishuTransport Inbound ACK and Lifecycle', () => {
  it('awaits durable inbox write before returning 200 ACK for real SDK flattened event', async () => {
    const { factory, mockWS, mockDispatcher } = createMockFactory()

    let durableWriteFinished = false
    const handleIncomingMessage = vi.fn(async (msg: IncomingImMessage): Promise<IngressAcceptResult> => {
      await new Promise((r) => {
        setTimeout(r, 20)
      })
      durableWriteFinished = true
      return {
        deliveryKey: `feishu:${msg.appId}:${msg.eventId}`,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        duplicate: false,
      }
    })
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()
    expect(mockWS.isStarted).toBe(true)

    // Using real SDK flattened event
    const rawEvent = makeRealSdkFlattenedEvent()
    const ack = await mockDispatcher.invoke(rawEvent)

    expect(durableWriteFinished).toBe(true)
    expect(ack).toEqual({
      code: 0,
      msg: 'admitted',
    })
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1)

    await transport.close()
    expect(mockWS.isClosed).toBe(true)
  })

  it('acknowledges duplicate deliveries cleanly without re-executing model loop', async () => {
    const { factory, mockDispatcher } = createMockFactory()

    const handleIncomingMessage = vi.fn(async (): Promise<IngressAcceptResult> => ({
      deliveryKey: 'feishu:cli_test_app_12345:evt_123456789',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      duplicate: true,
    }))
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const rawEvent = makeRealSdkFlattenedEvent()
    const ack = await mockDispatcher.invoke(rawEvent)

    expect(ack).toEqual({
      code: 0,
      msg: 'duplicate_admitted',
    })

    await transport.close()
  })

  it('propagates failure when durable write fails, yielding 500 error ACK to Feishu', async () => {
    const { factory, mockDispatcher } = createMockFactory()

    const handleIncomingMessage = vi.fn(async () => {
      throw new Error('SQLite disk I/O error during inbox write')
    })
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const rawEvent = makeRealSdkFlattenedEvent()

    await expect(mockDispatcher.invoke(rawEvent)).rejects.toThrow(
      'SQLite disk I/O error during inbox write',
    )

    await transport.close()
  })

  it('drops bot messages and expired messages gracefully with code 0 without calling acceptor', async () => {
    const { factory, mockDispatcher } = createMockFactory()

    const handleIncomingMessage = vi.fn()
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const botEvent = makeRealSdkFlattenedEvent({
      sender: { sender_type: 'bot', sender_id: { open_id: 'ou_bot' } },
    })

    const result = (await mockDispatcher.invoke(botEvent)) as { code: number; msg: string }
    expect(result.code).toBe(0)
    expect(result.msg).toContain('Ignored')
    expect(handleIncomingMessage).not.toHaveBeenCalled()

    await transport.close()
  })

  it('handles interactive card action callbacks through CardActionDurableAcceptor', async () => {
    const { factory, mockDispatcher } = createMockFactory()

    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(),
    }

    const handleCardAction = vi.fn(async (action: NormalizedFeishuCardAction) => {
      expect(action.actionTag).toBe('button_approve')
      expect(action.openId).toBe('ou_approver_1')
      return {
        success: true,
        toast: 'Tool execution approved',
      }
    })
    const mockCardAcceptor: CardActionDurableAcceptor = {
      handleCardAction,
    }

    const transport = new FeishuTransport(
      baseConfig,
      mockAcceptor,
      mockCardAcceptor,
      { clientFactory: factory },
    )

    await transport.start()

    const rawCardEvent = {
      event_type: 'card.action.trigger',
      open_id: 'ou_approver_1',
      tenant_key: 'tenant_test_xyz',
      open_chat_id: 'oc_test_chat_001',
      open_message_id: 'om_card_msg_001',
      token: 'tok_card_action_verify_123',
      action: {
        tag: 'button_approve',
        value: { action: 'approve' },
      },
    }

    const res = (await mockDispatcher.invoke(rawCardEvent)) as {
      toast: { type: string; content: string }
    }
    expect(res.toast.content).toBe('Tool execution approved')
    expect(handleCardAction).toHaveBeenCalledTimes(1)

    await transport.close()
  })

  it('bounds shutdown timeout if an in-flight handshake hangs and rejects rather than falsely claiming quiescence', async () => {
    const { factory, mockDispatcher } = createMockFactory()

    // Simulate an in-flight handshake that never finishes
    const handleIncomingMessage = vi.fn(() => new Promise<never>(() => {}))
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(
      { ...baseConfig, shutdownTimeoutMs: 50 },
      mockAcceptor,
      undefined,
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )

    await transport.start()

    const rawEvent = makeRealSdkFlattenedEvent()
    // Trigger in-flight event
    void mockDispatcher.invoke(rawEvent)

    const start = Date.now()
    // close() must reject on timeout rather than falsely claiming quiescence
    await expect(transport.close()).rejects.toThrow(/timed out.*waiting for in-flight operations/)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('is idempotent when start() is called concurrently', async () => {
    const { factory, mockWS } = createMockFactory()
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(),
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      clientFactory: factory,
    })

    await Promise.all([transport.start(), transport.start(), transport.start()])
    expect(mockWS.isStarted).toBe(true)

    await transport.close()
  })

  it('rejects permanently failed SDK status on start()', async () => {
    const { factory, mockWS } = createMockFactory()
    mockWS.customState = 'failed'
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    await expect(transport.start()).rejects.toThrow(/status failed/)
    await transport.close()
  })

  it('rejects bounded never-ready startup exceeding startupTimeoutMs', async () => {
    const { factory, mockWS } = createMockFactory()
    mockWS.customState = 'connecting'
    const transport = new FeishuTransport(
      { ...baseConfig, startupTimeoutMs: 30 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    await expect(transport.start()).rejects.toThrow(/timed out.*waiting for connected state/)
    await transport.close()
  })

  it('rejects bounded never-resolving SDK start exceeding startupTimeoutMs', async () => {
    const { factory, mockWS } = createMockFactory()
    mockWS.start = vi.fn(() => new Promise<never>(() => {}))
    const transport = new FeishuTransport(
      { ...baseConfig, startupTimeoutMs: 30, shutdownTimeoutMs: 50 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    await expect(transport.start()).rejects.toThrow(/timed out.*waiting for connected state/)
    await expect(transport.close()).rejects.toThrow(/timed out|in-flight|operations to settle/)
  })

  it('close() during startup aborts startup and prevents late reopening', async () => {
    const { factory, mockWS } = createMockFactory()
    let startBarrierResolve: () => void = () => {}
    const startBarrier = new Promise<void>((resolve) => {
      startBarrierResolve = resolve
    })
    mockWS.onStartHook = () => startBarrier

    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )

    const startPromise = transport.start()
    const closePromise = transport.close()
    startBarrierResolve()

    await expect(startPromise).rejects.toThrow(/closed/)
    await closePromise
    await expect(transport.start()).rejects.toThrow(/Cannot start closed/)
  })

  it('supports reentrant close invocations safely sharing published close promise', async () => {
    const { factory, mockWS } = createMockFactory()
    let transportRef: FeishuTransport | null = null
    let reentrantPromise: Promise<void> | null = null

    const originalClose = mockWS.close.bind(mockWS)
    mockWS.close = vi.fn((params?: { force?: boolean }) => {
      originalClose(params)
      if (transportRef) {
        reentrantPromise = transportRef.close()
      }
    })

    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    transportRef = transport

    await transport.start()
    const firstClosePromise = transport.close()
    await firstClosePromise

    expect(reentrantPromise).toBe(firstClosePromise)
  })

  it('preserves client ownership and drains operations when client close throws', async () => {
    const { factory, mockWS, mockDispatcher } = createMockFactory()
    mockWS.close = vi.fn(() => {
      throw new Error('SDK socket termination failure')
    })

    let writeSettled = false
    const handleIncomingMessage = vi.fn(async (): Promise<IngressAcceptResult> => {
      await new Promise((r) => {
        setTimeout(r, 30)
      })
      writeSettled = true
      return { deliveryKey: 'k', requestId: 'r', duplicate: false }
    })

    const transport = new FeishuTransport(
      { ...baseConfig, shutdownTimeoutMs: 500 },
      { handleIncomingMessage },
      undefined,
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )

    await transport.start()
    const rawInbound = makeRealSdkFlattenedEvent()
    const inboundPromise = mockDispatcher.invoke(rawInbound)

    await expect(transport.close()).rejects.toThrow('SDK socket termination failure')
    expect(writeSettled).toBe(true)
    await inboundPromise
  })

  it('respects configurable connectionStatusPollIntervalMs when polling readiness', async () => {
    const { factory, mockWS } = createMockFactory()
    let pollCount = 0
    mockWS.getConnectionStatus = vi.fn((): FeishuWSConnectionStatus => {
      pollCount++
      const state: FeishuWSConnectionState = pollCount >= 3 ? 'connected' : 'connecting'
      return { state, reconnectAttempts: 0 }
    })
    const transport = new FeishuTransport(
      { ...baseConfig, connectionStatusPollIntervalMs: 20 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    await transport.start()
    expect(pollCount).toBeGreaterThanOrEqual(3)
    await transport.close()
  })

  it('makes transport terminal upon startup timeout and blocks retry attempts', async () => {
    const { factory, mockWS } = createMockFactory()
    mockWS.customState = 'connecting'
    const transport = new FeishuTransport(
      { ...baseConfig, startupTimeoutMs: 25 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    await expect(transport.start()).rejects.toThrow(/timed out.*waiting for connected state/)
    // Retry on failed transport must be rejected as terminal
    await expect(transport.start()).rejects.toThrow(/Cannot start closed/)
    await transport.close()
  })

  it('retains late force-close error from timed-out raw startup without swallowing', async () => {
    const { factory, mockWS } = createMockFactory()
    const release = Promise.withResolvers<undefined>()
    mockWS.start = vi.fn(async () => {
      await release.promise
    })
    mockWS.close = vi.fn(() => {
      throw new Error('Late force close exception')
    })
    const transport = new FeishuTransport(
      { ...baseConfig, startupTimeoutMs: 20, shutdownTimeoutMs: 100 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    await expect(transport.start()).rejects.toThrow(/timed out/)
    // Late start settles after public timeout
    release.resolve(undefined)
    await new Promise((r) => {
      setTimeout(r, 20)
    })
    // close() must observe the late force-close exception rather than swallowing it
    await expect(transport.close()).rejects.toThrow('Late force close exception')
  })

  it('handles synchronous close invocation during factory client creation', async () => {
    let transportRef: FeishuTransport | null = null
    const factory: FeishuClientFactory = {
      createWSClient: () => {
        if (transportRef) {
          void transportRef.close()
        }
        return {
          start: vi.fn(async () => {}),
          close: vi.fn(),
          getConnectionStatus: (): FeishuWSConnectionStatus => ({ state: 'connected' }),
        }
      },
      createEventDispatcher: () => new MockEventDispatcher(),
    }
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    transportRef = transport
    await expect(transport.start()).rejects.toThrow(/closed/)
    await transport.close()
  })

  it('handles immediate close() right after start() before deferred doStart executes', async () => {
    const { factory, mockWS } = createMockFactory()
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    const starting = transport.start()
    const closing = transport.close()
    await expect(starting).rejects.toThrow(/closed/)
    await closing
    expect(mockWS.isClosed).toBe(false)
  })

  it('resolves close() cleanly when closing while readiness polling after SDK start resolved', async () => {
    const { factory, mockWS } = createMockFactory()
    mockWS.customState = 'connecting'
    const transport = new FeishuTransport(
      { ...baseConfig, startupTimeoutMs: 1000, connectionStatusPollIntervalMs: 20 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { clientFactory: factory },
    )
    const starting = transport.start()
    await new Promise((r) => {
      setTimeout(r, 40)
    })
    const closing = transport.close()
    await expect(starting).rejects.toThrow(/closed/)
    await closing
    expect(mockWS.isClosed).toBe(true)
  })

  it('propagates database-closed callback rejection during close instead of suppressing it', async () => {
    const { factory } = createMockFactory()
    let holdInboundReject!: (err: unknown) => void
    const holdInbound = new Promise<never>((_, reject) => {
      holdInboundReject = reject
    })
    const handleIncomingMessage = vi.fn(async (): Promise<IngressAcceptResult> => {
      await holdInbound
      return { deliveryKey: 'k', requestId: 'r', duplicate: false }
    })
    const transport = new FeishuTransport(
      { ...baseConfig, shutdownTimeoutMs: 200 },
      { handleIncomingMessage },
      undefined,
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )
    await transport.start()
    const raw = makeRealSdkFlattenedEvent()
    const inboundOp = transport.onIncomingMessageEvent(raw)
    const closing = transport.close()
    holdInboundReject(new Error('database closed: SQLite disk busy'))
    await expect(inboundOp).rejects.toThrow('database closed: SQLite disk busy')
    await expect(closing).rejects.toThrow('database closed: SQLite disk busy')
  })

  it('merges force-close exception occurring during drain into final close rejection', async () => {
    const { factory, mockWS } = createMockFactory()
    let drainHoldResolve!: () => void
    const drainHold = new Promise<void>((resolve) => {
      drainHoldResolve = resolve
    })
    const handleIncomingMessage = vi.fn(async (): Promise<IngressAcceptResult> => {
      await drainHold
      return { deliveryKey: 'k', requestId: 'r', duplicate: false }
    })
    let closeCallCount = 0
    mockWS.close = vi.fn(() => {
      closeCallCount++
      if (closeCallCount > 1) {
        throw new Error('Late force-close exception during drain')
      }
    })
    const transport = new FeishuTransport(
      { ...baseConfig, shutdownTimeoutMs: 200 },
      { handleIncomingMessage },
      undefined,
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )
    await transport.start()
    const raw = makeRealSdkFlattenedEvent()
    const inboundOp = transport.onIncomingMessageEvent(raw)
    const closing = transport.close()
    drainHoldResolve()
    await inboundOp
    await expect(closing).rejects.toThrow('Late force-close exception during drain')
  })

  it('close() waits for pending durable write and card callback to drain before settling', async () => {
    const { factory, mockDispatcher } = createMockFactory()
    let writeSettled = false
    let cardSettled = false

    const handleIncomingMessage = vi.fn(async (): Promise<IngressAcceptResult> => {
      await new Promise((r) => {
        setTimeout(r, 40)
      })
      writeSettled = true
      return { deliveryKey: 'k', requestId: 'r', duplicate: false }
    })
    const handleCardAction = vi.fn(async () => {
      await new Promise((r) => {
        setTimeout(r, 40)
      })
      cardSettled = true
      return { success: true, toast: 'Done' }
    })

    const transport = new FeishuTransport(
      { ...baseConfig, shutdownTimeoutMs: 1000 },
      { handleIncomingMessage },
      { handleCardAction },
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )
    await transport.start()

    const rawInbound = makeRealSdkFlattenedEvent()
    const rawCard = {
      event_type: 'card.action.trigger',
      open_id: 'ou_approver_1',
      tenant_key: 'tenant_test_xyz',
      open_chat_id: 'oc_test_chat_001',
      open_message_id: 'om_card_msg_001',
      action: { tag: 'button_click', value: {} },
    }

    const inboundPromise = mockDispatcher.invoke(rawInbound)
    const cardPromise = mockDispatcher.invoke(rawCard)

    await transport.close()
    expect(writeSettled).toBe(true)
    expect(cardSettled).toBe(true)
    await Promise.all([inboundPromise, cardPromise])
  })

  it('close() waits for pending outbound send to drain before settling', async () => {
    let sendSettled = false
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      await new Promise((r) => {
        setTimeout(r, 30)
      })
      sendSettled = true
      return new Response(
        JSON.stringify({
          code: 0,
          msg: 'ok',
          tenant_access_token: 't-mock',
          expire: 7200,
          data: { message_id: 'om_outbound_1' },
        }),
        { status: 200 },
      )
    })

    const transport = new FeishuTransport(
      { ...baseConfig, shutdownTimeoutMs: 1000 },
      { handleIncomingMessage: vi.fn() },
      undefined,
      { fetchFn: mockFetch },
    )

    const sendPromise = transport.sendTextMessage({
      chatId: 'oc_chat_1',
      text: 'Outbound test message',
    })

    await transport.close()
    expect(sendSettled).toBe(true)
    const result = await sendPromise
    expect(result.messageId).toBe('om_outbound_1')
  })

  it('refuses incoming messages, card actions, and outbound sends after close', async () => {
    const { factory } = createMockFactory()
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      { handleCardAction: vi.fn() },
      { clientFactory: factory },
    )
    await transport.start()
    await transport.close()

    await expect(transport.onIncomingMessageEvent({})).rejects.toThrow(/closed.*refused/)
    await expect(transport.onCardActionEvent({})).rejects.toThrow(/closed.*refused/)
    await expect(
      transport.sendTextMessage({ chatId: 'oc_1', text: 'Hi' }),
    ).rejects.toThrow(/closed.*refused/)
    await expect(
      transport.sendInteractiveCard('oc_1', { card: 'data' }),
    ).rejects.toThrow(/closed.*refused/)
  })

  it('rejects deterministic stale/duplicate/unauthorized card clicks with a negative static toast', async () => {
    const { factory, mockDispatcher } = createMockFactory()
    const handleCardAction = vi.fn(async () => {
      return { success: false, toast: 'Interaction already consumed or expired' }
    })
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      { handleCardAction },
      { clientFactory: factory },
    )
    await transport.start()

    const rawCard = {
      event_type: 'card.action.trigger',
      open_id: 'ou_approver_1',
      tenant_key: 'tenant_test_xyz',
      open_chat_id: 'oc_test_chat_001',
      open_message_id: 'om_card_msg_001',
      action: { tag: 'button_submit', value: { actionId: '550e8400-e29b-41d4-a716-446655440000' } },
    }

    const response = (await mockDispatcher.invoke(rawCard)) as {
      toast: { type: string; content: string }
    }
    expect(response.toast.type).toBe('warning')
    expect(response.toast.content).toBe('Interaction already consumed or expired')
    await transport.close()
  })

  it('rejects malformed card action with missing identity with a negative static toast', async () => {
    const { factory, mockDispatcher } = createMockFactory()
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      { handleCardAction: vi.fn() },
      { clientFactory: factory },
    )
    await transport.start()

    // Missing open_chat_id
    const malformedCard = {
      event_type: 'card.action.trigger',
      open_id: 'ou_approver_1',
      tenant_key: 'tenant_test_xyz',
      open_message_id: 'om_card_msg_001',
      action: { tag: 'button_submit' },
    }

    const response = (await mockDispatcher.invoke(malformedCard)) as {
      toast: { type: string; content: string }
    }
    expect(response.toast.type).toBe('warning')
    expect(response.toast.content).toContain('Card action rejected')
    await transport.close()
  })

  it('re-throws card action error when acceptor encounters persistence failure', async () => {
    const { factory, mockDispatcher } = createMockFactory()
    const handleCardAction = vi.fn(async () => {
      throw new Error('Storage disk failure')
    })
    const transport = new FeishuTransport(
      baseConfig,
      { handleIncomingMessage: vi.fn() },
      { handleCardAction },
      { clientFactory: factory },
    )
    await transport.start()

    const rawCard = {
      event_type: 'card.action.trigger',
      open_id: 'ou_approver_1',
      tenant_key: 'tenant_test_xyz',
      open_chat_id: 'oc_test_chat_001',
      open_message_id: 'om_card_msg_001',
      action: { tag: 'button_submit', value: {} },
    }

    await expect(mockDispatcher.invoke(rawCard)).rejects.toThrow('Storage disk failure')
    await transport.close()
  })

  it('preserves action.name and action.form_value in Card 2.0 with direct operator.open_id', () => {
    const card2WireEvent = {
      schema: '2.0',
      header: {
        app_id: 'cli_test_app_12345',
        tenant_key: 'tenant_test_xyz',
        event_id: 'evt_card_2_001',
        token: 'tok_123',
      },
      event: {
        operator: {
          open_id: 'ou_direct_operator_1',
          tenant_key: 'tenant_test_xyz',
        },
        context: {
          open_message_id: 'om_msg_card2_001',
          open_chat_id: 'oc_chat_card2_001',
        },
        action: {
          tag: 'button',
          name: 'question_550e8400-e29b-41d4-a716-446655440000',
          value: { option: 'o0' },
          form_value: { s0: 'Selected input answer' },
        },
      },
    }

    const normalized = normalizeFeishuCardAction(card2WireEvent, {
      expectedAppId: 'cli_test_app_12345',
    })

    expect(normalized.appId).toBe('cli_test_app_12345')
    expect(normalized.tenantKey).toBe('tenant_test_xyz')
    expect(normalized.chatId).toBe('oc_chat_card2_001')
    expect(normalized.openId).toBe('ou_direct_operator_1')
    expect(normalized.operatorId).toBe('ou_direct_operator_1')
    expect(normalized.openMessageId).toBe('om_msg_card2_001')
    expect(normalized.actionTag).toBe('button')
    expect(normalized.actionName).toBe('question_550e8400-e29b-41d4-a716-446655440000')
    expect(normalized.formValue).toEqual({ s0: 'Selected input answer' })
    expect(normalized.actionValue).toEqual({ option: 'o0' })
  })

  it('enforces inbound concurrency limit by rejecting requests exceeding maxInboundConcurrency', async () => {
    const { factory, mockDispatcher } = createMockFactory()
    let holdInboundResolve: () => void = () => {}
    const holdInbound = new Promise<void>((resolve) => {
      holdInboundResolve = resolve
    })

    const handleIncomingMessage = vi.fn(async (): Promise<IngressAcceptResult> => {
      await holdInbound
      return { deliveryKey: 'k', requestId: 'r', duplicate: false }
    })

    const transport = new FeishuTransport(
      { ...baseConfig, maxInboundConcurrency: 1 },
      { handleIncomingMessage },
      undefined,
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )
    await transport.start()

    const raw1 = makeRealSdkFlattenedEvent({ header: { event_id: 'evt_1' } })
    const raw2 = makeRealSdkFlattenedEvent({ header: { event_id: 'evt_2' } })

    const p1 = mockDispatcher.invoke(raw1)
    await expect(mockDispatcher.invoke(raw2)).rejects.toThrow(/concurrency limit.*exceeded/)

    holdInboundResolve()
    await p1
    await transport.close()
  })
})

describe('Real @larksuiteoapi/node-sdk EventDispatcher Integration', () => {
  it('parses real v2 event frame, invokes FeishuTransport, and awaits durable inbox write', async () => {
    let durableAdmitted = false
    const handleIncomingMessage = vi.fn(async (msg: IncomingImMessage): Promise<IngressAcceptResult> => {
      durableAdmitted = true
      return {
        deliveryKey: `feishu:${msg.appId}:${msg.eventId}`,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        duplicate: false,
      }
    })
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      referenceTimeMs: 1_700_000_005_000,
    })

    // Construct the real SDK EventDispatcher
    const realDispatcher = new lark.EventDispatcher({
      encryptKey: '',
      verificationToken: '',
    })

    // Register transport handler on real SDK dispatcher
    realDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => {
        return transport.onIncomingMessageEvent(data)
      },
    })

    // Raw wire v2 payload as delivered by Feishu WebSocket / webhook
    const rawV2WireEvent = makeValidRawFeishuEvent()

    // Real SDK invoke parses and flattens header + event
    const ack = (await realDispatcher.invoke(rawV2WireEvent, { needCheck: false })) as {
      code: number
      msg: string
    }

    expect(durableAdmitted).toBe(true)
    expect(ack).toEqual({
      code: 0,
      msg: 'admitted',
    })
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1)
    const callArg = handleIncomingMessage.mock.calls[0]?.[0]
    expect(callArg?.provider).toBe('feishu')
    expect(callArg?.appId).toBe('cli_test_app_12345')
    expect(callArg?.senderId).toBe('ou_human_operator_1')
    expect(callArg?.text).toBe('Hello, please inspect the system.')

    await transport.close()
  })

  it('re-throws when durable write fails inside real SDK EventDispatcher to ensure 500 response', async () => {
    const handleIncomingMessage = vi.fn(async () => {
      throw new Error('Database transaction lock conflict')
    })
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }

    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      referenceTimeMs: 1_700_000_005_000,
    })

    const realDispatcher = new lark.EventDispatcher({
      encryptKey: '',
      verificationToken: '',
    })

    realDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => {
        return transport.onIncomingMessageEvent(data)
      },
    })

    const rawV2WireEvent = makeValidRawFeishuEvent()

    // Real dispatcher must re-throw the error so WSClient catches it and sends code 500
    await expect(
      realDispatcher.invoke(rawV2WireEvent, { needCheck: false }),
    ).rejects.toThrow('Database transaction lock conflict')

    await transport.close()
  })

  it('drops bot messages cleanly through real SDK EventDispatcher without throwing', async () => {
    const handleIncomingMessage = vi.fn()
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }
    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      referenceTimeMs: 1_700_000_005_000,
    })
    const realDispatcher = new lark.EventDispatcher({ encryptKey: '', verificationToken: '' })
    realDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => transport.onIncomingMessageEvent(data),
    })

    const botEvent = makeValidRawFeishuEvent({
      sender: {
        sender_type: 'bot',
        sender_id: { open_id: 'ou_bot_1' },
      },
    })

    const result = (await realDispatcher.invoke(botEvent, { needCheck: false })) as {
      code: number
      msg: string
    }
    expect(result.code).toBe(0)
    expect(result.msg).toContain('Ignored')
    expect(handleIncomingMessage).not.toHaveBeenCalled()
    await transport.close()
  })

  it('rejects app ID mismatch through real SDK EventDispatcher by propagating error', async () => {
    const handleIncomingMessage = vi.fn()
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage,
    }
    const transport = new FeishuTransport(baseConfig, mockAcceptor, undefined, {
      referenceTimeMs: 1_700_000_005_000,
    })
    const realDispatcher = new lark.EventDispatcher({ encryptKey: '', verificationToken: '' })
    realDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => transport.onIncomingMessageEvent(data),
    })

    const foreignAppEvent = makeValidRawFeishuEvent({
      header: {
        app_id: 'cli_foreign_app_id_999',
      },
    })

    await expect(realDispatcher.invoke(foreignAppEvent, { needCheck: false })).rejects.toThrow(
      /APP_ID_MISMATCH/,
    )
    expect(handleIncomingMessage).not.toHaveBeenCalled()
    await transport.close()
  })

  it('verifies real SDK WSClient lifecycle instantiation and clean disposal', () => {
    const realClient = new lark.WSClient({
      appId: 'cli_test_app_12345',
      appSecret: 'test_secret_12345',
      autoReconnect: false,
    })

    expect(realClient).toBeDefined()
    const status = realClient.getConnectionStatus()
    expect(status.state).toBe('idle')

    // Clean disposal must not throw
    expect(() => {
      realClient.close({ force: true })
    }).not.toThrow()
  })
})
