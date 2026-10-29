/**
 * Tenant-owned prompt admission and receipt reconciliation. Existing receipts never
 * cause prompt replay, including the receipt-before-log crash window.
 * @module @deepseek-ai/dsh-experimental-im-feishu/runtime-service
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { z } from 'zod'
import { parseOperatorId, type OperatorId, type TargetTenantId } from './types.ts'
import { createImPromptSource } from './source.ts'
import { reconcileDelivery, type TenantReceiptRecord, type TenantReceiptStorage, type SessionLogSnapshot } from './storage.ts'
import { IpcNotAdmittedError } from './ipc.ts'
import type {
  TenantRuntimeIpcHandler, SubmitDeliveryRequest, SubmitDeliveryResponse,
  GetDeliveryRequest, GetDeliveryResponse, CancelDeliveryRequest,
  CancelDeliveryResponse, GetApprovalContextRequest, GetApprovalContextResponse,
} from './ipc.ts'

const identitySchema = z.tuple([
  z.enum(['feishu', 'dingtalk']), z.string().min(1), z.string().min(1),
  z.string().min(1), z.string().min(1), z.string().min(1),
])

/** Tenant-owned session mapping; incoming Session IDs never select an arbitrary session. */
export interface AgentSessionProvider {
  /**
   * Load the persisted conversation mapping, or durably assign it before publishing an Agent.
   * @param conversationKey - Canonical provider/application/organization/chat/sender tuple.
   * @param operatorId - Operator authorized by this runtime's deployment configuration.
   * @param signal - Admission lifetime; stop before publishing when aborted.
   * @returns Owned Agent for this conversation only.
   */
  getOrCreateAgent(conversationKey: string, operatorId: OperatorId, signal: AbortSignal): Promise<Agent>
  /**
   * Resolve only sessions owned by this runtime.
   * @param sessionId - Receipt-bound session identity.
   * @returns Persisted or live session, if owned and present.
   */
  readSessionLog(sessionId: SessionId): Promise<SessionLogSnapshot | undefined>
  /** @returns Completion after flushing all owned sessions; errors propagate. */
  flushSessions(): Promise<void>
}

/** Deployment-resolved runtime limits and operator authorization. */
export interface TenantRuntimeConfig {
  readonly tenantId: TargetTenantId
  readonly operatorIds: readonly OperatorId[]
  readonly shutdownTimeoutMs: number
  readonly maxActiveDeliveries: number
}

/** Race-safe tenant admission using public Agent and Session methods. */
export class TenantRuntimeService implements TenantRuntimeIpcHandler {
  private readonly lifetime = new AbortController()
  private readonly admissions = new Map<string, Promise<SubmitDeliveryResponse>>()
  private readonly activeAgents = new Map<string, Agent>()
  private readonly reservedDeliveries = new Set<string>()
  private readonly completions = new Map<string, Promise<void>>()
  private closing?: Promise<void>
  private backgroundFailure: Error | undefined

  /**
   * @param config - Validated deployment identity, operator allowlist and shutdown deadline.
   * @param receiptStorage - Exclusively owned durable receipt domain.
   * @param agentProvider - Tenant-owned persisted conversation mapping and Agent lifecycle.
   */
  constructor(
    readonly config: TenantRuntimeConfig,
    private readonly receiptStorage: TenantReceiptStorage,
    private readonly agentProvider: AgentSessionProvider,
  ) {
    if (config.operatorIds.length === 0) throw new Error('Runtime requires an operator allowlist')
    if (!Number.isInteger(config.maxActiveDeliveries) || config.maxActiveDeliveries <= 0) throw new Error('Invalid active delivery limit')
    if (!Number.isInteger(config.shutdownTimeoutMs) || config.shutdownTimeoutMs <= 0 || config.shutdownTimeoutMs > 2_147_483_647) {
      throw new Error('Invalid runtime shutdown timeout')
    }
  }

  /**
   * Admit a fresh delivery once. Existing uncertain receipts return unknown without replay.
   * @param request - Validated IPC submission.
   * @returns Admission status correlated with the caller's frame ID.
   */
  async handleSubmitDelivery(request: SubmitDeliveryRequest): Promise<SubmitDeliveryResponse> {
    this.lifetime.signal.throwIfAborted()
    if (this.backgroundFailure) throw new Error('Runtime settlement failed', { cause: this.backgroundFailure })
    const operatorId = parseOperatorId(request.operatorId)
    if (!this.config.operatorIds.includes(operatorId)) throw new Error('Unauthorized runtime operator')
    const identity = identitySchema.parse(JSON.parse(request.deliveryKey))
    if (JSON.stringify(identity) !== request.deliveryKey) throw new Error('Noncanonical delivery key')
    const conversationKey = JSON.stringify(identity.slice(0, 5))
    const previous = this.admissions.get(conversationKey)
    if (previous) await previous.catch(() => undefined)
    this.lifetime.signal.throwIfAborted()
    // Reserve before the first admission await; a queued caller re-enters to observe this reservation.
    if (this.admissions.has(conversationKey)) return this.handleSubmitDelivery(request)
    const pending = this.admit(request, conversationKey, operatorId)
    this.admissions.set(conversationKey, pending)
    try {
      return await pending
    } finally {
      if (this.admissions.get(conversationKey) === pending) this.admissions.delete(conversationKey)
    }
  }

