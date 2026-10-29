/**
 * Normalization, boundary validation, and sanitization for Feishu IM events and messages.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/feishu-normalizer
 */

import { Buffer } from 'node:buffer'
import { z } from 'zod'
import {
  parseFeishuAppId,
  parseFeishuTenantId,
  parseFeishuChatId,
  parseFeishuSenderId,
  parseFeishuEventId,
  type IncomingImMessage,
} from './types.ts'

/** Reason codes for rejecting an incoming Feishu event. */
export type FeishuRejectionCode =
  | 'BOT_MESSAGE'
  | 'NON_P2P_CHAT'
  | 'APP_ID_MISMATCH'
  | 'TENANT_ID_MISMATCH'
  | 'MESSAGE_OVERSIZED'
  | 'MESSAGE_EXPIRED'
  | 'FUTURE_TIMESTAMP'
  | 'UNSUPPORTED_FORMAT'
  | 'MALFORMED_PAYLOAD'

/** Typed error thrown when an incoming Feishu event fails boundary validation. */
export class FeishuNormalizerError extends Error {
  constructor(
    public readonly code: FeishuRejectionCode,
    message: string,
  ) {
    super(`[FeishuNormalizer:${code}] ${message}`)
    this.name = 'FeishuNormalizerError'
  }
}

/** Options configuring incoming message normalization. */
export interface FeishuNormalizerOptions {
  /** Expected application ID to filter out foreign app events. */
  readonly expectedAppId?: string | undefined
  /** Expected enterprise tenant ID to filter out foreign tenant events. */
  readonly expectedTenantId?: string | undefined
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
}

const rawFeishuSenderIdSchema = z.object({
  open_id: z.string().optional(),
  user_id: z.string().optional(),
  union_id: z.string().optional(),
})

const rawFeishuSenderSchema = z.object({
  sender_type: z.string(),
  sender_id: rawFeishuSenderIdSchema,
  tenant_key: z.string().optional(),
})

const rawFeishuMessageSchema = z.object({
  message_id: z.string().min(1),
  chat_id: z.string().min(1),
  chat_type: z.string(),
  message_type: z.string(),
  content: z.string(),
  create_time: z.union([z.string(), z.number()]).optional(),
})

const rawFeishuHeaderSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().optional(),
  create_time: z.union([z.string(), z.number()]),
  app_id: z.string().min(1),
  tenant_key: z.string().min(1),
  token: z.string().optional(),
})

/** Nested wire format: { schema: "2.0", header: {...}, event: {...} } */
const nestedFeishuEventSchema = z.object({
  schema: z.string().optional(),
  header: rawFeishuHeaderSchema,
  event: z.object({
    sender: rawFeishuSenderSchema,
    message: rawFeishuMessageSchema,
  }),
})

/** Flattened SDK EventDispatcher format: { event_id, app_id, tenant_key, sender, message, ... } */
const flattenedFeishuEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().optional(),
  create_time: z.union([z.string(), z.number()]),
  app_id: z.string().min(1),
  tenant_key: z.string().min(1),
  sender: rawFeishuSenderSchema,
  message: rawFeishuMessageSchema,
})

/**
 * Normalize and validate an incoming Feishu event frame into a canonical IncomingImMessage.
 *
 * Supports both:
 * 1. Flattened SDK dispatch targetData (produced by Lark Node SDK EventDispatcher).
 * 2. Nested raw wire webhook payload { header, event }.
 *
 * Invariants enforced:
 * 1. Only human senders (sender_type === 'user'); rejects bot messages.
 * 2. Only private direct chat (chat_type === 'p2p'); rejects group chats.
 * 3. Bounded length (character count and UTF-8 byte limits).
 * 4. Freshness window and clock skew protection.
 * 5. App and tenant ID match when configured.
 *
 * @param raw - Untrusted wire event data from Feishu SDK or webhook.
 * @param options - Boundary validation options.
 * @returns Canonical validated IncomingImMessage.
 * @throws FeishuNormalizerError if any invariant is violated.
 */
