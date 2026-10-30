/**
 * Storage domain specifications, receipt tracking, and delivery state management
 * for Feishu IM ingress and isolated tenant runtime.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/storage
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { mintImSessionRequestId } from './source.ts'

/** Format schema version for Feishu IM ingress and tenant receipt storage domains. */
export const IM_SCHEMA_VERSION = 1

/** Registered storage domain name for Feishu IM ingress state. */
export const INGRESS_DOMAIN_NAME = 'im_ingress'

/** Registered storage domain name for isolated tenant execution receipts. */
export const TENANT_RECEIPT_DOMAIN_NAME = 'im_tenant_receipt'

/** Canonical RFC 4122 UUID v4 regex used to validate SessionRequestId on durable records. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Zod schema validating one operator authorization binding. */
export const operatorBindingSchema = z.object({
  bindingKey: z.string().min(1),
  operatorId: z.string().min(1),
  targetTenantId: z.string().min(1),
  provider: z.enum(['feishu', 'dingtalk']),
  appId: z.string().min(1),
  tenantId: z.string().min(1),
  chatId: z.string().min(1),
  senderId: z.string().min(1),
  authorizedAt: z.string().min(1),
  revokedAt: z.string().nullable(),
}).refine(binding => binding.bindingKey === JSON.stringify([
  binding.provider, binding.appId, binding.tenantId, binding.chatId, binding.senderId,
]),
'Operator binding key must match its complete identity')

/** One operator authorization record in the ingress domain. */
export type OperatorBindingRecord = z.infer<typeof operatorBindingSchema>

/** Private expiring capability used only by the DingTalk reply sender. */
export const imReplyRouteSchema = z.object({
  kind: z.literal('dingtalk-session-webhook'),
  url: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && ['oapi.dingtalk.com', 'api.dingtalk.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.hash
  }, 'Reply URL must use an official HTTPS endpoint'),
  expiresAt: z.number().int().positive(),
}).strict()

/** Zod schema validating one incoming delivery and durable outbox tracking record. */
export const ingressDeliverySchema = z.object({
  deliveryKey: z.string().min(1),
  operatorId: z.string().min(1),
  targetTenantId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().regex(UUID_REGEX, 'Must be valid UUID'),
  prompt: z.string(),
  replyRoute: imReplyRouteSchema.nullable().default(null),
  status: z.enum(['received', 'in_flight', 'completed', 'failed', 'unknown']),
  receivedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  retryCount: z.number().int().nonnegative(),
  outboxStatus: z.enum(['pending', 'in_flight', 'sent', 'failed', 'unknown', 'not_applicable']),
  outboxReplyText: z.string().nullable(),
  outboxVersion: z.number().int().nonnegative(),
  outboxAttempts: z.number().int().nonnegative(),
  outboxDeadline: z.string().nullable(),
  outboxLastAttemptAt: z.string().nullable(),
  outboxMessageId: z.string().nullable(),
  outboxError: z.string().nullable(),
})

/** One delivery record tracking ingress inbox, session assignment, and outbox reply. */
export type IngressDeliveryRecord = z.infer<typeof ingressDeliverySchema>

