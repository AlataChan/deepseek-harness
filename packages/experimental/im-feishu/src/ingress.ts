/**
 * Durable IM admission and separately driven delivery recovery. Platform ACKs depend
 * only on authorized inbox persistence, never on tenant availability or model output.
 * @module @deepseek-ai/dsh-experimental-im-feishu/ingress
 */
import { z } from 'zod'
import { parseTargetTenantId, type IncomingImMessage, type IngressAcceptResult, type IngressDurableAcceptor } from './types.ts'
import type { TargetTenantId } from './types.ts'
import { IngressStorage, type IngressDeliveryRecord, type OperatorBindingRecord } from './storage.ts'
import { IpcNotAdmittedError } from './ipc.ts'
import type { TenantIpcClient } from './ipc.ts'

/** Expected denial when a callback no longer has an active authorization binding. */
export class OperatorBindingUnavailableError extends Error {}

/** Tenant client lookup must validate deployed socket ownership before connecting. */
export interface TenantIpcClientProvider {
  /**
   * @param targetTenantId - Administrator-bound tenant; never chosen by a message body.
   * @returns Handshaken client for exactly this tenant.
   */
  getClient(targetTenantId: TargetTenantId): Promise<Pick<TenantIpcClient, 'submitDelivery' | 'getDelivery' | 'cancelDelivery'>>
}

/** Configured admission ceilings. Retention exhaustion fails closed until administrator pruning. */
export const ingressConfigSchema = z.object({
  maxStoredDeliveries: z.number().int().positive(),
  maxPendingAdmissions: z.number().int().positive(),
  maxPromptBytes: z.number().int().positive(),
  maxReplyBytes: z.number().int().positive(),
  maxEventAgeMs: z.number().int().positive(),
  maxFutureSkewMs: z.number().int().nonnegative(),
  maxOutboxAttempts: z.number().int().positive(),
}).strict()
/** Deployment-resolved ingress limits. */
export type IngressConfig = z.infer<typeof ingressConfigSchema>

/** Final public assistant text sender; implementations must not include raw tool or reasoning events. */
export interface ImReplySender {
  /**
   * @param record - Persisted reply version/attempt and destination composite identity.
   * @returns Actual external message ID, or null for confirmed acceptance without an ID; throws on failed or unknown acceptance.
   */
  sendReply(record: IngressDeliveryRecord): Promise<{ readonly messageId: string | null }>
}

/** Durable inbound admission and an explicitly owned dispatcher. */
export class IngressService implements IngressDurableAcceptor {
  private closed = false
  private pendingAdmissions = 0
  private pumping: Promise<void> | undefined
  private readonly admissions = new Map<string, Promise<IngressAcceptResult>>()
  private admissionTail: Promise<void> = Promise.resolve()
  private bindingTail: Promise<void> = Promise.resolve()
  private pendingBindingOperations = 0
  private readonly config: IngressConfig

  /**
   * @param config - Validated deployment limits.
   * @param ingressStorage - Single-writer ingress database.
   * @param clientProvider - Tenant-specific authenticated IPC lookup.
   * @param replySender - Selected platform adapter for final reply sends.
   */
  constructor(config: IngressConfig, private readonly ingressStorage: IngressStorage,
    private readonly clientProvider: TenantIpcClientProvider, private readonly replySender: ImReplySender) {
    this.config = ingressConfigSchema.parse(config)
  }

  /**
   * Authorize every delivery, including retries; persist before returning the platform ACK.
   * @param event - Platform-authenticated, normalized human private-chat message.
   * @returns Stable request ID and whether this delivery already existed.
   */
  handleIncomingMessage(event: IncomingImMessage): Promise<IngressAcceptResult> {
    if (this.pendingAdmissions >= this.config.maxPendingAdmissions) {
      return Promise.reject(new Error('Ingress pending admission limit reached'))
    }
    this.pendingAdmissions++
    const operation = this.accept(event)
    void operation.finally(() => { this.pendingAdmissions-- }).catch(() => undefined)
    return operation
  }

