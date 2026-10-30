/**
 * Feishu IM platform transport managing WebSocket connection lifecycle,
 * inbound event normalization, durable inbox ACK synchronization,
 * and safe outbound messaging.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/feishu-transport
 */

import { z } from 'zod'
import {
  type IncomingImMessage,
  type IngressAcceptResult,
  type IngressDurableAcceptor,
} from './types.ts'
import {
  normalizeFeishuMessage,
  normalizeFeishuCardAction,
  type FeishuNormalizerOptions,
  type NormalizedFeishuCardAction,
  FeishuNormalizerError,
} from './feishu-normalizer.ts'
import {
  FeishuOutboundClient,
  type FeishuOutboundConfig,
  type FeishuSendTextRequest,
  type FeishuSendTextResult,
  type HttpFetchFn,
} from './feishu-outbound.ts'

const officialOriginSchema = z.string().refine(
  (val) => {
    try {
      const u = new URL(val)
      return (
        u.protocol === 'https:' &&
        ['open.feishu.cn', 'open.larksuite.com'].includes(u.hostname) &&
        !u.port &&
        !u.username &&
        !u.password &&
        u.pathname === '/' &&
        !u.search &&
        !u.hash
      )
    } catch {
      return false
    }
  },
  {
    message:
      'Feishu API domain must be an official HTTPS origin (https://open.feishu.cn or https://open.larksuite.com)',
  },
)

/** Schema validating Feishu transport configuration. */
export const feishuTransportConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  domain: officialOriginSchema.default('https://open.feishu.cn'),
  encryptKey: z.string().optional(),
  verificationToken: z.string().optional(),
  maxMessageLength: z.number().int().positive().default(32_768),
  maxMessageBytes: z.number().int().positive().default(32_768),
  maxMessageAgeMs: z.number().int().positive().default(300_000),
  maxFutureSkewMs: z.number().int().positive().default(30_000),
  startupTimeoutMs: z.number().int().positive().default(10_000),
  sendTimeoutMs: z.number().int().positive().default(10_000),
  shutdownTimeoutMs: z.number().int().positive().default(5_000),
  maxInboundConcurrency: z.number().int().positive().default(100),
  autoReconnect: z.boolean().default(true),
  connectionStatusPollIntervalMs: z.number().int().min(1).max(5_000).default(10),
})

/** Input configuration options for FeishuTransport (with optional defaults). */
export type FeishuTransportInputConfig = z.input<typeof feishuTransportConfigSchema>

/** Resolved internal configuration for FeishuTransport. */
export type FeishuTransportConfig = z.output<typeof feishuTransportConfigSchema>

/**
 * Narrow durable acceptor contract for card action callbacks.
 * Handed off directly to runtime authorization; never accepts natural-language approvals.
 */
export interface CardActionDurableAcceptor {
  handleCardAction(action: NormalizedFeishuCardAction): Promise<{
    readonly success: boolean
    readonly toast?: string
    readonly customData?: unknown
  }>
}

/** Abstract event dispatcher matching @larksuiteoapi/node-sdk EventDispatcher interface. */
export interface FeishuEventDispatcherLike {
  register(handlers: Record<string, (data: unknown) => Promise<unknown>>): this
  invoke(data: unknown, options?: { needCheck?: boolean }): Promise<unknown>
}

/** Recognized WebSocket connection lifecycle states from SDK. */
export type FeishuWSConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'

/** Status snapshot returned by WebSocket client. */
export interface FeishuWSConnectionStatus {
  readonly state: FeishuWSConnectionState
  readonly lastConnectTime?: number | undefined
  readonly nextConnectTime?: number | undefined
  readonly reconnectAttempts?: number | undefined
}

/** Abstract WebSocket client matching @larksuiteoapi/node-sdk WSClient interface. */
export interface FeishuWSClientLike {
  start(params: { eventDispatcher: FeishuEventDispatcherLike }): Promise<void>
  close(params?: { force?: boolean }): void
  getConnectionStatus(): FeishuWSConnectionStatus
}

