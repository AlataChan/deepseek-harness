/**
 * DingTalk Stream platform transport managing stream connection lifecycle,
 * inbound robot message normalization, durable inbox ACK synchronization,
 * and safe outbound messaging.
 *
 * @module @deepseek-ai/dsh-experimental-im-dingtalk/dingtalk-transport
 */

import { z } from 'zod'
import {
  type IncomingImMessage,
  type IngressAcceptResult,
  type IngressDurableAcceptor,
} from './types.ts'
import {
  normalizeDingTalkMessage,
  type DingTalkNormalizerOptions,
  DingTalkNormalizerError,
} from './dingtalk-normalizer.ts'
import {
  DingTalkOutboundClient,
  type DingTalkOutboundConfig,
  type HttpFetchFn,
} from './dingtalk-outbound.ts'

/** Schema validating DingTalk transport configuration. */
export const dingTalkTransportConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  expectedCorpId: z.string().optional(),
  autoReconnect: z.boolean().default(false),
  keepAlive: z.boolean().default(true),
  maxMessageLength: z.number().int().positive().optional(),
  maxMessageBytes: z.number().int().positive().optional(),
  maxMessageAgeMs: z.number().int().positive().optional(),
  maxFutureSkewMs: z.number().int().positive().optional(),
  sendTimeoutMs: z.number().int().positive().optional(),
  shutdownTimeoutMs: z.number().int().positive().default(5000),
  connectTimeoutMs: z.number().int().positive().default(15000),
  maxPendingMessages: z.number().int().positive().default(64),
  allowedWebhookHosts: z.array(z.string()).optional(),
})

/** Configuration options for DingTalkTransport. */
export type DingTalkTransportConfig = z.input<typeof dingTalkTransportConfigSchema>

/** Standard DingTalk robot message subscription topic. */
export const TOPIC_ROBOT = '/v1.0/im/bot/messages/get'

/** Standard DingTalk stream callback acknowledgement enum values. */
export const EventAck = {
  SUCCESS: 'SUCCESS',
  LATER: 'LATER',
} as const

/** Processing status; robot callbacks require explicit socket acknowledgement. */
export type EventAckStatus = (typeof EventAck)[keyof typeof EventAck]

/** Structure of a down-stream event received over DingTalk WebSocket stream. */
export interface DingTalkDownStream {
  readonly headers?: {
    readonly messageId?: string
    readonly topic?: string
    readonly contentType?: string
  }
  readonly data: string | Record<string, unknown>
}

/** Acknowledgement payload returned by stream callback listener. */
export interface DingTalkCallbackAck {
  readonly status: EventAckStatus
}

/** Abstract stream client matching official dingtalk-stream DWClient interface. */
export interface DWClientLike {
  readonly connected: boolean
  registerCallbackListener(
    topic: string,
    listener: (res: DingTalkDownStream) => Promise<DingTalkCallbackAck>,
  ): this
  socketCallBackResponse(messageId: string, result: Record<string, never>): void
  connect(): Promise<void>
  disconnect(): Promise<void> | void
}

/** Factory for creating DWClient instances. */
export interface DingTalkClientFactory {
  createDWClient(config: DingTalkTransportConfig): DWClientLike
}

/** Dependencies injected into DingTalkTransport. */
export interface DingTalkTransportDependencies {
  readonly clientFactory?: DingTalkClientFactory | undefined
  readonly fetchFn?: HttpFetchFn | undefined
  readonly referenceTimeMs?: number | undefined
}

/**
 * Concrete DingTalk Stream platform transport.
 *
 * Responsibilities:
 * 1. Manages DWClient stream lifecycle (start, bounded graceful close, no network on import).
 * 2. Normalizes inbound robot messages and enforces security invariants:
 *    - Rejects group chats (conversationType === '2'), non-text, foreign corpId, expired and oversized messages.
 * 3. Awaits durable inbox persistence before returning EventAck.SUCCESS;
 *    write failure returns EventAck.LATER or throws, ensuring DingTalk retries without message loss.
 * 4. Dispatches outbound replies via validated sessionWebhook URLs with SSRF protection.
 */
export class DingTalkTransport {
  private readonly config: z.output<typeof dingTalkTransportConfigSchema>
  private readonly inboundAcceptor: IngressDurableAcceptor
  private readonly outboundClient: DingTalkOutboundClient
  private readonly clientFactory: DingTalkClientFactory | undefined
  private readonly referenceTimeMs: number | undefined

