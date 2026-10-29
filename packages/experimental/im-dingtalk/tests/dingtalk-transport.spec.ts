import { describe, expect, it, vi } from 'vitest'
import { DWClient, EventAck as RealEventAck, TOPIC_ROBOT as REAL_TOPIC_ROBOT } from 'dingtalk-stream'
import {
  DingTalkTransport,
  TOPIC_ROBOT,
  EventAck,
  type DWClientLike,
  type DingTalkClientFactory,
  type DingTalkDownStream,
  type DingTalkCallbackAck,
  type DingTalkTransportConfig,
} from '../src/dingtalk-transport.ts'
import {
  normalizeDingTalkMessage,
  validateSessionWebhookUrl,
  sanitizeDingTalkOutboundText,
  DingTalkNormalizerError,
} from '../src/dingtalk-normalizer.ts'
import {
  DingTalkOutboundClient,
  DingTalkAmbiguousTimeoutError,
  DingTalkOutboundError,
  type HttpFetchFn,
} from '../src/dingtalk-outbound.ts'
import type {
  IncomingImMessage,
  IngressAcceptResult,
  IngressDurableAcceptor,
} from '../src/types.ts'

class MockDWClient implements DWClientLike {
  public connected = false
  public isDisconnected = false
  public readonly listeners = new Map<
    string,
    (res: DingTalkDownStream) => Promise<DingTalkCallbackAck>
  >()
  public readonly socketAcks: Array<{ messageId: string; result: Record<string, never> }> = []

  registerCallbackListener(
    topic: string,
    listener: (res: DingTalkDownStream) => Promise<DingTalkCallbackAck>,
  ): this {
    this.listeners.set(topic, listener)
    return this
  }

  socketCallBackResponse(messageId: string, result: Record<string, never>): void {
    this.socketAcks.push({ messageId, result })
  }

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.isDisconnected = true
    this.connected = false
  }

  async emitStreamMessage(
    topic: string,
    res: DingTalkDownStream,
  ): Promise<DingTalkCallbackAck | undefined> {
    if (this.listeners.has(topic)) {
      return this.listeners.get(topic)!(res)
    }
    return undefined
  }
}

function createMockFactory(): {
  factory: DingTalkClientFactory
  mockClient: MockDWClient
} {
  const mockClient = new MockDWClient()
  const factory: DingTalkClientFactory = {
    createDWClient: () => mockClient,
  }
  return { factory, mockClient }
}

const baseConfig: DingTalkTransportConfig = {
  clientId: 'ding_client_12345',
  clientSecret: 'secret_abc123',
  expectedCorpId: 'corp_test_xyz',
  maxMessageLength: 1000,
  maxMessageBytes: 2000,
  maxMessageAgeMs: 60_000,
  maxFutureSkewMs: 30_000,
  sendTimeoutMs: 1000,
  shutdownTimeoutMs: 100,
}

function makeValidDingTalkStreamFrame(overrides: Record<string, unknown> = {}): DingTalkDownStream {
  const now = 1_700_000_000_000
  const data = {
    conversationId: 'cid_12345678',
    conversationType: '1', // 1-on-1 private chat
    chatbotUserId: 'bot_usr_001',
    msgId: 'msg_stream_001',
    senderId: 'usr_dingtalk_sender_1',
    senderCorpId: 'corp_test_xyz',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=mock_valid_session_token',
    sessionWebhookExpiredTime: now + 3600_000,
    createAt: now,
    msgtype: 'text',
    text: {
      content: 'Hello DeepSeek Harness via DingTalk stream!',
    },
    ...overrides,
  }

  return {
    headers: {
      messageId: 'event_stream_msg_001',
      topic: TOPIC_ROBOT,
      contentType: 'application/json',
    },
    data: JSON.stringify(data),
  }
}