/** Factory for creating WebSocket client and event dispatcher instances. */
export interface FeishuClientFactory {
  createWSClient(config: FeishuTransportConfig): FeishuWSClientLike
  createEventDispatcher(config: FeishuTransportConfig): FeishuEventDispatcherLike
}

/** Dependencies injected into FeishuTransport. */
export interface FeishuTransportDependencies {
  readonly clientFactory?: FeishuClientFactory | undefined
  readonly fetchFn?: HttpFetchFn | undefined
  readonly referenceTimeMs?: number | undefined
}

/**
 * Concrete Feishu platform transport.
 *
 * Responsibilities:
 * 1. Manages WebSocket client lifecycle (bounded startup encompassing SDK start,
 *    live connected verification, bounded graceful close draining all in-flight operations).
 * 2. Normalizes inbound message frames (handling both flattened SDK dispatch and nested wire formats).
 * 3. Enforces security and boundary validation invariants:
 *    - Rejects bots, group chats, foreign apps/tenants, future clock skew, expired and oversized messages.
 * 4. Awaits durable inbox persistence before ACK; write failure propagates an error
 *    to trigger SDK 500 response (ensuring Feishu retries without message loss).
 * 5. Dispatches outbound messages with sanitization and ambiguous-timeout protection.
 */
export class FeishuTransport {
  private readonly config: FeishuTransportConfig
  private readonly inboundAcceptor: IngressDurableAcceptor
  private readonly cardAcceptor: CardActionDurableAcceptor | undefined
  private readonly outboundClient: FeishuOutboundClient
  private readonly clientFactory: FeishuClientFactory | undefined
  private readonly referenceTimeMs: number | undefined

  private isStarted = false
  private isClosed = false
  private isFailed = false
  private startPromise: Promise<void> | null = null
  private closePromise: Promise<void> | null = null

  /** Monotonic startup generation to prevent older/late startups from affecting newer clients. */
  private startupGeneration = 0
  private activeStartupGeneration = 0

  /** Retains error if SDK close threw during startup failure cleanup. */
  private startupCloseError: unknown = null

  /** Tracks all client instances created across generations to ensure no client is orphaned. */
  private readonly ownedClients = new Set<FeishuWSClientLike>()

  /** Tracks active raw SDK startup promises so close() can await them under shutdown deadline. */
  private readonly rawStartupPromises = new Set<Promise<unknown>>()

  /** Tracks in-flight incoming message processing, card callbacks, and outbound sends. */
  private readonly inFlightOperations = new Set<Promise<unknown>>()
  private activeInboundCount = 0

