/**
 * Outbound message dispatch client with sanitization, real message ID mapping,
 * full-body timeout protection, and ambiguous network error handling for Feishu IM.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/feishu-outbound
 */

import { z } from 'zod'
import { sanitizeOutboundText } from './feishu-normalizer.ts'

/** Error thrown when an outbound send attempt encounters an ambiguous timeout or network failure. */
export class FeishuAmbiguousTimeoutError extends Error {
  /** Delivery disposition; ambiguous acceptance must never be automatically replayed. */
  public readonly status = 'unknown' as const

  constructor(message: string, public readonly originalCause?: unknown) {
    super(`[FeishuOutbound:UNKNOWN_TIMEOUT] ${message}`)
    this.name = 'FeishuAmbiguousTimeoutError'
  }
}

/** Error thrown when an outbound send attempt fails deterministically. */
export class FeishuOutboundError extends Error {
  /** Delivery disposition; ambiguous acceptance must never be automatically replayed. */
  public readonly status = 'failed' as const

  constructor(message: string, public readonly code?: number) {
    super(`[FeishuOutbound:FAILED] ${message}`)
    this.name = 'FeishuOutboundError'
  }
}

/** Injected HTTP fetch function type for 100% keyless testing. */
export type HttpFetchFn = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/** Outbound client configuration options. */
export interface FeishuOutboundConfig {
  readonly appId: string
  readonly appSecret: string
  readonly domain?: string | undefined
  readonly timeoutMs?: number | undefined
  readonly fetchFn?: HttpFetchFn | undefined
}

/** Request payload for sending an outbound text message. */
export interface FeishuSendTextRequest {
  readonly chatId: string
  readonly text: string
  readonly replyMessageId?: string
}

/** Response outcome from a successful outbound message send. */
export interface FeishuSendTextResult {
  readonly messageId: string
  readonly status: 'sent'
}

const tokenResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  tenant_access_token: z.string().optional(),
  expire: z.number().optional(),
})

const sendMessageResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z
    .object({
      message_id: z.string().optional(),
    })
    .optional(),
})

/**
 * Outbound client for safely sending messages to Feishu IM.
 *
 * Enforces:
 * 1. Safe text sanitization (removes reasoning tags, credentials, bounds length).
 * 2. Maps real Feishu message IDs returned by the platform.
 * 3. Ambiguous network error handling: if a request times out, aborts, or encounters
 *    a socket reset after dispatch begins, marks status as 'unknown' and never automatically retries.
 * 4. Timeout guards the complete round-trip (headers + response body read).
 * 5. Strict schema validation on wire JSON responses (no unvalidated type assertions).
 */
export class FeishuOutboundClient {
  private readonly appId: string
  private readonly appSecret: string
  private readonly domain: string
  private readonly timeoutMs: number
  private readonly fetch: HttpFetchFn
  private cachedToken: { token: string; expiresAt: number } | null = null

  constructor(config: FeishuOutboundConfig) {
    this.appId = config.appId
    this.appSecret = config.appSecret
    const domain = new URL(config.domain ?? 'https://open.feishu.cn')
    if (domain.protocol !== 'https:' || !['open.feishu.cn', 'open.larksuite.com'].includes(domain.hostname)
      || domain.port || domain.username || domain.password || domain.pathname !== '/' || domain.search || domain.hash) {
      throw new TypeError('Feishu API domain must be an official HTTPS origin')
    }
    this.domain = domain.origin
    this.timeoutMs = config.timeoutMs ?? 10_000
    this.fetch = config.fetchFn ?? fetch
  }