describe('DingTalk Normalizer and SSRF Security', () => {
  it('normalizes valid 1-on-1 private chat message', () => {
    const frame = makeValidDingTalkStreamFrame()
    const now = 1_700_000_000_000
    const normalized = normalizeDingTalkMessage(frame, {
      expectedClientId: 'ding_client_12345',
      expectedCorpId: 'corp_test_xyz',
      referenceTimeMs: 1_700_000_005_000,
    })

    expect(normalized).toEqual({
      provider: 'dingtalk',
      appId: 'ding_client_12345',
      tenantId: 'corp_test_xyz',
      chatId: 'cid_12345678',
      senderId: 'usr_dingtalk_sender_1',
      eventId: 'msg_stream_001',
      messageId: 'msg_stream_001',
      replyRoute: {
        kind: 'dingtalk-session-webhook',
        url: 'https://oapi.dingtalk.com/robot/sendBySession?session=mock_valid_session_token',
        expiresAt: now + 3600_000,
      },
      createTime: now,
      chatType: 'p2p',
      text: 'Hello DeepSeek Harness via DingTalk stream!',
    })
  })

  it('rejects group chats with NON_P2P_CHAT code', () => {
    const frame = makeValidDingTalkStreamFrame({
      conversationType: '2', // Group chat
    })
    expect(() =>
      normalizeDingTalkMessage(frame, {
        expectedClientId: 'ding_client_12345',
        expectedCorpId: 'corp_test_xyz',
      }),
    ).toThrow(DingTalkNormalizerError)
    expect(() =>
      normalizeDingTalkMessage(frame, {
        expectedClientId: 'ding_client_12345',
        expectedCorpId: 'corp_test_xyz',
      }),
    ).toThrow(/NON_P2P_CHAT/)
  })

  it('rejects foreign enterprise corp events with CORP_ID_MISMATCH', () => {
    const frame = makeValidDingTalkStreamFrame({
      senderCorpId: 'corp_foreign_evil',
    })
    expect(() =>
      normalizeDingTalkMessage(frame, {
        expectedClientId: 'ding_client_12345',
        expectedCorpId: 'corp_my_company',
      }),
    ).toThrow(/CORP_ID_MISMATCH/)
  })

  it('rejects oversized prompt content exceeding byte limit', () => {
    const frame = makeValidDingTalkStreamFrame({
      text: { content: '钉钉超长测试消息'.repeat(100) },
    })
    expect(() =>
      normalizeDingTalkMessage(frame, {
        expectedClientId: 'ding_client_12345',
        expectedCorpId: 'corp_test_xyz',
        maxMessageBytes: 50,
      }),
    ).toThrow(/MESSAGE_OVERSIZED/)
  })

  it('rejects future timestamps exceeding clock skew tolerance', () => {
    const frame = makeValidDingTalkStreamFrame({
      createAt: 1_700_000_100_000,
    })
    expect(() =>
      normalizeDingTalkMessage(frame, {
        expectedClientId: 'ding_client_12345',
        expectedCorpId: 'corp_test_xyz',
        referenceTimeMs: 1_700_000_000_000,
        maxFutureSkewMs: 30_000,
      }),
    ).toThrow(/FUTURE_TIMESTAMP/)
  })

  it('rejects expired messages exceeding freshness window', () => {
    const frame = makeValidDingTalkStreamFrame({
      createAt: 1_700_000_000_000,
    })
    expect(() =>
      normalizeDingTalkMessage(frame, {
        expectedClientId: 'ding_client_12345',
        expectedCorpId: 'corp_test_xyz',
        referenceTimeMs: 1_700_000_500_000,
        maxMessageAgeMs: 60_000,
      }),
    ).toThrow(/MESSAGE_EXPIRED/)
  })

  describe('SSRF Prevention for sessionWebhook', () => {
    it('approves official HTTPS DingTalk domains', () => {
      const url1 = validateSessionWebhookUrl(
        'https://oapi.dingtalk.com/robot/sendBySession?session=xyz',
      )
      expect(url1.hostname).toBe('oapi.dingtalk.com')

      const url2 = validateSessionWebhookUrl(
        'https://api.dingtalk.com/v1.0/robot/sendBySession?session=xyz',
      )
      expect(url2.hostname).toBe('api.dingtalk.com')
    })

    it('rejects non-HTTPS unencrypted protocols', () => {
      expect(() =>
        validateSessionWebhookUrl('http://oapi.dingtalk.com/robot/sendBySession'),
      ).toThrow(/protocol must be https:/)
    })

    it('rejects localhost and loopback IP addresses (127.0.0.1, ::1)', () => {
      expect(() =>
        validateSessionWebhookUrl('https://127.0.0.1:8080/internal-api'),
      ).toThrow(DingTalkNormalizerError)

      expect(() =>
        validateSessionWebhookUrl('https://localhost:3000/steal-tokens'),
      ).toThrow(DingTalkNormalizerError)
    })

    it('rejects internal RFC1918 private IP addresses (10.x, 192.168.x)', () => {
      expect(() =>
        validateSessionWebhookUrl('https://10.0.0.5/admin'),
      ).toThrow(DingTalkNormalizerError)

      expect(() =>
        validateSessionWebhookUrl('https://192.168.1.1/router'),
      ).toThrow(DingTalkNormalizerError)
    })

    it('rejects arbitrary external domains not on the approved whitelist', () => {
      expect(() =>
        validateSessionWebhookUrl('https://attacker-controlled.site/capture'),
      ).toThrow(DingTalkNormalizerError)
    })
  })

  it('sanitizes outbound text by stripping thinking tags and redacting keys', () => {
    const raw = `
<think>
Internal thought: leaking secrets
</think>
Done!
Authorization: Bearer my_secret_token
`
    const clean = sanitizeDingTalkOutboundText(raw)
    expect(clean).not.toContain('<think>')
    expect(clean).not.toContain('leaking secrets')
    expect(clean).not.toContain('my_secret_token')
    expect(clean).toContain('Bearer [REDACTED]')
    expect(clean).toContain('Done!')
  })
})

