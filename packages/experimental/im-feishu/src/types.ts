/**
 * Types and contracts for Feishu IM ingress, delivery identity, and approval context.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/types
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Branded identifier for a Feishu application ID. */
export type FeishuAppId = Branded<'FeishuAppId'>

/** Branded identifier for a Feishu tenant (corporate workspace) ID. */
export type FeishuTenantId = Branded<'FeishuTenantId'>

/** Branded identifier for a Feishu chat or conversation group ID. */
export type FeishuChatId = Branded<'FeishuChatId'>

/** Branded identifier for a Feishu user or sender ID. */
export type FeishuSenderId = Branded<'FeishuSenderId'>

/** Branded identifier for a Feishu webhook or message event ID. */
export type FeishuEventId = Branded<'FeishuEventId'>

/** Branded identifier for an authorized human operator. */
export type OperatorId = Branded<'OperatorId'>

/** Branded identifier for an isolated runtime tenant target. */
export type TargetTenantId = Branded<'TargetTenantId'>

/**
 * Parse and brand a raw external Feishu application ID string.
 *
 * @param value - Raw application ID from wire payload or config.
 * @returns The branded FeishuAppId.
 * @throws TypeError if value is empty.
 */
export function parseFeishuAppId(value: string): FeishuAppId {
  if (value.trim() === '') throw new TypeError('FeishuAppId cannot be empty')
  return brandString<FeishuAppId>(value)
}

/**
 * Parse and brand a raw external Feishu tenant ID string.
 *
 * @param value - Raw tenant ID from wire payload.
 * @returns The branded FeishuTenantId.
 * @throws TypeError if value is empty.
 */
export function parseFeishuTenantId(value: string): FeishuTenantId {
  if (value.trim() === '') throw new TypeError('FeishuTenantId cannot be empty')
  return brandString<FeishuTenantId>(value)
}

/**
 * Parse and brand a raw external Feishu chat ID string.
 *
 * @param value - Raw chat or group ID from wire payload.
 * @returns The branded FeishuChatId.
 * @throws TypeError if value is empty.
 */
export function parseFeishuChatId(value: string): FeishuChatId {
  if (value.trim() === '') throw new TypeError('FeishuChatId cannot be empty')
  return brandString<FeishuChatId>(value)
}

/**
 * Parse and brand a raw external Feishu sender ID string.
 *
 * @param value - Raw user or sender ID from wire payload.
 * @returns The branded FeishuSenderId.
 * @throws TypeError if value is empty.
 */
export function parseFeishuSenderId(value: string): FeishuSenderId {
  if (value.trim() === '') throw new TypeError('FeishuSenderId cannot be empty')
  return brandString<FeishuSenderId>(value)
}

/**
 * Parse and brand a raw external Feishu event ID string.
 *
 * @param value - Raw event or message ID from webhook payload.
 * @returns The branded FeishuEventId.
 * @throws TypeError if value is empty.
 */
export function parseFeishuEventId(value: string): FeishuEventId {
  if (value.trim() === '') throw new TypeError('FeishuEventId cannot be empty')
  return brandString<FeishuEventId>(value)
}

/**
 * Parse and brand an operator identifier string.
 *
 * @param value - Raw operator identifier.
 * @returns The branded OperatorId.
 * @throws TypeError if value is empty.
 */
export function parseOperatorId(value: string): OperatorId {
  if (value.trim() === '') throw new TypeError('OperatorId cannot be empty')
  return brandString<OperatorId>(value)
}

/**
 * Parse and brand a target tenant runtime identifier string.
 *
 * @param value - Raw target tenant runtime identifier.
 * @returns The branded TargetTenantId.
 * @throws TypeError if value is empty.
 */
export function parseTargetTenantId(value: string): TargetTenantId {
  if (value.trim() === '') throw new TypeError('TargetTenantId cannot be empty')
  return brandString<TargetTenantId>(value)
}

/**
 * Normalized incoming IM message event received from an external platform webhook or websocket.
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
 * Durable ingress acceptor contract consumed by platform transports (e.g., Feishu, DingTalk).
 * Awaits durable inbox write before resolving, throwing on write failure to yield a transport 500 / nack.
 */
export interface IngressDurableAcceptor {
  /**
   * Handle and persist an incoming external message event.
   *
   * @param event - Normalized incoming message event from platform transport.
   * @returns Delivery key, session request ID, and duplicate status.
   */
  handleIncomingMessage(event: IncomingImMessage): Promise<IngressAcceptResult>
}

/**
 * Composite key uniquely identifying one authenticated external delivery from Feishu.
 * Stored exclusively in domain storage; never leaked into Session event source.
 */
export interface ImDeliveryKey {
  readonly provider: 'feishu'
  readonly appId: FeishuAppId
  readonly tenantId: FeishuTenantId
  readonly chatId: FeishuChatId
  readonly senderId: FeishuSenderId
  readonly eventId: FeishuEventId
}

/**
 * Validated approval execution context resolved from durable Session log events.
 * Identifies whether an approval request links to an ordinary native tool call
 * or a nested PTC inner dispatch.
 */
export type ResolvedApprovalContext =
  | {
    readonly kind: 'native'
    readonly callId: ToolCallId
    readonly name: string
    readonly arguments: JsonValue
  }
  | {
    readonly kind: 'ptc'
    readonly subCallId: ToolCallId
    readonly rootCallId: ToolCallId
    readonly parentCallId: ToolCallId
    readonly name: string
    readonly arguments: JsonValue
  }