  /**
   * Acquire a valid internal tenant access token, caching until near expiry.
   *
   * @returns Valid tenant_access_token string.
   */
  async getTenantAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token
    }

    const url = `${this.domain}/open-apis/auth/v3/tenant_access_token/internal`
    const { status, statusText, rawJson } = await this.executeFullRoundTrip(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    })

    if (status < 200 || status >= 300) {
      throw new FeishuOutboundError(
        `Failed to acquire tenant_access_token: HTTP ${status} ${statusText}`,
        status,
      )
    }

    const parsed = tokenResponseSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new FeishuOutboundError(
        `Malformed tenant access token response: ${parsed.error.message}`,
      )
    }

    const data = parsed.data
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new FeishuOutboundError(
        `Tenant access token error (code ${data.code}): ${data.msg}`,
        data.code,
      )
    }

    const expireSeconds = data.expire ?? 7200
    this.cachedToken = {
      token: data.tenant_access_token,
      expiresAt: now + expireSeconds * 1000,
    }

    return data.tenant_access_token
  }

  /**
   * Send a sanitized text message or reply to a chat.
   *
   * @param request - Send parameters including chatId and raw text.
   * @returns Sent outcome with real Feishu message ID.
   * @throws FeishuAmbiguousTimeoutError on ambiguous timeout or network failure (status: 'unknown').
   * @throws FeishuOutboundError on deterministic platform rejection (status: 'failed').
   */
  async sendTextMessage(request: FeishuSendTextRequest): Promise<FeishuSendTextResult> {
    const sanitizedText = sanitizeOutboundText(request.text)
    if (sanitizedText.length === 0) {
      throw new FeishuOutboundError('Cannot send empty text message')
    }

    return this.sendMessagePayload(request.chatId, JSON.stringify({ text: sanitizedText }), 'text', request.replyMessageId)
  }

  /**
   * Send one interactive card to the bound private chat.
   * @param chatId - Administrator-bound private chat.
   * @param card - Bounded card produced by the owned interaction presenter.
   * @returns Actual accepted message ID; uncertain sends are never automatically replayed.
   */
  sendInteractiveCard(chatId: string, card: Readonly<Record<string, unknown>>): Promise<FeishuSendTextResult> {
    return this.sendMessagePayload(chatId, JSON.stringify(card), 'interactive')
  }

  private async sendMessagePayload(chatId: string, content: string, type: 'text' | 'interactive', replyMessageId?: string): Promise<FeishuSendTextResult> {
    const token = await this.getTenantAccessToken()
    const url = replyMessageId
      ? `${this.domain}/open-apis/im/v1/messages/${encodeURIComponent(replyMessageId)}/reply`
      : `${this.domain}/open-apis/im/v1/messages?receive_id_type=chat_id`
    const bodyPayload = { msg_type: type, content, ...(replyMessageId ? {} : { receive_id: chatId }) }

    const { status, statusText, rawJson } = await this.executeFullRoundTrip(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(bodyPayload),
    })

    if (status >= 500 || status === 408) {
      throw new FeishuAmbiguousTimeoutError('Feishu send acceptance is unknown after an uncertain HTTP response')
    }
    if (status < 200 || status >= 300) {
      throw new FeishuOutboundError(
        `Feishu OpenAPI returned HTTP ${status}: ${statusText}`,
        status,
      )
    }

    const parsed = sendMessageResponseSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new FeishuAmbiguousTimeoutError('Feishu send acceptance is unknown after a malformed response')
    }

    const data = parsed.data
    if (data.code !== 0) {
      throw new FeishuOutboundError(
        `Feishu send message rejected (code ${data.code}): ${data.msg}`,
        data.code,
      )
    }

    if (!data.data?.message_id) {
      throw new FeishuAmbiguousTimeoutError('Feishu accepted response omitted its message ID')
    }
    return {
      messageId: data.data.message_id,
      status: 'sent',
    }
  }

  /**
   * Execute an HTTP request where the timeout covers the ENTIRE round trip
   * (both header reception and response body consumption).
   *
   * Any network failure, socket reset, or timeout after dispatch starts
   * is classified as ambiguous 'unknown' to prevent dangerous duplicate sends.
   */
  private async executeFullRoundTrip(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; statusText: string; rawJson: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, this.timeoutMs)

    try {
      const response = await this.fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
      })

      // Crucial: body read is also guarded by the active timeout controller!
      const text = await response.text()
      let rawJson: unknown
      try {
        rawJson = JSON.parse(text)
      } catch (err) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          throw new FeishuOutboundError(`Feishu API rejected the request with HTTP ${response.status}`, response.status)
        }
        throw new FeishuAmbiguousTimeoutError('Feishu acceptance is unknown after an invalid response body', err)
      }

      return {
        status: response.status,
        statusText: response.statusText,
        rawJson,
      }
    } catch (err: unknown) {
      if (err instanceof FeishuOutboundError || err instanceof FeishuAmbiguousTimeoutError) {
        throw err
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new FeishuAmbiguousTimeoutError(
          `Outbound dispatch timed out after ${this.timeoutMs}ms; delivery status is UNKNOWN (do not retry)`,
          err,
        )
      }
      // Any socket reset, connection abort, or network drop during or after dispatch
      // is ambiguous on an HTTP POST mutation!
      throw new FeishuAmbiguousTimeoutError(
        'Outbound transport network failure; delivery status is unknown (do not retry)',
        err,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