  private accept(event: IncomingImMessage): Promise<IngressAcceptResult> {
    if (this.closed) return Promise.reject(new Error('Ingress admission is closed'))
    const key = JSON.stringify([event.provider, event.appId, event.tenantId, event.chatId, event.senderId, event.eventId])
    const pending = this.admissions.get(key)
    if (pending) return pending.then(() => this.accept(event))
    const operation = this.admissionTail.then(async () => {
      if (this.closed) throw new Error('Ingress admission is closed')
      if (event.chatType !== 'p2p' || Buffer.byteLength(event.text, 'utf8') > this.config.maxPromptBytes) throw new Error('Unsupported or oversized message')
      const age = Date.now() - event.createTime
      if (!Number.isFinite(age) || age > this.config.maxEventAgeMs || age < -this.config.maxFutureSkewMs) throw new Error('Message outside admission time window')
      if (event.provider === 'dingtalk' && (!event.replyRoute || event.replyRoute.expiresAt <= Date.now())) {
        throw new Error('DingTalk requires an unexpired durable reply route')
      }
      const binding = this.bindingFor(key)
      if (!binding) throw new Error('No active operator binding for this message')
      const existing = this.ingressStorage.getDelivery(key)
      if (!existing && this.ingressStorage.listDeliveries().length >= this.config.maxStoredDeliveries) throw new Error('Ingress retained delivery limit reached')
      const record = await this.ingressStorage.recordDeliveryReceived({
        deliveryKey: key, operatorId: binding.operatorId, targetTenantId: binding.targetTenantId, prompt: event.text,
        ...(event.replyRoute ? { replyRoute: event.replyRoute } : {}),
      })
      return { deliveryKey: key, requestId: record.requestId, duplicate: existing !== undefined }
    })
    this.admissions.set(key, operation)
    this.admissionTail = operation.then(() => undefined, () => undefined)
    void operation.finally(() => this.admissions.delete(key)).catch(() => undefined)
    return operation
  }

  /**
   * Run one recovery/dispatch pass. The profile owns scheduling and error reporting.
   * @returns Completion of the shared pass; concurrent calls never start duplicate dispatchers.
   */
  dispatchPending(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Ingress dispatcher is closed'))
    if (this.pumping) return this.pumping
    const operation = this.pump()
    this.pumping = operation
    void operation.finally(() => { if (this.pumping === operation) this.pumping = undefined }).catch(() => undefined)
    return operation
  }