/** Zod schema validating one tenant runtime delivery execution receipt. */
export const tenantReceiptSchema = z.object({
  deliveryKey: z.string().min(1),
  sessionId: z.string().min(1),
  requestId: z.string().regex(UUID_REGEX, 'Must be valid UUID'),
  operatorId: z.string().min(1),
  status: z.enum(['admitting', 'admitted', 'completed', 'failed', 'cancelled']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  resultText: z.string().nullable(),
  error: z.string().nullable(),
})

/** One receipt record in the isolated tenant runtime domain. */
export type TenantReceiptRecord = z.infer<typeof tenantReceiptSchema>

/** Domain declaration for ingress operator bindings and deliveries. */
export const ingressDomainSpec = defineDomain({
  name: INGRESS_DOMAIN_NAME,
  version: IM_SCHEMA_VERSION,
  tables: {
    operators: domainTable<string, OperatorBindingRecord>(operatorBindingSchema),
    deliveries: domainTable<string, IngressDeliveryRecord>(ingressDeliverySchema),
  },
})

/** Domain declaration for tenant execution receipts. */
export const tenantReceiptDomainSpec = defineDomain({
  name: TENANT_RECEIPT_DOMAIN_NAME,
  version: IM_SCHEMA_VERSION,
  tables: {
    receipts: domainTable<string, TenantReceiptRecord>(tenantReceiptSchema),
  },
})

/**
 * Generate a deterministic composite lookup key for an operator binding.
 *
 * @param provider - Messaging provider identity ('feishu').
 * @param appId - External application ID.
 * @param tenantId - External enterprise tenant ID.
 * @param chatId - Chat or group ID.
 * @param senderId - Sender user ID.
 * @returns Serialized JSON string key.
 */
export function encodeOperatorBindingKey(
  provider: 'feishu' | 'dingtalk',
  appId: string,
  tenantId: string,
  chatId: string,
  senderId: string,
): string {
  return JSON.stringify([provider, appId, tenantId, chatId, senderId])
}

/**
 * Ingress domain manager for operator authorization and delivery lifecycle.
 */
export class IngressStorage {
  private readonly operatorsTable: KvTable<string, OperatorBindingRecord>
  private readonly deliveriesTable: KvTable<string, IngressDeliveryRecord>
  private readonly inFlightDeliveries = new Map<string, Promise<IngressDeliveryRecord>>()

  /**
   * @param domain - Open domain handle for the ingress store.
   */
  constructor(private readonly domain: Domain<typeof ingressDomainSpec>) {
    this.operatorsTable = domain.table('operators')
    this.deliveriesTable = domain.table('deliveries')
  }

  /** Snapshot the current authorization records for local administration.
   * @returns Current bindings, including revoked records.
   */
  listBindings(): readonly OperatorBindingRecord[] {
    return Array.from(this.operatorsTable.entries(), ([, record]) => record)
  }

  /**
   * Look up an operator binding by its composite key.
   * @param bindingKey - Encoded operator binding key.
   * @returns The operator record, or undefined if absent.
   */
  getBinding(bindingKey: string): OperatorBindingRecord | undefined {
    return this.operatorsTable.get(bindingKey)
  }

  /**
   * Store or overwrite an operator binding record durably.
   *
   * @param binding - The full operator binding record.
   * @returns Resolution after durability.
   */
  async putBinding(binding: OperatorBindingRecord): Promise<void> {
    await this.operatorsTable.put(binding.bindingKey, binding)
  }

  /**
   * Revoke an existing operator binding.
   *
   * @param bindingKey - Encoded operator binding key.
   * @returns Resolution after durability.
   */
  async revokeBinding(bindingKey: string): Promise<void> {
    const existing = this.operatorsTable.get(bindingKey)
    if (!existing) return
    await this.operatorsTable.update(bindingKey, current => ({
      ...current,
      revokedAt: new Date().toISOString(),
    }))
  }

  /**
   * Find an active (non-revoked) operator binding.
   *
   * @param provider - Messaging provider.
   * @param appId - External application ID.
   * @param tenantId - External enterprise tenant ID.
   * @param chatId - Chat ID.
   * @param senderId - Sender user ID.
   * @returns The active record, or undefined if absent or revoked.
   */
  findActiveBinding(
    provider: 'feishu' | 'dingtalk',
    appId: string,
    tenantId: string,
    chatId: string,
    senderId: string,
  ): OperatorBindingRecord | undefined {
    const key = encodeOperatorBindingKey(provider, appId, tenantId, chatId, senderId)
    const record = this.operatorsTable.get(key)
    if (!record || record.revokedAt !== null) return undefined
    return record
  }

  /**
   * Read one delivery record by canonical delivery key.
   *
   * @param deliveryKey - Canonical JSON delivery key.
   * @returns The delivery record, or undefined if absent.
   */
  getDelivery(deliveryKey: string): IngressDeliveryRecord | undefined {
    return this.deliveriesTable.get(deliveryKey)
  }

  /**
   * Snapshot inbox records for bounded dispatcher recovery under the single writer lock.
   * @returns Records in durable insertion order.
   */
  listDeliveries(): readonly IngressDeliveryRecord[] {
    return Array.from(this.deliveriesTable.entries(), ([, record]) => record)
  }

  /**
   * Record receipt of an incoming delivery. Serializes execution per deliveryKey
   * to eliminate check-then-act races across concurrent calls.
   * If existing, asserts matching operatorId and targetTenantId, then increments retryCount.
   * If fresh, mints a new branded SessionRequestId and writes the initial record.
   *
   * @param params - Initial delivery properties.
   * @returns The stored (or updated) delivery record.
   * @throws Error if an existing record conflicts with incoming operatorId or targetTenantId.
   */
  async recordDeliveryReceived(params: {
    readonly deliveryKey: string
    readonly operatorId: string
    readonly targetTenantId: string
    readonly prompt: string
    readonly replyRoute?: z.infer<typeof imReplyRouteSchema>
  }): Promise<IngressDeliveryRecord> {
    const inFlight = this.inFlightDeliveries.get(params.deliveryKey)
    if (inFlight) {
      return inFlight.then(() => this.recordDeliveryReceived(params))
    }
    const execution = this.doRecordDeliveryReceived(params)
    this.inFlightDeliveries.set(params.deliveryKey, execution)
    try {
      return await execution
    } finally {
      this.inFlightDeliveries.delete(params.deliveryKey)
    }
  }

  private async doRecordDeliveryReceived(params: {
    readonly deliveryKey: string
    readonly operatorId: string
    readonly targetTenantId: string
    readonly prompt: string
    readonly replyRoute?: z.infer<typeof imReplyRouteSchema>
  }): Promise<IngressDeliveryRecord> {
    const existing = this.deliveriesTable.get(params.deliveryKey)
    const now = new Date().toISOString()
    if (existing) {
      if (existing.operatorId !== params.operatorId || existing.targetTenantId !== params.targetTenantId
        || existing.prompt !== params.prompt) {
        throw new Error(
          `Conflicting delivery identity for key ${params.deliveryKey}: existing operatorId=${existing.operatorId}, targetTenantId=${existing.targetTenantId}; incoming operatorId=${params.operatorId}, targetTenantId=${params.targetTenantId}`,
        )
      }
      return this.deliveriesTable.update(params.deliveryKey, current => ({
        ...current,
        retryCount: current.retryCount + 1,
        updatedAt: now,
      }))
    }

    const newRequestId = mintImSessionRequestId()
    const newRecord: IngressDeliveryRecord = {
      deliveryKey: params.deliveryKey,
      operatorId: params.operatorId,
      targetTenantId: params.targetTenantId,
      sessionId: null,
      requestId: newRequestId,
      prompt: params.prompt,
      replyRoute: params.replyRoute ?? null,
      status: 'received',
      receivedAt: now,
      updatedAt: now,
      retryCount: 0,
      outboxStatus: 'pending',
      outboxReplyText: null,
      outboxVersion: 1,
      outboxAttempts: 0,
      outboxDeadline: null,
      outboxLastAttemptAt: null,
      outboxMessageId: null,
      outboxError: null,
    }
    await this.deliveriesTable.put(params.deliveryKey, newRecord)
    return newRecord
  }

  /**
   * Update delivery execution status, optionally assigning a session ID.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param status - Next delivery status.
   * @param sessionId - Optional session ID assignment.
   * @returns The updated delivery record.
   */
  async updateDeliveryStatus(
    deliveryKey: string,
    status: IngressDeliveryRecord['status'],
    sessionId?: string,
  ): Promise<IngressDeliveryRecord> {
    const now = new Date().toISOString()
    return this.deliveriesTable.update(deliveryKey, current => ({
      ...current,
      status,
      ...(sessionId !== undefined ? { sessionId } : {}),
      updatedAt: now,
    }))
  }

  /**
   * Persist execution completion and its final reply in one domain write.
   * @param deliveryKey - Receipt-correlated delivery.
   * @param sessionId - Tenant-reported owned session.
   * @param replyText - Public final assistant text, or null when absent.
   * @returns Updated inbox/outbox record without resetting any prior send attempt.
   */
  async completeWithReply(deliveryKey: string, sessionId: string, replyText: string | null): Promise<IngressDeliveryRecord> {
    return this.deliveriesTable.update(deliveryKey, current => ({
      ...current,
      sessionId,
      status: 'completed',
      outboxReplyText: current.outboxReplyText ?? replyText,
      outboxStatus: replyText === null && current.outboxReplyText === null ? 'not_applicable' : current.outboxStatus,
      updatedAt: new Date().toISOString(),
    }))
  }

  /**
   * Prepare an outbox reply body and deadline before dispatching to the external platform.
   * Disallows preparing a reply if an attempt is currently in_flight, if the reply was
   * already sent, or if the outbox is in an uncertain 'unknown' status.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param replyText - Reply text to send.
   * @param deadline - Optional ISO deadline for delivery.
   * @returns The updated delivery record.
   * @throws Error if outbox is currently in_flight, sent, or unknown.
   */
  async prepareOutboxReply(
    deliveryKey: string,
    replyText: string,
    deadline?: string,
  ): Promise<IngressDeliveryRecord> {
    const now = new Date().toISOString()
    return this.deliveriesTable.update(deliveryKey, (current) => {
      if (current.outboxStatus === 'in_flight') {
        throw new Error(
          `Cannot prepare outbox reply while send attempt is in flight for key ${deliveryKey}`,
        )
      }
      if (current.outboxStatus === 'sent') {
        throw new Error(
          `Cannot prepare outbox reply for already sent delivery ${deliveryKey}`,
        )
      }
      if (current.outboxStatus === 'unknown') {
        throw new Error(
          `Cannot prepare outbox reply while outbox status is unknown for key ${deliveryKey}; operator resolution required`,
        )
      }
      return {
        ...current,
        outboxStatus: 'pending',
        outboxReplyText: replyText,
        outboxVersion: current.outboxVersion + 1,
        outboxDeadline: deadline ?? current.outboxDeadline,
        updatedAt: now,
      }
    })
  }

  /**
   * Record commencement of an outbound send attempt.
   * Guarded by expected outbox version and legal state transitions.
   * Refuses attempts when already in_flight, already sent, or in 'unknown' status.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param expectedVersion - Expected outbox version.
   * @returns The updated delivery record with outboxStatus 'in_flight'.
   * @throws Error if version mismatches or if outboxStatus is in_flight, sent, or unknown.
   */
  async recordOutboxAttempt(
    deliveryKey: string,
    expectedVersion: number,
  ): Promise<IngressDeliveryRecord> {
    const now = new Date().toISOString()
    return this.deliveriesTable.update(deliveryKey, (current) => {
      if (current.outboxStatus === 'in_flight') {
        throw new Error(
          `Cannot start outbox attempt while an attempt is already in flight for key ${deliveryKey}`,
        )
      }
      if (current.outboxStatus === 'sent') {
        throw new Error(
          `Cannot start outbox attempt for already sent delivery ${deliveryKey}`,
        )
      }
      if (current.outboxStatus === 'unknown') {
        throw new Error(
          `Cannot automatically retry outbox in unknown status for key ${deliveryKey}; operator intervention required`,
        )
      }
      if (current.outboxVersion !== expectedVersion) {
        throw new Error(
          `Outbox version mismatch for key ${deliveryKey}: expected version ${expectedVersion}, found version ${current.outboxVersion}`,
        )
      }
      return {
        ...current,
        outboxStatus: 'in_flight',
        outboxAttempts: current.outboxAttempts + 1,
        outboxLastAttemptAt: now,
        updatedAt: now,
      }
    })
  }

  /**
   * Record successful outbound reply transmission.
   * Guarded by expected outbox version and attempt counter to reject stale ACKs.
   * Only valid from 'in_flight' status.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param expectedVersion - Expected outbox version.
   * @param expectedAttempt - Expected outbox attempt counter.
   * @param messageId - Actual platform message ID, or null when its protocol confirms acceptance without an ID.
   * @returns The updated delivery record.
   * @throws Error if outbox is not in_flight or if expectedVersion or expectedAttempt mismatch.
   */
  async recordOutboxSuccess(
    deliveryKey: string,
    expectedVersion: number,
    expectedAttempt: number,
    messageId: string | null,
  ): Promise<IngressDeliveryRecord> {
    const now = new Date().toISOString()
    return this.deliveriesTable.update(deliveryKey, (current) => {
      if (current.outboxStatus !== 'in_flight') {
        throw new Error(
          `Cannot record outbox success for key ${deliveryKey}: outbox is not in_flight (status=${current.outboxStatus})`,
        )
      }
      if (current.outboxVersion !== expectedVersion || current.outboxAttempts !== expectedAttempt) {
        throw new Error(
          `Outbox ACK transition rejected for key ${deliveryKey}: expected version ${expectedVersion} attempt ${expectedAttempt}, found version ${current.outboxVersion} attempt ${current.outboxAttempts}`,
        )
      }
      return {
        ...current,
        outboxStatus: 'sent',
        outboxMessageId: messageId,
        outboxError: null,
        updatedAt: now,
      }
    })
  }

  /**
   * Record outbound reply failure. Guarded by expected outbox version and attempt counter.
   * Only valid from 'in_flight' status.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param expectedVersion - Expected outbox version.
   * @param expectedAttempt - Expected outbox attempt counter.
   * @param error - Error explanation.
   * @param isUnknownOutcome - Whether transport failure left delivery state indeterminate.
   * @returns The updated delivery record.
   * @throws Error if outbox is not in_flight or if expectedVersion or expectedAttempt mismatch.
   */
  async recordOutboxFailure(
    deliveryKey: string,
    expectedVersion: number,
    expectedAttempt: number,
    error: string,
    isUnknownOutcome: boolean = false,
  ): Promise<IngressDeliveryRecord> {
    const now = new Date().toISOString()
    return this.deliveriesTable.update(deliveryKey, (current) => {
      if (current.outboxStatus !== 'in_flight') {
        throw new Error(
          `Cannot record outbox failure for key ${deliveryKey}: outbox is not in_flight (status=${current.outboxStatus})`,
        )
      }
      if (current.outboxVersion !== expectedVersion || current.outboxAttempts !== expectedAttempt) {
        throw new Error(
          `Outbox failure transition rejected for key ${deliveryKey}: expected version ${expectedVersion} attempt ${expectedAttempt}, found version ${current.outboxVersion} attempt ${current.outboxAttempts}`,
        )
      }
      return {
        ...current,
        outboxStatus: isUnknownOutcome ? 'unknown' : 'failed',
        outboxError: error,
        updatedAt: now,
      }
    })
  }

  /**
   * Close the underlying domain handle.
   *
   * @returns Resolution when closed.
   */
  async close(): Promise<void> {
    await this.domain.close()
  }
}

/**
 * Tenant runtime manager for execution receipts.
 */
export class TenantReceiptStorage {
  private readonly receiptsTable: KvTable<string, TenantReceiptRecord>
  private readonly inFlightReceipts = new Map<string, Promise<TenantReceiptRecord>>()

  /**
   * @param domain - Open domain handle for the tenant receipt store.
   */
  constructor(private readonly domain: Domain<typeof tenantReceiptDomainSpec>) {
    this.receiptsTable = domain.table('receipts')
  }

  /**
   * Look up a tenant receipt by canonical delivery key.
   *
   * @param deliveryKey - Canonical delivery key.
   * @returns The receipt record, or undefined if absent.
   */
  getReceipt(deliveryKey: string): TenantReceiptRecord | undefined {
    return this.receiptsTable.get(deliveryKey)
  }

  /**
   * Record pre-admission receipt in status 'admitting' before submitting to Agent.
   * Serializes execution per deliveryKey to prevent duplicate creation races.
   * If a receipt already exists, asserts matching sessionId, requestId, and operatorId,
   * then returns the existing record.
   *
   * @param params - Admission parameters.
   * @returns The stored or existing receipt.
   * @throws Error if an existing receipt conflicts with incoming admission parameters.
   */
  async recordAdmitting(params: {
    readonly deliveryKey: string
    readonly sessionId: string
    readonly requestId: string
    readonly operatorId: string
  }): Promise<TenantReceiptRecord> {
    const inFlight = this.inFlightReceipts.get(params.deliveryKey)
    if (inFlight) {
      return inFlight.then(() => this.recordAdmitting(params))
    }
    const execution = this.doRecordAdmitting(params)
    this.inFlightReceipts.set(params.deliveryKey, execution)
    try {
      return await execution
    } finally {
      this.inFlightReceipts.delete(params.deliveryKey)
    }
  }

  private async doRecordAdmitting(params: {
    readonly deliveryKey: string
    readonly sessionId: string
    readonly requestId: string
    readonly operatorId: string
  }): Promise<TenantReceiptRecord> {
    const existing = this.receiptsTable.get(params.deliveryKey)
    if (existing) {
      if (
        existing.sessionId !== params.sessionId ||
        existing.requestId !== params.requestId ||
        existing.operatorId !== params.operatorId
      ) {
        throw new Error(
          `Conflicting receipt identity for key ${params.deliveryKey}: existing session=${existing.sessionId}, request=${existing.requestId}, operator=${existing.operatorId}; incoming session=${params.sessionId}, request=${params.requestId}, operator=${params.operatorId}`,
        )
      }
      return existing
    }

    const now = new Date().toISOString()
    const newRecord: TenantReceiptRecord = {
      deliveryKey: params.deliveryKey,
      sessionId: params.sessionId,
      requestId: params.requestId,
      operatorId: params.operatorId,
      status: 'admitting',
      createdAt: now,
      updatedAt: now,
      resultText: null,
      error: null,
    }
    await this.receiptsTable.put(params.deliveryKey, newRecord)
    return newRecord
  }

  /**
   * Mark receipt as successfully admitted into the agent session.
   *
   * @param deliveryKey - Canonical delivery key.
   * @returns The updated receipt.
   */
  async markAdmitted(deliveryKey: string): Promise<TenantReceiptRecord> {
    const now = new Date().toISOString()
    return this.receiptsTable.update(deliveryKey, current => ({
      ...current,
      status: 'admitted',
      updatedAt: now,
    }))
  }

  /**
   * Mark receipt as completed following session turn conclusion, saving correlated result.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param resultText - Turn result summary or text.
   * @returns The updated receipt.
   */
  async markCompleted(deliveryKey: string, resultText?: string): Promise<TenantReceiptRecord> {
    const now = new Date().toISOString()
    return this.receiptsTable.update(deliveryKey, current => ({
      ...current,
      status: 'completed',
      resultText: resultText ?? current.resultText,
      updatedAt: now,
    }))
  }

  /**
   * Mark receipt as failed with an error message.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param error - Error explanation.
   * @returns The updated receipt.
   */
  async markFailed(deliveryKey: string, error: string): Promise<TenantReceiptRecord> {
    const now = new Date().toISOString()
    return this.receiptsTable.update(deliveryKey, current => ({
      ...current,
      status: 'failed',
      error,
      updatedAt: now,
    }))
  }

  /**
   * Mark receipt as cancelled.
   *
   * @param deliveryKey - Canonical delivery key.
   * @returns The updated receipt.
   */
  async markCancelled(deliveryKey: string): Promise<TenantReceiptRecord> {
    const now = new Date().toISOString()
    return this.receiptsTable.update(deliveryKey, current => ({
      ...current,
      status: 'cancelled',
      updatedAt: now,
    }))
  }

  /**
   * Close the underlying domain handle.
   *
   * @returns Resolution when closed.
   */
  async close(): Promise<void> {
    await this.domain.close()
  }
}

/** Explicit asynchronous storage-read result used for receipt reconciliation. */
export interface SessionLogSnapshot {
  readonly id: string
  readonly events: readonly SessionEvent[]
}

/** Possible reconciliation outcomes for reconnecting or crashed deliveries. */
export type DeliveryReconciliationResult =
  | {
    readonly state: 'not_found'
  }
  | {
    readonly state: 'session_mismatch'
    readonly receiptSessionId: string
    readonly queriedSessionId: string
  }
  | {
    readonly state: 'admitted'
    readonly requestId: string
    readonly sessionId: string
  }
  | {
    readonly state: 'completed'
    readonly requestId: string
    readonly sessionId: string
    readonly resultText: string | null
  }
  | {
    readonly state: 'failed'
    readonly requestId: string
    readonly sessionId: string
    readonly error: string | null
  }
  | {
    readonly state: 'cancelled'
    readonly requestId: string
    readonly sessionId: string
  }
  | {
    readonly state: 'unknown'
    readonly requestId: string
    readonly sessionId: string
    readonly reason: string
  }

/**
 * Reconcile a tenant receipt against authoritative Session log events.
 *
 * Verifies that the querying session matches the receipt's recorded session ID.
 * Asserts presence of a user/message event with source.kind === 'user' and matching rpcId.
 * Correlates turn outcome (completion, failure, or cancellation) against session events.
 *
 * @param receipt - Stored receipt in tenant domain, or undefined if absent.
 * @param session - Explicitly read durable log prefix for the receipt-owned Session.
 * @returns Bounded reconciliation outcome.
 */
export function reconcileDelivery(
  receipt: TenantReceiptRecord | undefined,
  session: SessionLogSnapshot,
): DeliveryReconciliationResult {
  if (!receipt) {
    return { state: 'not_found' }
  }

  if (receipt.sessionId !== session.id) {
    return {
      state: 'session_mismatch',
      receiptSessionId: receipt.sessionId,
      queriedSessionId: session.id,
    }
  }

  const sessionEvents = session.events
  const matchingPromptIndex = sessionEvents.findIndex((event) => {
    if (event.type !== 'user/message') return false
    const source = event.data.source
    return source.kind === 'user' && 'rpcId' in source && source.rpcId === receipt.requestId
  })

  if (matchingPromptIndex !== -1) {
    let assistantText = receipt.resultText

    for (let i = matchingPromptIndex + 1; i < sessionEvents.length; i++) {
      const event = sessionEvents[i]
      if (!event) continue
      if (event.type === 'assistant/message') {
        const content = event.data.message.content
        const textBlocks: string[] = []
        for (const block of content) {
          if (block.type === 'text') {
            textBlocks.push(block.text)
          }
        }
        if (textBlocks.length > 0) {
          assistantText = textBlocks.join('\n')
        }
      }
      if (event.type === 'turn/end') {
        const reason = event.data.reason
        switch (reason.kind) {
          case 'completed':
            return {
              state: 'completed',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              resultText: assistantText,
            }
          case 'aborted':
            return {
              state: 'cancelled',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
            }
          case 'error':
            return {
              state: 'failed',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              error: reason.error.message,
            }
          case 'blocked':
            return {
              state: 'failed',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              error: 'Turn blocked',
            }
          case 'max-tokens':
            return {
              state: 'failed',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              error: 'Turn reached output token limit',
            }
          case 'interrupted':
            return {
              state: 'unknown',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              reason: 'Turn interrupted by crash or orphan recovery',
            }
          case 'forked':
            return {
              state: 'unknown',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              reason: 'Turn ended by fork boundary',
            }
          default:
            return {
              state: 'unknown',
              requestId: receipt.requestId,
              sessionId: receipt.sessionId,
              reason: `Unknown turn end reason: ${(reason as { kind: string }).kind}`,
            }
        }
      }
    }

    if (receipt.status === 'completed') {
      return {
        state: 'unknown',
        requestId: receipt.requestId,
        sessionId: receipt.sessionId,
        reason: 'Receipt marked completed but session log missing durable turn/end evidence',
      }
    }
    if (receipt.status === 'failed') {
      return { state: 'failed', requestId: receipt.requestId, sessionId: receipt.sessionId, error: receipt.error }
    }
    if (receipt.status === 'cancelled') {
      return { state: 'cancelled', requestId: receipt.requestId, sessionId: receipt.sessionId }
    }

    return { state: 'admitted', requestId: receipt.requestId, sessionId: receipt.sessionId }
  }

  // No matching prompt found in session log
  if (receipt.status === 'admitting') {
    return {
      state: 'unknown',
      requestId: receipt.requestId,
      sessionId: receipt.sessionId,
      reason: 'Receipt is in admitting state but session log does not contain user/message with matching rpcId',
    }
  }

  if (receipt.status === 'failed') {
    return { state: 'failed', requestId: receipt.requestId, sessionId: receipt.sessionId, error: receipt.error }
  }

  if (receipt.status === 'cancelled') {
    return { state: 'cancelled', requestId: receipt.requestId, sessionId: receipt.sessionId }
  }

  return {
    state: 'unknown',
    requestId: receipt.requestId,
    sessionId: receipt.sessionId,
    reason: `Receipt has status '${receipt.status}' but no matching session log message exists`,
  }
}