  private async admit(request: SubmitDeliveryRequest, conversationKey: string, operatorId: OperatorId): Promise<SubmitDeliveryResponse> {
    const existing = this.receiptStorage.getReceipt(request.deliveryKey)
    if (existing) {
      if (existing.requestId !== request.requestId || existing.operatorId !== operatorId
        || (request.sessionId !== null && existing.sessionId !== request.sessionId)) {
        throw new Error('Conflicting delivery receipt identity')
      }
      return this.acknowledge(request.id, existing)
    }
    if (this.activeAgents.size + this.reservedDeliveries.size >= this.config.maxActiveDeliveries) {
      throw new IpcNotAdmittedError('Runtime active delivery limit reached')
    }
    this.reservedDeliveries.add(request.deliveryKey)
    try {
      const agent = await this.agentProvider.getOrCreateAgent(conversationKey, operatorId, this.lifetime.signal)
      this.lifetime.signal.throwIfAborted()
      if (request.sessionId !== null && request.sessionId !== agent.session.id) throw new Error('Session is not bound to this conversation')
      if (agent.status !== 'idle' || Array.from(this.activeAgents.values()).includes(agent)) throw new Error('Conversation has an unfinished delivery')
      const receipt = await this.receiptStorage.recordAdmitting({
        deliveryKey: request.deliveryKey, sessionId: agent.session.id,
        requestId: request.requestId, operatorId,
      })
      this.lifetime.signal.throwIfAborted()
      // The receipt is durable before the public inbox call; a failure after this point is uncertain.
      this.activeAgents.set(request.deliveryKey, agent)
      try {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: request.prompt }],
          source: createImPromptSource(brandString<SessionRequestId>(receipt.requestId), request.clientTimeZone),
        }))
      } catch (error) {
        this.activeAgents.delete(request.deliveryKey)
        throw error
      }
      const admitted = this.receiptStorage.markAdmitted(request.deliveryKey)
      const completion = this.finishDelivery(request.deliveryKey, agent, admitted)
      this.completions.set(request.deliveryKey, completion)
      // Keep failures observable through getDelivery and shutdown; never create an unhandled rejection.
      void completion.finally(() => {
        if (this.completions.get(request.deliveryKey) === completion) this.completions.delete(request.deliveryKey)
      }).catch((error: unknown) => {
        this.backgroundFailure ??= error instanceof Error ? error : new Error('Delivery settlement failed', { cause: error })
      })
      await admitted
      return { id: request.id, type: 'submit_delivery_ack', deliveryKey: request.deliveryKey,
        sessionId: agent.session.id, requestId: receipt.requestId, status: 'admitted' }
    } finally {
      this.reservedDeliveries.delete(request.deliveryKey)
    }
  }

  private async finishDelivery(deliveryKey: string, agent: Agent, admitted: Promise<TenantReceiptRecord>): Promise<void> {
    try {
      await admitted
      await agent.whenIdle()
      await this.agentProvider.flushSessions()
      const receipt = this.receiptStorage.getReceipt(deliveryKey)
      const log = await this.agentProvider.readSessionLog(agent.session.id)
      if (!log) throw new Error('Owned Session log is unavailable after durability barrier')
      const result = reconcileDelivery(receipt, log)
      if (result.state === 'completed') await this.receiptStorage.markCompleted(deliveryKey, result.resultText ?? undefined)
      else if (result.state === 'failed') await this.receiptStorage.markFailed(deliveryKey, result.error ?? 'Agent failed')
      else if (result.state === 'cancelled') await this.receiptStorage.markCancelled(deliveryKey)
    } catch (error) {
      agent.cancel({ kind: 'user' })
      await this.bounded(agent.whenIdle())
      throw error
    } finally {
      if (agent.status === 'idle') this.activeAgents.delete(deliveryKey)
    }
  }

  private async acknowledge(id: string, receipt: TenantReceiptRecord): Promise<SubmitDeliveryResponse> {
    await this.agentProvider.flushSessions()
    const session = await this.agentProvider.readSessionLog(SessionId(receipt.sessionId))
    const result = session ? reconcileDelivery(receipt, session) : undefined
    const state = result?.state
    const status = this.activeAgents.has(receipt.deliveryKey) ? 'admitted'
      : state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'admitted' ? state : 'unknown'
    return { id, type: 'submit_delivery_ack', deliveryKey: receipt.deliveryKey,
      sessionId: receipt.sessionId, requestId: receipt.requestId, status }
  }

  /**
   * Resolve the current owned delivery for an exact live Agent instance.
   * @param agent - Calling Agent; a matching Session ID alone is insufficient.
   * @returns Active receipt, or undefined outside this runtime's owned interval.
   */
  ownerOf(agent: Agent): TenantReceiptRecord | undefined {
    if (this.lifetime.signal.aborted) return undefined
    for (const [key, active] of this.activeAgents) {
      if (active === agent) return this.receiptStorage.getReceipt(key)
    }
    return undefined
  }

  /**
   * Query the receipt-bound session; owned live deliveries remain admitted until settlement.
   * @param request - Delivery lookup.
   * @returns Reconciled durable result or explicit uncertainty.
   */
  async handleGetDelivery(request: GetDeliveryRequest): Promise<GetDeliveryResponse> {
    const receipt = this.receiptStorage.getReceipt(request.deliveryKey)
    if (!receipt) return { id: request.id, type: 'get_delivery_ack', deliveryKey: request.deliveryKey, reconciliation: { state: 'not_found' } }
    if (request.sessionId !== undefined && request.sessionId !== receipt.sessionId) throw new Error('Session does not match receipt')
    await this.agentProvider.flushSessions()
    const session = await this.agentProvider.readSessionLog(SessionId(receipt.sessionId))
    const reconciliation = session ? reconcileDelivery(receipt, session) : {
      state: 'unknown' as const, requestId: receipt.requestId, sessionId: receipt.sessionId, reason: 'Receipt-bound session is unavailable',
    }
    if (this.activeAgents.has(request.deliveryKey)) {
      return { id: request.id, type: 'get_delivery_ack', deliveryKey: request.deliveryKey,
        reconciliation: { state: 'admitted', requestId: receipt.requestId, sessionId: receipt.sessionId } }
    }
    return { id: request.id, type: 'get_delivery_ack', deliveryKey: request.deliveryKey, reconciliation }
  }

  /**
   * Cancel only the Agent owned by this delivery and await its settlement.
   * @param request - Receipt-scoped cancellation.
   * @returns Actual settlement; absent and uncertain work is never reported cancelled.
   */
  async handleCancelDelivery(request: CancelDeliveryRequest): Promise<CancelDeliveryResponse> {
    const agent = this.activeAgents.get(request.deliveryKey)
    if (agent) {
      agent.cancel({ kind: 'user' })
      await this.bounded(this.completions.get(request.deliveryKey) ?? agent.whenIdle())
    }
    const result = await this.handleGetDelivery({ id: request.id, type: 'get_delivery', deliveryKey: request.deliveryKey })
    const state = result.reconciliation.state
    return { id: request.id, type: 'cancel_delivery_ack', deliveryKey: request.deliveryKey,
      status: state === 'cancelled' || state === 'completed' || state === 'failed' || state === 'not_found' ? state : 'unknown' }
  }

  /**
   * Phase 2 has no trusted interactive responder; raw tool arguments never cross IPC.
   * @param request - Context request.
   * @returns Explicitly unavailable context.
   */
  handleGetApprovalContext(request: GetApprovalContextRequest): Promise<GetApprovalContextResponse> {
    return Promise.resolve({ id: request.id, type: 'get_approval_context_ack', sessionId: request.sessionId, context: null })
  }

  /**
   * Close admission and cancel owned Agents when the ingress connection ends.
   * @returns Bounded quiescence and persistence of the owned runtime work.
   */
  handleClientDisconnected(): Promise<void> {
    if (this.closing) return this.closing
    this.lifetime.abort(new Error('Ingress disconnected'))
    for (const agent of this.activeAgents.values()) agent.cancel({ kind: 'user' })
    this.closing = this.bounded((async () => {
      const admissions = await Promise.allSettled(this.admissions.values())
      for (const agent of this.activeAgents.values()) agent.cancel({ kind: 'user' })
      const completions = await Promise.allSettled(this.completions.values())
      await this.agentProvider.flushSessions()
      if (this.backgroundFailure !== undefined) throw this.backgroundFailure
      const failure = [...admissions, ...completions].find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw new Error('Runtime work failed during shutdown', { cause: failure.reason })
    })())
    return this.closing
  }

  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() =>{  reject(new Error('Runtime did not become quiescent before deadline')) }, this.config.shutdownTimeoutMs)
      })])
    } finally {
      clearTimeout(timer)
    }
  }
}