describe('DingTalkOutboundClient', () => {
  it('dispatches sanitized text to valid sessionWebhook and blocks redirects', async () => {
    let capturedInit: RequestInit | undefined
    const mockFetch: HttpFetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 })
    })

    const client = new DingTalkOutboundClient({ fetchFn: mockFetch })
    const result = await client.sendSessionWebhookReply(
      'https://oapi.dingtalk.com/robot/sendBySession?session=mock_tok',
      '<think>thought</think>Here is the response.',
    )

    expect(result.status).toBe('sent')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(capturedInit?.redirect).toBe('error') // Redirects strictly blocked
    expect(capturedInit?.body).toContain('Here is the response.')
  })

  it('rejects SSRF destination before sending any network request', async () => {
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      return new Response('{}', { status: 200 })
    })
    const client = new DingTalkOutboundClient({ fetchFn: mockFetch })

    await expect(
      client.sendSessionWebhookReply('https://127.0.0.1:9090/pwn', 'test'),
    ).rejects.toThrow(DingTalkNormalizerError)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('marks status as UNKNOWN on ambiguous timeout and NEVER retries automatically', async () => {
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })

    const client = new DingTalkOutboundClient({
      timeoutMs: 100,
      fetchFn: mockFetch,
    })

    let caught: unknown
    try {
      await client.sendSessionWebhookReply(
        'https://oapi.dingtalk.com/robot/sendBySession?session=mock_tok',
        'Command to execute',
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(DingTalkAmbiguousTimeoutError)
    const timeoutErr = caught as DingTalkAmbiguousTimeoutError
    expect(timeoutErr.status).toBe('unknown')
    expect(timeoutErr.message).toContain('delivery status is UNKNOWN (do not retry)')
    expect(mockFetch).toHaveBeenCalledTimes(1) // No automatic retry
  })

  it('marks status as UNKNOWN on network socket reset after dispatch', async () => {
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNRESET')
    })

    const client = new DingTalkOutboundClient({
      timeoutMs: 500,
      fetchFn: mockFetch,
    })

    let caught: unknown
    try {
      await client.sendSessionWebhookReply(
        'https://oapi.dingtalk.com/robot/sendBySession?session=mock_tok',
        'Command to execute',
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(DingTalkAmbiguousTimeoutError)
    const timeoutErr = caught as DingTalkAmbiguousTimeoutError
    expect(timeoutErr.status).toBe('unknown')
    expect(timeoutErr.message).toContain('delivery status is unknown (do not retry)')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('marks status as UNKNOWN when DingTalk responds with HTTP 500 or HTTP 408', async () => {
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Server unavailable' }), {
        status: 500,
        statusText: 'Internal Server Error',
      })
    })

    const client = new DingTalkOutboundClient({ fetchFn: mockFetch })
    await expect(
      client.sendSessionWebhookReply(
        'https://oapi.dingtalk.com/robot/sendBySession?session=tok',
        'text',
      ),
    ).rejects.toThrow(DingTalkAmbiguousTimeoutError)
  })

  it('marks status as UNKNOWN when DingTalk responds with malformed JSON body', async () => {
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      return new Response('Invalid Non-JSON Content', { status: 200 })
    })

    const client = new DingTalkOutboundClient({ fetchFn: mockFetch })
    await expect(
      client.sendSessionWebhookReply(
        'https://oapi.dingtalk.com/robot/sendBySession?session=tok',
        'text',
      ),
    ).rejects.toThrow(DingTalkAmbiguousTimeoutError)
  })

  it('throws DingTalkOutboundError on deterministic platform rejection', async () => {
    const mockFetch: HttpFetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ errcode: 300001, errmsg: 'token expired' }), {
        status: 200,
      })
    })

    const client = new DingTalkOutboundClient({ fetchFn: mockFetch })
    await expect(
      client.sendSessionWebhookReply(
        'https://oapi.dingtalk.com/robot/sendBySession?session=expired',
        'text',
      ),
    ).rejects.toThrow(DingTalkOutboundError)
  })
})