  private dwClient: DWClientLike | null = null
  private isStarted = false
  private isClosed = false
  private startPromise: Promise<void> | null = null
  private closePromise: Promise<void> | null = null
  private readonly inFlightSends = new Set<Promise<{ status: 'sent' }>>()

  /** Tracks in-flight incoming message processing to await during shutdown. */
  private readonly inFlightHandshakes = new Set<Promise<unknown>>()

  /** Read the current SDK stream state.
   * @returns Whether the owned stream reports connected.
   */
  isConnected(): boolean { return !this.shutdownRequested() && this.dwClient?.connected === true }

  constructor(
    config: DingTalkTransportConfig,
    inboundAcceptor: IngressDurableAcceptor,
    deps: DingTalkTransportDependencies = {},
  ) {
    this.config = dingTalkTransportConfigSchema.parse(config)
    this.inboundAcceptor = inboundAcceptor
    this.clientFactory = deps.clientFactory
    this.referenceTimeMs = deps.referenceTimeMs

    const outboundConfig: DingTalkOutboundConfig = {
      ...(this.config.sendTimeoutMs !== undefined ? { timeoutMs: this.config.sendTimeoutMs } : {}),
      ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
      ...(this.config.allowedWebhookHosts !== undefined
        ? { allowedWebhookHosts: this.config.allowedWebhookHosts }
        : {}),
    }
    this.outboundClient = new DingTalkOutboundClient(outboundConfig)
  }

  /**
   * Start the transport: registers topic listener and connects DingTalk Stream client.
   * Safe against concurrent invocations; no network activity occurs before this method.
   */
  async start(): Promise<void> {
    if (this.isClosed) throw new Error('Cannot start closed DingTalkTransport')
    if (this.isStarted) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.doStart()
    try {
      await deadline(this.startPromise, this.config.connectTimeoutMs, 'DingTalk connection timed out')
    } catch (error) {
      await this.close()
      throw error
    } finally {
      this.startPromise = null
    }
  }

