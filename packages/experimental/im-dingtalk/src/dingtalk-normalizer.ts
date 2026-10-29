/**
 * Normalization, SSRF prevention, boundary validation, and sanitization for DingTalk IM events.
 *
 * @module @deepseek-ai/dsh-experimental-im-dingtalk/dingtalk-normalizer
 */

import { Buffer } from 'node:buffer'
import { z } from 'zod'
import {
  parseDingTalkClientId,
  parseDingTalkCorpId,
  parseDingTalkConversationId,
  parseDingTalkSenderId,
  parseDingTalkMessageId,
  type IncomingImMessage,
} from './types.ts'

/** Reason codes for rejecting an incoming DingTalk event. */
export type DingTalkRejectionCode =
  | 'BOT_MESSAGE'
  | 'NON_P2P_CHAT'
  | 'CLIENT_ID_MISMATCH'
  | 'CORP_ID_MISMATCH'
  | 'MESSAGE_OVERSIZED'
  | 'MESSAGE_EXPIRED'
  | 'FUTURE_TIMESTAMP'
  | 'UNSUPPORTED_FORMAT'
  | 'MALFORMED_PAYLOAD'
  | 'UNSAFE_WEBHOOK_URL'

/** Typed error thrown when an incoming DingTalk event fails boundary validation or security checks. */
export class DingTalkNormalizerError extends Error {
  constructor(
    public readonly code: DingTalkRejectionCode,
    message: string,
  ) {
    super(`[DingTalkNormalizer:${code}] ${message}`)
    this.name = 'DingTalkNormalizerError'
  }
}

/** Options configuring incoming DingTalk message normalization. */
export interface DingTalkNormalizerOptions {
  /** Expected application client ID / appKey. */
  readonly expectedClientId?: string | undefined
  /** Expected enterprise corporate workspace ID (corpId). */
  readonly expectedCorpId?: string | undefined
  /** Maximum allowable prompt length in characters. Default: 32,768 (32KB). */
  readonly maxMessageLength?: number | undefined
  /** Maximum allowable prompt size in UTF-8 bytes. Default: 32,768 bytes. */
  readonly maxMessageBytes?: number | undefined
  /** Maximum allowable message age in milliseconds. Default: 300,000 (5 minutes). */
  readonly maxMessageAgeMs?: number | undefined
  /** Allowed clock skew into the future in milliseconds. Default: 30,000 (30 seconds). */
  readonly maxFutureSkewMs?: number | undefined
  /** Fixed timestamp reference for deterministic age calculation in tests. */
  readonly referenceTimeMs?: number | undefined
  /** Whitelist of approved official HTTPS destination hostnames for sessionWebhook. */
  readonly allowedWebhookHosts?: string[] | undefined
}

/** Approved official DingTalk API hosts. */
export const DEFAULT_APPROVED_DINGTALK_HOSTS = [
  'oapi.dingtalk.com',
  'api.dingtalk.com',
]

/**
 * Validate that a DingTalk sessionWebhook URL is strictly an approved official HTTPS endpoint.
 *
 * Prevents SSRF: rejects non-HTTPS protocols, loopback addresses (127.0.0.1, localhost),
 * internal RFC1918 IPs, and arbitrary external domains.
 *
 * @param rawUrl - Raw URL string from inbound event data.
 * @param allowedHosts - Optional whitelist override (defaults to official DingTalk domains).
 * @returns Parsed and validated URL object.
 * @throws DingTalkNormalizerError if the URL violates security constraints.
 */