describe('DingTalkTransport Stream Lifecycle and Durable ACK', () => {
  it('subscribes to TOPIC_ROBOT and sends explicit socket ACK after durable write', async () => {
    const { factory, mockClient } = createMockFactory()

    let durableWriteFinished = false
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(async (msg: IncomingImMessage): Promise<IngressAcceptResult> => {
        await new Promise(r => setTimeout(r, 20))
        durableWriteFinished = true
        return {
          deliveryKey: `dingtalk:${msg.appId}:${msg.eventId}`,
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          duplicate: false,
        }
      }),
    }

    const acceptorCalls = vi.spyOn(mockAcceptor, 'handleIncomingMessage')
    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()
    expect(mockClient.connected).toBe(true)
    expect(mockClient.listeners.has(TOPIC_ROBOT)).toBe(true)

    const frame = makeValidDingTalkStreamFrame()
    const ack = await mockClient.emitStreamMessage(TOPIC_ROBOT, frame)

    expect(durableWriteFinished).toBe(true)
    expect(ack).toEqual({ status: EventAck.SUCCESS })
    expect(acceptorCalls).toHaveBeenCalledTimes(1)
    expect(mockClient.socketAcks).toEqual([
      { messageId: 'event_stream_msg_001', result: {} },
    ])

    await transport.close()
    expect(mockClient.isDisconnected).toBe(true)
  })

  it('acknowledges duplicate deliveries cleanly with EventAck.SUCCESS and socket ACK', async () => {
    const { factory, mockClient } = createMockFactory()

    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(async (): Promise<IngressAcceptResult> => ({
        deliveryKey: 'dingtalk:ding_client_12345:msg_stream_001',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        duplicate: true,
      })),
    }

    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const frame = makeValidDingTalkStreamFrame()
    const ack = await mockClient.emitStreamMessage(TOPIC_ROBOT, frame)

    expect(ack).toEqual({ status: EventAck.SUCCESS })
    expect(mockClient.socketAcks).toEqual([
      { messageId: 'event_stream_msg_001', result: {} },
    ])

    await transport.close()
  })

  it('withholds socket ACK and returns EventAck.LATER when durable write fails', async () => {
    const { factory, mockClient } = createMockFactory()

    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(async () => {
        throw new Error('SQLite disk full')
      }),
    }

    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const frame = makeValidDingTalkStreamFrame()
    const ack = await mockClient.emitStreamMessage(TOPIC_ROBOT, frame)

    expect(ack).toEqual({ status: EventAck.LATER })
    // Crucial requirement: socket ACK is withheld on failure so stream redelivers!
    expect(mockClient.socketAcks).toEqual([])

    await transport.close()
  })

  it('drops filtered events (group chats, expired) cleanly with SUCCESS without calling acceptor', async () => {
    const { factory, mockClient } = createMockFactory()

    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(),
    }

    const acceptorCalls = vi.spyOn(mockAcceptor, 'handleIncomingMessage')
    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: factory,
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    // Group chat
    const groupFrame = makeValidDingTalkStreamFrame({ conversationType: '2' })
    const ack = await mockClient.emitStreamMessage(TOPIC_ROBOT, groupFrame)

    expect(ack).toEqual({ status: EventAck.SUCCESS })
    expect(acceptorCalls).not.toHaveBeenCalled()
    expect(mockClient.socketAcks).toEqual([
      { messageId: 'event_stream_msg_001', result: {} },
    ])

    await transport.close()
  })

  it('bounds shutdown timeout if an in-flight handshake hangs', async () => {
    const { factory, mockClient } = createMockFactory()

    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(() => new Promise<never>(() => {})),
    }

    const transport = new DingTalkTransport(
      { ...baseConfig, shutdownTimeoutMs: 50 },
      mockAcceptor,
      { clientFactory: factory, referenceTimeMs: 1_700_000_005_000 },
    )

    await transport.start()

    const frame = makeValidDingTalkStreamFrame()
    void mockClient.emitStreamMessage(TOPIC_ROBOT, frame)

    const start = Date.now()
    await expect(transport.close()).rejects.toThrow('DingTalk shutdown did not reach quiescence')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('is idempotent when start() is called concurrently', async () => {
    const { factory, mockClient } = createMockFactory()
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(),
    }

    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: factory,
    })

    await Promise.all([transport.start(), transport.start(), transport.start()])
    expect(mockClient.connected).toBe(true)

    await transport.close()
  })
})