  private async doStart(): Promise<void> {
    if (this.clientFactory) {
      this.dwClient = this.clientFactory.createDWClient(this.config)
    } else {
      try {
        const streamSdk = await import('dingtalk-stream')
        const client = new streamSdk.DWClient({
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          keepAlive: this.config.keepAlive,
        })
        client.config.autoReconnect = this.config.autoReconnect
        this.dwClient = client
      } catch (err) {
        throw new Error(
          `Failed to load dingtalk-stream (inject clientFactory or install dependency): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    if (this.shutdownRequested()) {
      await this.dwClient.disconnect()
      return
    }
    this.dwClient.registerCallbackListener(
      TOPIC_ROBOT,
      async (res: DingTalkDownStream) => this.onIncomingStreamMessage(res),
    )

    await this.dwClient.connect()
    if (!this.shutdownRequested() && !this.dwClient.connected) {
      throw new Error('DingTalk SDK did not establish a stream connection')
    }
    this.isStarted = true

    if (this.shutdownRequested()) {
      await this.dwClient.disconnect()
      this.dwClient = null
      this.isStarted = false
    }
  }

  /**
   * Handle an incoming message frame from DingTalk Stream.
   * Exposed for testing and called by stream listener.
   *
   * @param res - Down-stream frame containing headers and data.
   * @returns EventAck acknowledgement payload.
   */
  onIncomingStreamMessage(res: DingTalkDownStream): Promise<DingTalkCallbackAck> {
    if (this.isClosed || this.inFlightHandshakes.size >= this.config.maxPendingMessages) {
      return Promise.resolve({ status: EventAck.LATER })
    }
    const header = z.object({ messageId: z.string().min(1), topic: z.literal(TOPIC_ROBOT) }).safeParse(res.headers)
    if (!header.success) return Promise.resolve({ status: EventAck.LATER })
    // EventEmitter ignores callback return values. Contain failures and ACK explicitly.
    const operation = Promise.resolve().then(async (): Promise<DingTalkCallbackAck> => {
      try {
        const ack = await this.processIncomingStreamMessage(res)
        if (ack.status === EventAck.SUCCESS && !this.isClosed) {
          this.dwClient?.socketCallBackResponse(header.data.messageId, {})
        }
        return ack
      } catch {
        // Withholding the socket ACK lets the platform redeliver after an uncertain write.
        return { status: EventAck.LATER }
      }
    })
    this.inFlightHandshakes.add(operation)
    void operation.then(() => this.inFlightHandshakes.delete(operation))
    return operation
  }

  private async processIncomingStreamMessage(res: DingTalkDownStream): Promise<DingTalkCallbackAck> {
    const normalizerOptions: DingTalkNormalizerOptions = {
      expectedClientId: this.config.clientId,
      ...(this.config.expectedCorpId !== undefined ? { expectedCorpId: this.config.expectedCorpId } : {}),
      ...(this.config.maxMessageLength !== undefined
        ? { maxMessageLength: this.config.maxMessageLength }
        : {}),
      ...(this.config.maxMessageBytes !== undefined ? { maxMessageBytes: this.config.maxMessageBytes } : {}),
      ...(this.config.maxMessageAgeMs !== undefined ? { maxMessageAgeMs: this.config.maxMessageAgeMs } : {}),
      ...(this.config.maxFutureSkewMs !== undefined ? { maxFutureSkewMs: this.config.maxFutureSkewMs } : {}),
      ...(this.referenceTimeMs !== undefined ? { referenceTimeMs: this.referenceTimeMs } : {}),
      ...(this.config.allowedWebhookHosts !== undefined
        ? { allowedWebhookHosts: this.config.allowedWebhookHosts }
        : {}),
    }

    let normalized: IncomingImMessage
    try {
      normalized = normalizeDingTalkMessage(res, normalizerOptions)
    } catch (err) {
      if (err instanceof DingTalkNormalizerError) {
        // Drop client-filtered events cleanly with SUCCESS so DingTalk does not retry
        if (
          err.code === 'NON_P2P_CHAT' ||
          err.code === 'UNSUPPORTED_FORMAT' ||
          err.code === 'MESSAGE_EXPIRED' ||
          err.code === 'FUTURE_TIMESTAMP'
        ) {
          return { status: EventAck.SUCCESS }
        }
      }
      // Security or boundary violations (SSRF violation, malformed data) return LATER to retry/log
      return { status: EventAck.LATER }
    }

    // Await durable inbox write before ACK; never awaits model loop.
    const trackPromise = this.inboundAcceptor.handleIncomingMessage(normalized)
    try {
      const result: IngressAcceptResult = await trackPromise
      void result
      return { status: EventAck.SUCCESS }
    } catch {
      // On durable write failure, yield LATER so stream resends
      return { status: EventAck.LATER }
    }
  }

  /**
   * Send a reply message to a sessionWebhook URL.
   *
   * @param webhookUrl - Untrusted sessionWebhook URL from incoming message.
   * @param text - Raw message text to send.
   * @returns Explicit platform acceptance, without inventing a message identifier.
   */
  sendSessionWebhookReply(webhookUrl: string, text: string): Promise<{ status: 'sent' }> {
    if (this.isClosed) return Promise.reject(new Error('DingTalk transport is closed'))
    const operation = this.outboundClient.sendSessionWebhookReply(webhookUrl, text)
    this.inFlightSends.add(operation)
    void operation.then(() => this.inFlightSends.delete(operation), () => this.inFlightSends.delete(operation))
    return operation
  }

  /**
   * Gracefully close the transport:
   * 1. Disconnects stream client.
   * 2. Bounded await on in-flight durable inbox writes (guarded by shutdownTimeoutMs).
   */
  close(): Promise<void> {
    if (!this.closePromise) {
      this.isClosed = true
      this.isStarted = false
      this.closePromise = deadline(this.doClose(), this.config.shutdownTimeoutMs, 'DingTalk shutdown did not reach quiescence')
    }
    return this.closePromise
  }

  private shutdownRequested(): boolean { return this.isClosed }

  private async doClose(): Promise<void> {
    const disconnect = Promise.resolve().then(() => this.dwClient?.disconnect())
    const startup = this.startPromise?.then(async () => { await this.dwClient?.disconnect() })
    await Promise.all([disconnect, startup,
      Promise.allSettled([...this.inFlightHandshakes, ...this.inFlightSends])])
    this.dwClient = null
  }
}

async function deadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() =>{  reject(new Error(message)) }, timeoutMs)
    })])
  } finally {
    clearTimeout(timer)
  }
}