export function validateSessionWebhookUrl(
  rawUrl: string,
  allowedHosts: string[] = DEFAULT_APPROVED_DINGTALK_HOSTS,
): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (err) {
    throw new DingTalkNormalizerError(
      'UNSAFE_WEBHOOK_URL',
      `Malformed sessionWebhook URL: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Enforce strictly HTTPS
  if (parsed.protocol !== 'https:') {
    throw new DingTalkNormalizerError(
      'UNSAFE_WEBHOOK_URL',
      `sessionWebhook protocol must be https:, got '${parsed.protocol}'`,
    )
  }

  const hostname = parsed.hostname.toLowerCase()

  if (!allowedHosts.includes(hostname) || !DEFAULT_APPROVED_DINGTALK_HOSTS.includes(hostname)
    || parsed.port || parsed.username || parsed.password || parsed.hash) {
    throw new DingTalkNormalizerError('UNSAFE_WEBHOOK_URL', 'sessionWebhook must use an official HTTPS endpoint without credentials or custom ports')
  }

  return parsed
}

const rawDingTalkDataSchema = z.object({
  conversationId: z.string().min(1),
  conversationType: z.string().min(1),
  chatbotUserId: z.string().optional(),
  msgId: z.string().min(1),
  senderId: z.string().min(1),
  senderCorpId: z.string().min(1),
  sessionWebhook: z.string().min(1),
  sessionWebhookExpiredTime: z.coerce.number().int().positive(),
  createAt: z.union([z.number(), z.string()]),
  msgtype: z.string().min(1),
  text: z.object({
    content: z.string(),
  }),
})

const rawDingTalkStreamPayloadSchema = z.object({
  headers: z
    .object({
      messageId: z.string().optional(),
      topic: z.string().optional(),
      contentType: z.string().optional(),
    })
    .optional(),
  data: z.union([z.string(), z.record(z.string(), z.unknown())]),
})

/**
 * Normalize and validate an incoming DingTalk Stream robot event into a canonical IncomingImMessage.
 *
 * Invariants enforced:
 * 1. Only direct 1-on-1 private chat (conversationType === '1'); rejects group chats ('2').
 * 2. Only text messages (msgtype === 'text'); rejects other types.
 * 3. Bounded length (character count and UTF-8 byte limits).
 * 4. Freshness window and clock skew protection.
 * 5. CorpId and ClientId match when configured.
 * 6. Validates sessionWebhook destination safety if present.
 *
 * @param raw - Raw down-stream message from DingTalk Stream SDK.
 * @param options - Boundary validation options.
 * @returns Canonical validated IncomingImMessage.
 * @throws DingTalkNormalizerError if any invariant is violated.
 */
export function normalizeDingTalkMessage(
  raw: unknown,
  options: DingTalkNormalizerOptions = {},
): IncomingImMessage {
  const maxMessageLength = options.maxMessageLength ?? 32_768
  const maxMessageBytes = options.maxMessageBytes ?? 32_768
  const maxMessageAgeMs = options.maxMessageAgeMs ?? 300_000
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 30_000
  const now = options.referenceTimeMs ?? Date.now()
  const clientId = options.expectedClientId
  if (!clientId?.trim()) throw new DingTalkNormalizerError('CLIENT_ID_MISMATCH', 'Expected client ID must be configured')

  let dataObj: unknown = raw

  const streamParsed = rawDingTalkStreamPayloadSchema.safeParse(raw)
  if (streamParsed.success) {
    if (typeof streamParsed.data.data === 'string') {
      try {
        dataObj = JSON.parse(streamParsed.data.data)
      } catch (err) {
        throw new DingTalkNormalizerError(
          'MALFORMED_PAYLOAD',
          `Failed to parse stream data JSON: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      dataObj = streamParsed.data.data
    }
  }

  const parsedResult = rawDingTalkDataSchema.safeParse(dataObj)
  if (!parsedResult.success) {
    throw new DingTalkNormalizerError(
      'MALFORMED_PAYLOAD',
      `Invalid DingTalk message payload: ${parsedResult.error.message}`,
    )
  }

  const msg = parsedResult.data

  // 1. Private chat check: DingTalk conversationType '1' = 1-on-1 single chat, '2' = group chat
  if (msg.conversationType !== '1') {
    throw new DingTalkNormalizerError(
      'NON_P2P_CHAT',
      `Rejected non-private conversationType '${msg.conversationType}' (expected '1')`,
    )
  }

  // 2. Message type check (text only)
  if (msg.msgtype !== 'text') {
    throw new DingTalkNormalizerError(
      'UNSUPPORTED_FORMAT',
      `Unsupported message format '${msg.msgtype}' (expected 'text')`,
    )
  }

  // 3. Corp ID match check
  const corpId = msg.senderCorpId
  if (options.expectedCorpId && corpId !== options.expectedCorpId) {
    throw new DingTalkNormalizerError(
      'CORP_ID_MISMATCH',
      `Event senderCorpId '${corpId}' does not match expected '${options.expectedCorpId}'`,
    )
  }

  // 4. Validate sessionWebhook URL safety if present
  if (msg.sessionWebhook) {
    validateSessionWebhookUrl(
      msg.sessionWebhook,
      options.allowedWebhookHosts ?? DEFAULT_APPROVED_DINGTALK_HOSTS,
    )
  }

  // 5. Oversized checks
  const prompt = msg.text.content
  if (prompt.length > maxMessageLength) {
    throw new DingTalkNormalizerError(
      'MESSAGE_OVERSIZED',
      `Message length ${prompt.length} characters exceeds maximum limit of ${maxMessageLength}`,
    )
  }
  const byteLength = Buffer.byteLength(prompt, 'utf-8')
  if (byteLength > maxMessageBytes) {
    throw new DingTalkNormalizerError(
      'MESSAGE_OVERSIZED',
      `Message size ${byteLength} bytes exceeds maximum limit of ${maxMessageBytes} bytes`,
    )
  }

  // 6. Timestamp freshness & clock skew checks
  const createAtMs = Number(msg.createAt)
  if (!Number.isFinite(createAtMs)) {
    throw new DingTalkNormalizerError('MALFORMED_PAYLOAD', 'Invalid createAt timestamp')
  }

  if (createAtMs > now + maxFutureSkewMs) {
    throw new DingTalkNormalizerError(
      'FUTURE_TIMESTAMP',
      `Message createAt ${createAtMs} is in the future relative to ${now} (skew ${createAtMs - now}ms > allowed ${maxFutureSkewMs}ms)`,
    )
  }

  const ageMs = now - createAtMs
  if (ageMs > maxMessageAgeMs) {
    throw new DingTalkNormalizerError(
      'MESSAGE_EXPIRED',
      `Message created at ${createAtMs} is ${ageMs}ms old (max allowed ${maxMessageAgeMs}ms)`,
    )
  }

  if (msg.sessionWebhookExpiredTime <= now) {
    throw new DingTalkNormalizerError('MESSAGE_EXPIRED', 'Reply capability expired')
  }

  return {
    provider: 'dingtalk',
    appId: parseDingTalkClientId(clientId),
    tenantId: parseDingTalkCorpId(corpId),
    chatId: parseDingTalkConversationId(msg.conversationId),
    senderId: parseDingTalkSenderId(msg.senderId),
    eventId: parseDingTalkMessageId(msg.msgId),
    messageId: msg.msgId,
    replyRoute: { kind: 'dingtalk-session-webhook', url: msg.sessionWebhook, expiresAt: msg.sessionWebhookExpiredTime },
    createTime: createAtMs,
    chatType: 'p2p',
    text: prompt,
  }
}

const THINK_TAG_REGEX = /<think>[\s\S]*?<\/think>/gi
const BEARER_TOKEN_REGEX = /Bearer\s+[a-z0-9_.-]+/gi
const GENERIC_API_KEY_REGEX = /(?:sk-[A-Za-z0-9_-]{20,}|ding[A-Za-z0-9]{16})/g

/**
 * Sanitize outbound text before dispatching to DingTalk platform.
 *
 * @param text - Raw outbound response text from model loop.
 * @param maxLength - Maximum safe character count (default: 30,000).
 * @returns Clean, safe outbound text.
 */
export function sanitizeDingTalkOutboundText(text: string, maxLength = 30_000): string {
  let cleaned = text.replace(THINK_TAG_REGEX, '')
  cleaned = cleaned.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]')
  cleaned = cleaned.replace(GENERIC_API_KEY_REGEX, '[REDACTED_KEY]')
  cleaned = cleaned.trim()

  if (cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength)
  }
  return cleaned
}