describe('Real dingtalk-stream DWClient Integration', () => {
  it('instantiates real DWClient and verifies constants and topic registration', () => {
    expect(REAL_TOPIC_ROBOT).toBe('/v1.0/im/bot/messages/get')
    expect(RealEventAck.SUCCESS).toBe('SUCCESS')
    expect(RealEventAck.LATER).toBe('LATER')

    const realClient = new DWClient({
      clientId: 'ding_test_client_id',
      clientSecret: 'ding_test_secret',
    })

    expect(realClient).toBeDefined()
    expect(typeof realClient.registerCallbackListener).toBe('function')
    expect(typeof realClient.connect).toBe('function')
    expect(typeof realClient.disconnect).toBe('function')

    // Disconnect before connect is safe
    expect(() => { realClient.disconnect() }).not.toThrow()
  })

  it('routes stream message through real DWClient and sends explicit socket ACK on durable write success', async () => {
    let durableAdmitted = false
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(async (msg: IncomingImMessage): Promise<IngressAcceptResult> => {
        durableAdmitted = true
        return {
          deliveryKey: `dingtalk:${msg.appId}:${msg.eventId}`,
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          duplicate: false,
        }
      }),
    }

    const realClient = new DWClient({
      clientId: 'ding_client_12345',
      clientSecret: 'secret_abc123',
    })
    realClient.connect = vi.fn(async () => {
      realClient.connected = true
    })
    realClient.disconnect = vi.fn(() => {
      realClient.connected = false
    })
    const sendSpy = vi.spyOn(realClient, 'send').mockImplementation(() => {})

    const acceptorCalls = vi.spyOn(mockAcceptor, 'handleIncomingMessage')
    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: { createDWClient: () => realClient },
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const frame = makeValidDingTalkStreamFrame()
    const downstreamPayload = JSON.stringify({
      type: 'CALLBACK',
      headers: frame.headers,
      data: frame.data,
    })
    realClient.onDownStream(downstreamPayload)

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(durableAdmitted).toBe(true)
    expect(acceptorCalls).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledWith('event_stream_msg_001', { response: {} })

    await transport.close()
  })

  it('withholds socket ACK through real DWClient when durable write fails (negative control)', async () => {
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(async () => {
        throw new Error('Database disk failure')
      }),
    }

    const realClient = new DWClient({
      clientId: 'ding_client_12345',
      clientSecret: 'secret_abc123',
    })
    realClient.connect = vi.fn(async () => {
      realClient.connected = true
    })
    realClient.disconnect = vi.fn(() => {
      realClient.connected = false
    })
    const sendSpy = vi.spyOn(realClient, 'send').mockImplementation(() => {})

    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: { createDWClient: () => realClient },
      referenceTimeMs: 1_700_000_005_000,
    })

    await transport.start()

    const frame = makeValidDingTalkStreamFrame()
    const downstreamPayload = JSON.stringify({
      type: 'CALLBACK',
      headers: frame.headers,
      data: frame.data,
    })
    realClient.onDownStream(downstreamPayload)

    await new Promise(resolve => setTimeout(resolve, 50))

    // Negative control verification: no ACK sent over socket on durable write failure!
    expect(sendSpy).not.toHaveBeenCalled()

    await transport.close()
  })

  it('rejects start() when real DWClient connect() resolves without establishing connection', async () => {
    const mockAcceptor: IngressDurableAcceptor = {
      handleIncomingMessage: vi.fn(),
    }

    const realClient = new DWClient({
      clientId: 'ding_client_12345',
      clientSecret: 'secret_abc123',
    })
    // SDK connect swallows error and resolves while connected remains false
    realClient.connect = vi.fn(async () => {
      realClient.connected = false
    })
    realClient.disconnect = vi.fn(() => {})

    const transport = new DingTalkTransport(baseConfig, mockAcceptor, {
      clientFactory: { createDWClient: () => realClient },
    })

    await expect(transport.start()).rejects.toThrow(
      'DingTalk SDK did not establish a stream connection',
    )
  })
})
