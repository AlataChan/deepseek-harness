/**
 * Types, branded identifiers, and platform contracts for DingTalk IM transport.
 *
 * @module @deepseek-ai/dsh-experimental-im-dingtalk/types
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Normalized incoming IM message event across all supported platform transports.
 */
export interface IncomingImMessage {
  readonly provider: 'feishu' | 'dingtalk'
  readonly appId: string
  readonly tenantId: string
  readonly chatId: string
  readonly senderId: string
  readonly eventId: string
  readonly messageId: string
  /** Private reply capability, stored only in the ingress database. */
  readonly replyRoute?: {
    readonly kind: 'dingtalk-session-webhook'
    readonly url: string
    readonly expiresAt: number
  }
  readonly createTime: number
  readonly chatType: 'p2p' | 'group'
  readonly text: string
}

/**
 * Result returned by the durable ingress acceptor when an incoming message is processed.
 */
export interface IngressAcceptResult {
  readonly deliveryKey: string
  readonly requestId: string
  readonly duplicate: boolean
}

/**
 * Durable ingress acceptor contract consumed by platform transports.
 * Awaits durable inbox write before resolving, throwing on write failure to yield a transport retry.
 */
export interface IngressDurableAcceptor {
  handleIncomingMessage(event: IncomingImMessage): Promise<IngressAcceptResult>
}

/** Branded identifier for a DingTalk application client ID / appKey. */
export type DingTalkClientId = Branded<'DingTalkClientId'>

/** Branded identifier for a DingTalk enterprise corporate workspace ID (corpId). */
export type DingTalkCorpId = Branded<'DingTalkCorpId'>

/** Branded identifier for a DingTalk conversation or chat ID. */
export type DingTalkConversationId = Branded<'DingTalkConversationId'>

/** Branded identifier for a DingTalk sender user ID. */
export type DingTalkSenderId = Branded<'DingTalkSenderId'>

/** Branded identifier for a DingTalk message or event ID. */
export type DingTalkMessageId = Branded<'DingTalkMessageId'>

/**
 * Parse and brand an external DingTalk application client ID string.
 *
 * @param value - Raw client ID from payload or config.
 * @returns The branded DingTalkClientId.
 * @throws TypeError if value is empty.
 */
export function parseDingTalkClientId(value: string): DingTalkClientId {
  if (value.trim() === '') throw new TypeError('DingTalkClientId cannot be empty')
  return brandString<DingTalkClientId>(value)
}

/**
 * Parse and brand an external DingTalk corporate workspace ID string.
 *
 * @param value - Raw corporate ID from payload.
 * @returns The branded DingTalkCorpId.
 * @throws TypeError if value is empty.
 */
export function parseDingTalkCorpId(value: string): DingTalkCorpId {
  if (value.trim() === '') throw new TypeError('DingTalkCorpId cannot be empty')
  return brandString<DingTalkCorpId>(value)
}

/**
 * Parse and brand an external DingTalk conversation ID string.
 *
 * @param value - Raw conversation ID from payload.
 * @returns The branded DingTalkConversationId.
 * @throws TypeError if value is empty.
 */
export function parseDingTalkConversationId(value: string): DingTalkConversationId {
  if (value.trim() === '') throw new TypeError('DingTalkConversationId cannot be empty')
  return brandString<DingTalkConversationId>(value)
}

/**
 * Parse and brand an external DingTalk sender user ID string.
 *
 * @param value - Raw sender user ID from payload.
 * @returns The branded DingTalkSenderId.
 * @throws TypeError if value is empty.
 */
export function parseDingTalkSenderId(value: string): DingTalkSenderId {
  if (value.trim() === '') throw new TypeError('DingTalkSenderId cannot be empty')
  return brandString<DingTalkSenderId>(value)
}

/**
 * Parse and brand an external DingTalk message ID string.
 *
 * @param value - Raw message ID from payload.
 * @returns The branded DingTalkMessageId.
 * @throws TypeError if value is empty.
 */
export function parseDingTalkMessageId(value: string): DingTalkMessageId {
  if (value.trim() === '') throw new TypeError('DingTalkMessageId cannot be empty')
  return brandString<DingTalkMessageId>(value)
}