  private async pump(): Promise<void> {
    const blocked = new Set<string>()
    const occupiedTenants = new Set<string>()
    const failures: unknown[] = []
    const records = [...this.ingressStorage.listDeliveries()].sort((a, b) => Number(a.status === 'received') - Number(b.status === 'received'))
    for (const record of records) {
      if (this.closed) break
      const conversation = JSON.stringify(this.identity(record.deliveryKey).slice(0, 5))
      if (blocked.has(conversation) || (record.status === 'received' && occupiedTenants.has(record.targetTenantId))) continue

      try {
        const binding = this.bindingFor(record.deliveryKey)
        if (!binding || binding.operatorId !== record.operatorId || binding.targetTenantId !== record.targetTenantId) {
          if (record.status === 'received') await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, 'failed')
          else if (record.status === 'in_flight') {
            const client = await this.clientProvider.getClient(parseTargetTenantId(record.targetTenantId))
            await client.cancelDelivery(record.deliveryKey)
            await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, 'unknown')
          }
          blocked.add(conversation)
          continue
        }
        if (record.status === 'received' || record.status === 'in_flight' || record.status === 'unknown') {
          const client = await this.clientProvider.getClient(parseTargetTenantId(record.targetTenantId))
          try {
            if (record.status === 'received') {
              await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, 'in_flight')
              const accepted = await client.submitDelivery({
                deliveryKey: record.deliveryKey, requestId: record.requestId, operatorId: record.operatorId,
                prompt: record.prompt, sessionId: record.sessionId,
              })
              await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, 'in_flight', accepted.sessionId)
            }
            const result = await client.getDelivery(record.deliveryKey)
            const outcome = result.reconciliation
            if (outcome.state === 'completed') {
              if (outcome.resultText !== null && Buffer.byteLength(outcome.resultText, 'utf8') > this.config.maxReplyBytes) throw new Error('Reply exceeds configured byte limit')
              await this.ingressStorage.completeWithReply(record.deliveryKey, outcome.sessionId, outcome.resultText)
            } else if (outcome.state === 'failed' || outcome.state === 'cancelled') {
              await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, 'failed', outcome.sessionId)
            } else if (outcome.state !== 'admitted') {
              await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, 'unknown')
            }
          } catch (error) {
            await this.ingressStorage.updateDeliveryStatus(record.deliveryKey, error instanceof IpcNotAdmittedError ? 'received' : 'unknown')
            throw error
          }
        }
        const current = this.ingressStorage.getDelivery(record.deliveryKey)
        if (!current) throw new Error('Delivery disappeared under ingress writer')
        if (current.status === 'in_flight' || current.status === 'unknown') {
          blocked.add(conversation)
          occupiedTenants.add(current.targetTenantId)
        }
        if (current.outboxStatus === 'in_flight') {
          await this.ingressStorage.recordOutboxFailure(current.deliveryKey, current.outboxVersion, current.outboxAttempts, 'Previous send attempt has no durable confirmation', true)
        }
        if (current.status === 'completed' && current.outboxStatus === 'pending' && current.outboxReplyText !== null) await this.sendReply(current)
      } catch (error) {
        blocked.add(conversation)
        if (this.ingressStorage.getDelivery(record.deliveryKey)?.status !== 'received') occupiedTenants.add(record.targetTenantId)
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'One or more tenant deliveries could not be dispatched')
  }

  private async sendReply(record: IngressDeliveryRecord): Promise<void> {
    if (this.closed || !this.bindingFor(record.deliveryKey)) return
    if (record.outboxAttempts >= this.config.maxOutboxAttempts) throw new Error('Outbox retry budget exhausted')
    const attempt = await this.ingressStorage.recordOutboxAttempt(record.deliveryKey, record.outboxVersion)
    try {
      if (attempt.replyRoute && attempt.replyRoute.expiresAt <= Date.now()) {
        await this.ingressStorage.recordOutboxFailure(record.deliveryKey, attempt.outboxVersion, attempt.outboxAttempts, 'Reply capability expired before dispatch', false)
        return
      }
      const sent = await this.replySender.sendReply(attempt)
      await this.ingressStorage.recordOutboxSuccess(record.deliveryKey, attempt.outboxVersion, attempt.outboxAttempts, sent.messageId)
    } catch (error) {
      const status = z.object({ status: z.literal('failed') }).safeParse(error)
      await this.ingressStorage.recordOutboxFailure(record.deliveryKey, attempt.outboxVersion, attempt.outboxAttempts,
        'External reply was not confirmed', !status.success)
    }
  }

  private identity(key: string): ['feishu' | 'dingtalk', string, string, string, string, string] {
    return z.tuple([z.enum(['feishu', 'dingtalk']), z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]).parse(JSON.parse(key))
  }

  private bindingFor(key: string): OperatorBindingRecord | undefined {
    const [provider, app, tenant, chat, sender] = this.identity(key)
    return this.ingressStorage.findActiveBinding(provider, app, tenant, chat, sender)
  }

  /**
   * Serialize live binding administration and card decisions at one ingress authority.
   * @param deliveryKey - Canonical identity selected from a stored delivery.
   * @param operation - Bounded work authorized for the current binding.
   * @returns Operation result; queued revocation takes effect before subsequent decisions.
   */
  withAuthorizedBinding<T>(deliveryKey: string, operation: (binding: OperatorBindingRecord) => Promise<T>): Promise<T> {
    return this.bindingOperation(async () => {
      const binding = this.bindingFor(deliveryKey)
      if (!binding) throw new OperatorBindingUnavailableError('Operator binding is unavailable')
      return operation(binding)
    })
  }

  /**
   * Revoke through this method, rather than directly editing the live backing domain.
   * @param bindingKey - Administrator-selected binding key.
   * @returns Durable revocation; active-delivery cancellation failures propagate without undoing revocation.
   */
  revokeBinding(bindingKey: string): Promise<void> {
    return this.bindingOperation(async () => {
      const binding = this.ingressStorage.getBinding(bindingKey)
      if (!binding) throw new Error('Unknown binding')
      await this.ingressStorage.revokeBinding(bindingKey)
      for (const delivery of this.ingressStorage.listDeliveries()) {
        const identity = this.identity(delivery.deliveryKey)
        if (JSON.stringify(identity.slice(0, 5)) !== bindingKey) continue
        if (delivery.status === 'in_flight' || delivery.status === 'unknown') {
          const client = await this.clientProvider.getClient(parseTargetTenantId(binding.targetTenantId))
          await client.cancelDelivery(delivery.deliveryKey)
        }
      }
    })
  }

  private bindingOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.pendingBindingOperations >= this.config.maxPendingAdmissions) {
      return Promise.reject(new Error('Binding operation admission is closed or full'))
    }
    this.pendingBindingOperations++
    const result = this.bindingTail.then(() => {
      if (this.closed) throw new Error('Binding operations are closed')
      return operation()
    })
    this.bindingTail = result.then(() => undefined, () => undefined)
    void result.then(() => { this.pendingBindingOperations-- }, () => { this.pendingBindingOperations-- })
    return result
  }

  /**
   * Stop accepting messages and await the owned admission queue and dispatcher.
   * @returns Completion after owned work stops; child deadlines belong to their providers.
   */
  async close(): Promise<void> {
    this.closed = true
    await this.admissionTail
    await this.bindingTail
    await this.pumping
  }
}