export function normalizeFeishuMessage(
  raw: unknown,
  options: FeishuNormalizerOptions = {},
): IncomingImMessage {
  const maxMessageLength = options.maxMessageLength ?? 32_768
  const maxMessageBytes = options.maxMessageBytes ?? 32_768
  const maxMessageAgeMs = options.maxMessageAgeMs ?? 300_000
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 30_000
  const now = options.referenceTimeMs ?? Date.now()

  let header: {
    event_id: string
    create_time: string | number
    app_id: string
    tenant_key: string
  }
  let sender: z.infer<typeof rawFeishuSenderSchema>
  let message: z.infer<typeof rawFeishuMessageSchema>

  const nestedResult = nestedFeishuEventSchema.safeParse(raw)
  if (nestedResult.success) {
    header = nestedResult.data.header
    sender = nestedResult.data.event.sender
    message = nestedResult.data.event.message
  } else {
    const flattenedResult = flattenedFeishuEventSchema.safeParse(raw)
    if (flattenedResult.success) {
      header = {
        event_id: flattenedResult.data.event_id,
        create_time: flattenedResult.data.create_time,
        app_id: flattenedResult.data.app_id,
        tenant_key: flattenedResult.data.tenant_key,
      }
      sender = flattenedResult.data.sender
      message = flattenedResult.data.message
    } else {
      throw new FeishuNormalizerError(
        'MALFORMED_PAYLOAD',
        `Invalid Feishu event structure: ${flattenedResult.error.message}`,
      )
    }
  }

  // 1. App ID match check
  if (options.expectedAppId && header.app_id !== options.expectedAppId) {
    throw new FeishuNormalizerError(
      'APP_ID_MISMATCH',
      `Event app_id '${header.app_id}' does not match expected '${options.expectedAppId}'`,
    )
  }

  // 2. Tenant ID match check
  if (options.expectedTenantId && header.tenant_key !== options.expectedTenantId) {
    throw new FeishuNormalizerError(
      'TENANT_ID_MISMATCH',
      `Event tenant_key '${header.tenant_key}' does not match expected '${options.expectedTenantId}'`,
    )
  }

  // 3. Human sender check (reject bots)
  if (sender.sender_type !== 'user') {
    throw new FeishuNormalizerError(
      'BOT_MESSAGE',
      `Rejected non-human sender type '${sender.sender_type}'`,
    )
  }

  // Extract sender open_id or user_id
  const senderId =
    sender.sender_id.open_id ??
    sender.sender_id.user_id ??
    sender.sender_id.union_id

  if (!senderId || senderId.trim() === '') {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Sender missing open_id/user_id')
  }

  // 4. Private chat check (p2p only)
  if (message.chat_type !== 'p2p') {
    throw new FeishuNormalizerError(
      'NON_P2P_CHAT',
      `Rejected non-private chat type '${message.chat_type}'`,
    )
  }

  // 5. Message type check (text only)
  if (message.message_type !== 'text') {
    throw new FeishuNormalizerError(
      'UNSUPPORTED_FORMAT',
      `Unsupported message format '${message.message_type}'`,
    )
  }

  // 6. Content parsing
  let text = ''
  try {
    const parsedContent = JSON.parse(message.content) as Record<string, unknown>
    if (typeof parsedContent.text !== 'string') {
      throw new Error('Missing text property in content JSON')
    }
    text = parsedContent.text
  } catch (err) {
    throw new FeishuNormalizerError(
      'MALFORMED_PAYLOAD',
      `Failed to parse message text JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 7. Oversized check (both character count and UTF-8 byte length)
  if (text.length > maxMessageLength) {
    throw new FeishuNormalizerError(
      'MESSAGE_OVERSIZED',
      `Message length ${text.length} characters exceeds maximum limit of ${maxMessageLength}`,
    )
  }
  const byteLength = Buffer.byteLength(text, 'utf-8')
  if (byteLength > maxMessageBytes) {
    throw new FeishuNormalizerError(
      'MESSAGE_OVERSIZED',
      `Message size ${byteLength} bytes exceeds maximum limit of ${maxMessageBytes} bytes`,
    )
  }

  // 8. Timestamp freshness & clock skew checks
  const createTimeMs = Number(header.create_time)
  if (!Number.isFinite(createTimeMs)) {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Invalid create_time timestamp')
  }

  if (createTimeMs > now + maxFutureSkewMs) {
    throw new FeishuNormalizerError(
      'FUTURE_TIMESTAMP',
      `Message create_time ${createTimeMs} is in the future relative to ${now} (skew ${createTimeMs - now}ms > allowed ${maxFutureSkewMs}ms)`,
    )
  }

  const ageMs = now - createTimeMs
  if (ageMs > maxMessageAgeMs) {
    throw new FeishuNormalizerError(
      'MESSAGE_EXPIRED',
      `Message created at ${createTimeMs} is ${ageMs}ms old (max allowed ${maxMessageAgeMs}ms)`,
    )
  }

  return {
    provider: 'feishu',
    appId: parseFeishuAppId(header.app_id),
    tenantId: parseFeishuTenantId(header.tenant_key),
    chatId: parseFeishuChatId(message.chat_id),
    senderId: parseFeishuSenderId(senderId),
    eventId: parseFeishuEventId(header.event_id),
    messageId: message.message_id,
    createTime: createTimeMs,
    chatType: 'p2p',
    text,
  }
}

const THINK_TAG_REGEX = /<think>[\s\S]*?<\/think>/gi
const BEARER_TOKEN_REGEX = /Bearer\s+[a-z0-9_.-]+/gi
const GENERIC_API_KEY_REGEX = /(?:sk-[a-zA-Z0-9_\-]{20,}|cli_[a-zA-Z0-9]{16})/g

/**
 * Sanitize outbound text before sending to the external platform.
 *
 * Enforces:
 * 1. Strips hidden model reasoning transcripts (<think>...</think>).
 * 2. Redacts suspected credential and token leakage.
 * 3. Truncates text exceeding the platform maximum safe length.
 *
 * @param text - Raw outbound response text from assistant.
 * @param maxLength - Maximum safe character count (default: 30,000).
 * @returns Clean, safe platform outbound text.
 */
export function sanitizeOutboundText(text: string, maxLength = 30_000): string {
  let cleaned = text.replace(THINK_TAG_REGEX, '')
  cleaned = cleaned.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]')
  cleaned = cleaned.replace(GENERIC_API_KEY_REGEX, '[REDACTED_KEY]')
  cleaned = cleaned.trim()

  if (cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength)
  }
  return cleaned
}

/** Structured normalized card action payload. */
export interface NormalizedFeishuCardAction {
  readonly provider: 'feishu'
  readonly appId: string
  readonly tenantKey: string
  readonly chatId: string
  readonly operatorId: string
  readonly openId: string
  readonly openMessageId: string
  readonly actionTag: string
  readonly actionName?: string | undefined
  readonly actionValue: Record<string, unknown>
  readonly formValue?: Record<string, unknown> | undefined
  readonly token: string
}

/** Options configuring card action normalization. */
export interface FeishuCardActionOptions {
  readonly expectedAppId?: string | undefined
}

const rawCardOperatorSchema = z
  .object({
    open_id: z.string().optional(),
    user_id: z.string().optional(),
    union_id: z.string().optional(),
    name: z.string().optional(),
    operator_id: z
      .object({
        open_id: z.string().optional(),
        user_id: z.string().optional(),
        union_id: z.string().optional(),
      })
      .optional(),
    tenant_key: z.string().optional(),
  })
  .optional()

const rawCardActionDetailsSchema = z
  .object({
    tag: z.string().optional(),
    name: z.string().optional(),
    value: z.record(z.string(), z.unknown()).optional(),
    form_value: z.record(z.string(), z.unknown()).optional(),
    option: z.unknown().optional(),
  })
  .optional()

const rawCardContextSchema = z
  .object({
    open_message_id: z.string().optional(),
    open_chat_id: z.string().optional(),
  })
  .optional()

const rawCardActionLooseSchema = z.object({
  schema: z.string().optional(),
  header: z
    .object({
      app_id: z.string().optional(),
      tenant_key: z.string().optional(),
      token: z.string().optional(),
      event_id: z.string().optional(),
    })
    .optional(),
  event: z
    .object({
      operator: rawCardOperatorSchema,
      action: rawCardActionDetailsSchema,
      context: rawCardContextSchema,
    })
    .optional(),
  app_id: z.string().optional(),
  tenant_key: z.string().optional(),
  token: z.string().optional(),
  operator: rawCardOperatorSchema,
  action: rawCardActionDetailsSchema,
  context: rawCardContextSchema,
  open_id: z.string().optional(),
  open_message_id: z.string().optional(),
  open_chat_id: z.string().optional(),
  action_name: z.string().optional(),
  action_value: z.record(z.string(), z.unknown()).optional(),
  form_value: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Normalize and validate an interactive card action callback.
 *
 * Supports both real v2 card.action.trigger events (nested wire format or SDK flattened)
 * and legacy card action payloads, extracting authenticated app, chat, and operator identities.
 *
 * Note: Never trusts card-supplied tenant/session/callId for authorization;
 * the runtime resolves authority against durable Session records.
 *
 * @param raw - Raw card callback body.
 * @param options - Validation options (e.g. expectedAppId).
 * @returns Validated normalized card action.
 */
export function normalizeFeishuCardAction(
  raw: unknown,
  options: FeishuCardActionOptions = {},
): NormalizedFeishuCardAction {
  const parsed = rawCardActionLooseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new FeishuNormalizerError(
      'MALFORMED_PAYLOAD',
      `Invalid card action structure: ${parsed.error.message}`,
    )
  }

  const data = parsed.data
  const appId =
    data.header?.app_id ??
    data.app_id ??
    options.expectedAppId ??
    ''

  if (options.expectedAppId && appId && appId !== options.expectedAppId) {
    throw new FeishuNormalizerError(
      'APP_ID_MISMATCH',
      `Card action appId '${appId}' does not match expected '${options.expectedAppId}'`,
    )
  }

  const operatorObj = data.event?.operator ?? data.operator
  const tenantKey =
    data.header?.tenant_key ??
    operatorObj?.tenant_key ??
    data.tenant_key ??
    ''

  const operatorId =
    operatorObj?.open_id ??
    operatorObj?.operator_id?.open_id ??
    operatorObj?.user_id ??
    operatorObj?.operator_id?.user_id ??
    data.open_id ??
    ''

  const contextObj = data.event?.context ?? data.context
  const chatId =
    contextObj?.open_chat_id ??
    data.open_chat_id ??
    ''

  const openMessageId =
    contextObj?.open_message_id ??
    data.open_message_id ??
    ''

  const action = data.event?.action ?? data.action
  const actionTag = action?.tag ?? action?.name ?? data.action_name ?? ''
  const actionName = action?.name ?? data.action_name
  const formValue = action?.form_value ?? data.form_value
  const actionValue = action?.value ?? data.action_value ?? {}

  if (!appId.trim()) {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Missing app_id in card action callback')
  }

  if (!tenantKey.trim()) {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Missing tenant_key (org) in card action callback')
  }

  if (!chatId.trim()) {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Missing open_chat_id in card action callback')
  }

  if (!operatorId.trim()) {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Missing operator open_id in card action callback')
  }

  if (!openMessageId.trim()) {
    throw new FeishuNormalizerError('MALFORMED_PAYLOAD', 'Missing open_message_id in card action callback')
  }

  if (!actionTag.trim()) {
    throw new FeishuNormalizerError(
      'MALFORMED_PAYLOAD',
      'Missing action tag or name in card action callback',
    )
  }

  const token = data.header?.token ?? data.token ?? ''

  return {
    provider: 'feishu',
    appId,
    tenantKey,
    chatId,
    operatorId,
    openId: operatorId,
    openMessageId,
    actionTag,
    ...(actionName !== undefined ? { actionName } : {}),
    actionValue,
    ...(formValue !== undefined ? { formValue } : {}),
    token,
  }
}