  constructor(
    config: FeishuTransportInputConfig,
    inboundAcceptor: IngressDurableAcceptor,
    cardAcceptor?: CardActionDurableAcceptor,
    deps: FeishuTransportDependencies = {},
  ) {
    this.config = feishuTransportConfigSchema.parse(config)
    this.inboundAcceptor = inboundAcceptor
    this.cardAcceptor = cardAcceptor
    this.clientFactory = deps.clientFactory
    this.referenceTimeMs = deps.referenceTimeMs

    const outboundConfig: FeishuOutboundConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: this.config.domain,
      timeoutMs: this.config.sendTimeoutMs,
      ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
    }
    this.outboundClient = new FeishuOutboundClient(outboundConfig)
  }

  /** Read the current SDK socket state.
   * @returns Whether an owned socket reports connected.
   */
  isConnected(): boolean {
    return !this.isClosed && !this.isFailed && [...this.ownedClients].some(client => client.getConnectionStatus().state === 'connected')
  }

  private checkClosed(): boolean {
    return this.isClosed
  }

  /**
   * Start the transport: sets up event handlers, opens WebSocket connection,
   * and verifies live connected state under the startup deadline encompassing SDK start.
   * Safe against concurrent invocations; shares a single pending promise.
   *
   * @throws Error if transport is closed, permanently fails, or exceeds startup timeout.
   */
  start(): Promise<void> {
    if (this.isClosed || this.isFailed) {
      return Promise.reject(
        new Error('Cannot start closed FeishuTransport: instance is terminal'),
      )
    }
    if (this.isStarted) {
      return Promise.resolve()
    }
    if (this.startPromise) {
      return this.startPromise
    }
    if (this.rawStartupPromises.size > 0) {
      return Promise.reject(
        new Error('Cannot start FeishuTransport while previous raw startup is pending'),
      )
    }

    const generation = ++this.startupGeneration
    this.activeStartupGeneration = generation
    const timeoutMs = this.config.startupTimeoutMs
    let deadlineTimer: NodeJS.Timeout | undefined

    let resolveStart!: () => void
    let rejectStart!: (err: unknown) => void
    const startPromise = new Promise<void>((resolve, reject) => {
      resolveStart = resolve
      rejectStart = reject
    })
    this.startPromise = startPromise

    const startupOp = Promise.resolve().then(() => this.doStart(generation))
    this.rawStartupPromises.add(startupOp)
    void startupOp
      .catch(() => undefined)
      .finally(() => {
        this.rawStartupPromises.delete(startupOp)
      })

    void (async () => {
      try {
        await Promise.race([
          startupOp,
          new Promise<never>((_, reject) => {
            deadlineTimer = setTimeout(() => {
              reject(
                new Error(
                  `Feishu WebSocket client startup timed out after ${timeoutMs}ms waiting for connected state`,
                ),
              )
            }, timeoutMs)
          }),
        ])
        if (generation === this.startupGeneration && !this.isClosed && !this.isFailed) {
          this.isStarted = true
          this.activeStartupGeneration = 0
          resolveStart()
        } else {
          throw new Error('FeishuTransport was closed during startup')
        }
      } catch (err) {
        this.isFailed = true
        this.isClosed = true
        this.activeStartupGeneration = 0
        this.cleanupFailedStartup(generation)
        rejectStart(err)
      } finally {
        if (deadlineTimer !== undefined) {
          clearTimeout(deadlineTimer)
          deadlineTimer = undefined
        }
        if (this.startPromise === startPromise) {
          this.startPromise = null
        }
      }
    })()

    return startPromise
  }

  private cleanupFailedStartup(generation: number): void {
    if (generation !== this.startupGeneration) {
      return
    }
    this.isStarted = false
    for (const client of this.ownedClients) {
      try {
        client.close({ force: true })
      } catch (err) {
        // Force-close failed: preserve client ownership and record error for close()
        if (this.startupCloseError === null) {
          this.startupCloseError = err
        }
      }
    }
    if (this.startupCloseError === null && this.rawStartupPromises.size === 0) {
      this.ownedClients.clear()
    }
  }

  private async doStart(generation: number): Promise<void> {
    if (this.checkClosed()) {
      throw new Error('Cannot start closed FeishuTransport')
    }

    let wsClient: FeishuWSClientLike
    let eventDispatcher: FeishuEventDispatcherLike

    if (this.clientFactory) {
      eventDispatcher = this.clientFactory.createEventDispatcher(this.config)
      wsClient = this.clientFactory.createWSClient(this.config)
    } else {
      const sdk = await import('@larksuiteoapi/node-sdk')
      eventDispatcher = new sdk.EventDispatcher({
        ...(this.config.encryptKey !== undefined ? { encryptKey: this.config.encryptKey } : {}),
        ...(this.config.verificationToken !== undefined ? { verificationToken: this.config.verificationToken } : {}),
      })
      wsClient = new sdk.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        domain: this.config.domain,
        autoReconnect: this.config.autoReconnect,
      })
    }

    this.ownedClients.add(wsClient)

    if (this.checkClosed() || generation !== this.startupGeneration) {
      try {
        wsClient.close({ force: true })
      } catch (err) {
        if (this.startupCloseError === null) {
          this.startupCloseError = err
        }
      }
      throw new Error('FeishuTransport was closed during startup')
    }

    this.registerEventHandlers(eventDispatcher)

    // Initiate raw SDK start and track in rawStartupPromises
    const rawStart = Promise.resolve().then(() => wsClient.start({ eventDispatcher }))
    this.rawStartupPromises.add(rawStart)
    void rawStart
      .catch(() => undefined)
      .finally(() => {
        this.rawStartupPromises.delete(rawStart)
        if (this.checkClosed() || this.activeStartupGeneration !== generation) {
          try {
            wsClient.close({ force: true })
          } catch (err) {
            if (this.startupCloseError === null) {
              this.startupCloseError = err
            }
          }
        }
      })

    await rawStart

    if (this.checkClosed() || this.activeStartupGeneration !== generation) {
      try {
        wsClient.close({ force: true })
      } catch (err) {
        if (this.startupCloseError === null) {
          this.startupCloseError = err
        }
      }
      throw new Error('FeishuTransport was closed during startup')
    }

    await this.waitForConnectionConnected(wsClient, generation)
  }

  private async waitForConnectionConnected(
    client: FeishuWSClientLike,
    generation: number,
  ): Promise<void> {
    const initial = client.getConnectionStatus()
    if (initial.state === 'connected') {
      return
    }
    if (initial.state === 'failed') {
      throw new Error(`Feishu WebSocket client connection status failed: ${initial.state}`)
    }

    return new Promise<void>((resolve, reject) => {
      const checkTimer = setInterval(() => {
        if (this.checkClosed() || this.activeStartupGeneration !== generation) {
          clearInterval(checkTimer)
          reject(new Error('FeishuTransport was closed while waiting for connection'))
          return
        }
        const status = client.getConnectionStatus()
        if (status.state === 'connected') {
          clearInterval(checkTimer)
          resolve()
        } else if (status.state === 'failed') {
          clearInterval(checkTimer)
          reject(new Error(`Feishu WebSocket client connection status failed: ${status.state}`))
        }
      }, this.config.connectionStatusPollIntervalMs)
    })
  }

  /**
   * Handle an inbound message event received from Feishu.
   * Exposed for testing and called by event dispatcher.
   *
   * @param raw - Raw message event frame (flattened SDK or nested wire).
   * @returns Success ACK payload or throws Error (yielding 500 ACK).
   */
  async onIncomingMessageEvent(raw: unknown): Promise<{ code: number; msg: string }> {
    if (this.isClosed) {
      throw new Error('FeishuTransport is closed: incoming messages refused')
    }
    if (this.activeInboundCount >= this.config.maxInboundConcurrency) {
      throw new Error(`Inbound concurrency limit (${this.config.maxInboundConcurrency}) exceeded`)
    }

    const opPromise = this.handleIncomingInternal(raw)
    this.inFlightOperations.add(opPromise)
    this.activeInboundCount++
    try {
      return await opPromise
    } finally {
      this.activeInboundCount--
      this.inFlightOperations.delete(opPromise)
    }
  }

  private async handleIncomingInternal(raw: unknown): Promise<{ code: number; msg: string }> {
    const normalizerOptions: FeishuNormalizerOptions = {
      expectedAppId: this.config.appId,
      maxMessageLength: this.config.maxMessageLength,
      maxMessageBytes: this.config.maxMessageBytes,
      maxMessageAgeMs: this.config.maxMessageAgeMs,
      maxFutureSkewMs: this.config.maxFutureSkewMs,
      ...(this.referenceTimeMs !== undefined ? { referenceTimeMs: this.referenceTimeMs } : {}),
    }

    let normalized: IncomingImMessage
    try {
      normalized = normalizeFeishuMessage(raw, normalizerOptions)
    } catch (err) {
      if (err instanceof FeishuNormalizerError) {
        if (
          err.code === 'BOT_MESSAGE' ||
          err.code === 'NON_P2P_CHAT' ||
          err.code === 'MESSAGE_EXPIRED' ||
          err.code === 'FUTURE_TIMESTAMP' ||
          err.code === 'UNSUPPORTED_FORMAT'
        ) {
          return { code: 0, msg: `Ignored: ${err.message}` }
        }
      }
      throw err
    }

    const result: IngressAcceptResult = await this.inboundAcceptor.handleIncomingMessage(normalized)
    return {
      code: 0,
      msg: result.duplicate ? 'duplicate_admitted' : 'admitted',
    }
  }

  /**
   * Handle an interactive card action callback.
   *
   * @param raw - Raw card action callback body.
   * @returns Card response payload with user toast or throws on persistence failure.
   */
  async onCardActionEvent(raw: unknown): Promise<unknown> {
    if (this.isClosed) {
      throw new Error('FeishuTransport is closed: card actions refused')
    }
    if (!this.cardAcceptor) {
      throw new Error('No CardActionDurableAcceptor configured')
    }

    const opPromise = this.handleCardActionInternal(raw)
    this.inFlightOperations.add(opPromise)
    try {
      return await opPromise
    } finally {
      this.inFlightOperations.delete(opPromise)
    }
  }

  private async handleCardActionInternal(raw: unknown): Promise<unknown> {
    let action: NormalizedFeishuCardAction
    try {
      action = normalizeFeishuCardAction(raw, {
        expectedAppId: this.config.appId,
      })
    } catch (err) {
      if (err instanceof FeishuNormalizerError) {
        return {
          toast: {
            type: 'warning',
            content: `Card action rejected: ${err.message}`,
          },
        }
      }
      throw err
    }

    if (!this.cardAcceptor) {
      throw new Error('No CardActionDurableAcceptor configured')
    }
    const cardAcceptor = this.cardAcceptor
    const result = await cardAcceptor.handleCardAction(action)
    if (!result.success) {
      return {
        toast: {
          type: 'warning',
          content: result.toast ?? 'Action refused',
        },
      }
    }

    return {
      toast: {
        type: 'info',
        content: result.toast ?? 'Action completed',
      },
      ...(result.customData !== undefined ? { data: result.customData } : {}),
    }
  }

  /**
   * Send an outbound text message to Feishu.
   *
   * @param request - Chat ID and raw message text.
   * @returns Delivery result with real platform messageId.
   */
  async sendTextMessage(request: FeishuSendTextRequest): Promise<FeishuSendTextResult> {
    if (this.isClosed) {
      throw new Error('FeishuTransport is closed: outbound sends refused')
    }
    const sendPromise = this.outboundClient.sendTextMessage(request)
    this.inFlightOperations.add(sendPromise)
    try {
      return await sendPromise
    } finally {
      this.inFlightOperations.delete(sendPromise)
    }
  }

  /**
   * Send an outbound interactive card to Feishu.
   *
   * @param chatId - Target Feishu chat ID.
   * @param card - Interactive card structure.
   * @returns Delivery result with real platform messageId.
   */
  async sendInteractiveCard(
    chatId: string,
    card: Readonly<Record<string, unknown>>,
  ): Promise<FeishuSendTextResult> {
    if (this.isClosed) {
      throw new Error('FeishuTransport is closed: outbound sends refused')
    }
    const sendPromise = this.outboundClient.sendInteractiveCard(chatId, card)
    this.inFlightOperations.add(sendPromise)
    try {
      return await sendPromise
    } finally {
      this.inFlightOperations.delete(sendPromise)
    }
  }

  /**
   * Gracefully close the transport:
   * 1. Publishes one shared close promise immediately before async work/reentry.
   * 2. Stops new incoming messages, card actions, and outbound sends first.
   * 3. Calls SDK force-close without swallowing errors, preserving client ownership during drainage.
   * 4. Observes concurrent startup and all owned operations, rejecting on timeout or failure.
   */
  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }

    let resolveClose!: () => void
    let rejectClose!: (err: unknown) => void
    const closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve
      rejectClose = reject
    })
    this.closePromise = closePromise

    void (async () => {
      try {
        await this.doClose()
        resolveClose()
      } catch (err) {
        rejectClose(err)
      }
    })()

    return closePromise
  }

  private async doClose(): Promise<void> {
    this.isClosed = true
    this.isStarted = false

    let closeError: unknown = null
    for (const client of this.ownedClients) {
      try {
        client.close({ force: true })
      } catch (err) {
        // Capture error but preserve client ownership while draining operations
        if (closeError === null) {
          closeError = err
        }
      }
    }

    const timeoutMs = this.config.shutdownTimeoutMs
    const pendingStartup = this.startPromise ? [this.startPromise] : []
    const pendingRawStartups = Array.from(this.rawStartupPromises)
    const startupOpCount = pendingStartup.length + pendingRawStartups.length
    const pendingInFlight = Array.from(this.inFlightOperations)
    const pendingOperations = [
      ...pendingStartup,
      ...pendingRawStartups,
      ...pendingInFlight,
    ]

    if (pendingOperations.length > 0) {
      let deadlineTimer: NodeJS.Timeout | undefined
      try {
        const results = await Promise.race([
          Promise.allSettled(pendingOperations),
          new Promise<never>((_, reject) => {
            deadlineTimer = setTimeout(() => {
              reject(
                new Error(
                  `FeishuTransport close timed out after ${timeoutMs}ms waiting for in-flight operations to settle`,
                ),
              )
            }, timeoutMs)
          }),
        ])

        const isExpectedStartupCancellation = (msg: string): boolean => {
          return (
            msg === 'FeishuTransport was closed during startup' ||
            msg === 'FeishuTransport was closed while waiting for connection' ||
            msg === 'Cannot start closed FeishuTransport' ||
            msg === 'Cannot start closed FeishuTransport: instance is terminal'
          )
        }

        // Only ignore exact expected startup cancellation on startup entries; all callback/write failures must reject
        const firstRejection = results.find((r, index): r is PromiseRejectedResult => {
          if (r.status !== 'rejected') return false
          if (index < startupOpCount) {
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
            if (isExpectedStartupCancellation(msg)) {
              return false
            }
          }
          return true
        })

        if (firstRejection && closeError === null) {
          closeError = firstRejection.reason
        }
      } finally {
        if (deadlineTimer !== undefined) {
          clearTimeout(deadlineTimer)
          deadlineTimer = undefined
        }
      }
    }

    // Drain and force-close any clients that were registered or returned late during drain
    for (const client of this.ownedClients) {
      try {
        client.close({ force: true })
      } catch (err) {
        if (closeError === null) {
          closeError = err
        }
      }
    }

    // Merge startupCloseError AFTER drain before clearing resources
    if (this.startupCloseError !== null && closeError === null) {
      closeError = this.startupCloseError
    }

    // Preserve ownership until close settles; now clear if completed without error
    if (closeError !== null) {
      throw closeError instanceof Error
        ? closeError
        : new Error(typeof closeError === 'string' ? closeError : JSON.stringify(closeError))
    }
    this.ownedClients.clear()
    this.startupCloseError = null
  }

  private registerEventHandlers(dispatcher: FeishuEventDispatcherLike): void {
    dispatcher.register({
      'im.message.receive_v1': async (data: unknown) => {
        return this.onIncomingMessageEvent(data)
      },
      'card.action.trigger': async (data: unknown) => {
        return this.onCardActionEvent(data)
      },
    })
  }
}
