/**
 * Outbound message dispatch client for DingTalk IM with SSRF protection,
 * sanitization, and ambiguous timeout handling.
 *
 * @module @deepseek-ai/dsh-experimental-im-dingtalk/dingtalk-outbound
 */

import { z } from 'zod'
import {
  sanitizeDingTalkOutboundText,
  validateSessionWebhookUrl,
} from './dingtalk-normalizer.ts'

/** Error thrown when an outbound send attempt encounters an ambiguous timeout or network failure. */
export class DingTalkAmbiguousTimeoutError extends Error {
  /** Delivery disposition; ambiguous acceptance must never be automatically replayed. */
  public readonly status = 'unknown' as const

  constructor(message: string, public readonly originalCause?: unknown) {
    super(`[DingTalkOutbound:UNKNOWN_TIMEOUT] ${message}`)
    this.name = 'DingTalkAmbiguousTimeoutError'
  }
}

/** Error thrown when an outbound send attempt fails deterministically. */
export class DingTalkOutboundError extends Error {
  /** Delivery disposition; ambiguous acceptance must never be automatically replayed. */
  public readonly status = 'failed' as const

  constructor(message: string, public readonly code?: number) {
    super(`[DingTalkOutbound:FAILED] ${message}`)
    this.name = 'DingTalkOutboundError'
  }
}

/** Injected HTTP fetch function type for 100% keyless testing. */
export type HttpFetchFn = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/** Outbound client configuration options. */
export interface DingTalkOutboundConfig {
  readonly timeoutMs?: number | undefined
  readonly fetchFn?: HttpFetchFn | undefined
  readonly allowedWebhookHosts?: string[] | undefined
}

const webhookResponseSchema = z.object({
  errcode: z.number().int(),
  errmsg: z.string().optional(),
})

/**
 * Outbound client for safely replying to DingTalk messages via sessionWebhook.
 *
 * Enforces:
 * 1. SSRF prevention: validates sessionWebhook against approved official HTTPS destinations.
 * 2. Redirect blocking: sets redirect: 'error' to prevent redirect-based SSRF.
 * 3. Text sanitization: removes reasoning transcripts (<think>), redacts keys.
 * 4. Ambiguous timeout handling: network errors or timeouts after dispatch are marked 'unknown'.
 * 5. Full round-trip timeout covering response body consumption.
 */
export class DingTalkOutboundClient {
  private readonly timeoutMs: number
  private readonly fetch: HttpFetchFn
  private readonly allowedWebhookHosts: string[] | undefined

  constructor(config: DingTalkOutboundConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 10_000
    this.fetch = config.fetchFn ?? fetch
    this.allowedWebhookHosts = config.allowedWebhookHosts
  }

  /**
   * Send a sanitized text reply to a validated sessionWebhook URL.
   *
   * @param webhookUrl - Untrusted sessionWebhook URL from incoming message.
   * @param text - Raw message text to send.
   * @returns Success confirmation.
   * @throws DingTalkAmbiguousTimeoutError on ambiguous timeout/network reset (status: 'unknown').
   * @throws DingTalkOutboundError on deterministic platform rejection or SSRF violation (status: 'failed').
   */
  async sendSessionWebhookReply(
    webhookUrl: string,
    text: string,
  ): Promise<{ status: 'sent' }> {
    // 1. SSRF check: strictly approved HTTPS destinations only
    const validUrl = validateSessionWebhookUrl(webhookUrl, this.allowedWebhookHosts)

    // 2. Sanitize text
    const cleanText = sanitizeDingTalkOutboundText(text)
    if (cleanText.length === 0) {
      throw new DingTalkOutboundError('Cannot send empty text message')
    }

    const payload = {
      msgtype: 'text',
      text: {
        content: cleanText,
      },
    }

    const { status, statusText, rawJson } = await this.executeFullRoundTrip(
      validUrl.toString(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // Disallow redirects to prevent open-redirect SSRF
        redirect: 'error',
      },
    )

    if (status >= 500 || status === 408) {
      throw new DingTalkAmbiguousTimeoutError('DingTalk acceptance is unknown after an uncertain HTTP response')
    }
    if (status < 200 || status >= 300) {
      throw new DingTalkOutboundError(
        `DingTalk webhook returned HTTP ${status}: ${statusText}`,
        status,
      )
    }

    const parsed = webhookResponseSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new DingTalkAmbiguousTimeoutError('DingTalk acceptance is unknown after a malformed response')
    }

    const data = parsed.data
    if (data.errcode !== 0) {
      throw new DingTalkOutboundError(
        `DingTalk webhook rejected message (errcode ${data.errcode}): ${data.errmsg ?? 'unknown'}`,
        data.errcode,
      )
    }

    return { status: 'sent' }
  }

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
      })

      const text = await response.text()
      let rawJson: unknown
      try {
        rawJson = JSON.parse(text)
      } catch (err) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          throw new DingTalkOutboundError(`DingTalk rejected the request with HTTP ${response.status}`, response.status)
        }
        throw new DingTalkAmbiguousTimeoutError('DingTalk acceptance is unknown after an invalid response body', err)
      }

      return {
        status: response.status,
        statusText: response.statusText,
        rawJson,
      }
    } catch (err: unknown) {
      if (err instanceof DingTalkOutboundError || err instanceof DingTalkAmbiguousTimeoutError) {
        throw err
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DingTalkAmbiguousTimeoutError(
          `Outbound dispatch timed out after ${this.timeoutMs}ms; delivery status is UNKNOWN (do not retry)`,
          err,
        )
      }
      throw new DingTalkAmbiguousTimeoutError(
        'Outbound transport network failure; delivery status is unknown (do not retry)',
        err,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
