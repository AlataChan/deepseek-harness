/** Live tenant approval requests; only verified, single-use card decisions can grant. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type { ApprovalRequest, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { z } from 'zod'
import { parseOperatorId } from './types.ts'
import { resolveApprovalContext } from './approval-context.ts'
import { sanitizeOutboundText } from './feishu-normalizer.ts'
import { ApprovalActionUnavailableError, ApprovalActionStore, type ApprovalActionRecord, type ApprovalActionActor, type ApprovalActionId } from './approval-actions.ts'
import type { TenantReceiptRecord } from './storage.ts'
import type { TenantRuntimeConfig } from './runtime-service.ts'

/** Public card fields omit tool arguments, paths, and transport capabilities. */
export interface PendingApprovalCard {
  readonly actionId: ApprovalActionId
  readonly deliveryKey: string
  readonly toolName: string
  readonly summary: string | null
  readonly expiresAt: number
  readonly canAllow: boolean
}

interface LiveApproval {
  readonly request: ApprovalRequest
  readonly receipt: TenantReceiptRecord
  readonly record: ApprovalActionRecord
  readonly settle: (outcome: ApprovalOutcome) => void
}

/** Tenant-scoped answerer whose owner lookup must identify the exact Agent. */
export class TenantApprovalBroker {
  private closed = false
  private readonly calls = new Map<SessionId, Map<ToolCallId, SessionEvent>>()
  private readonly overflowed = new Set<SessionId>()
  private readonly pending = new Map<ApprovalActionId, LiveApproval>()
  private readonly creating = new Set<Promise<ApprovalOutcome>>()

  /**
   * @param ctx - Tenant Cordis context; registration is owned by its effect lifetime.
   * @param config - Fixed tenant identity and authorization configuration.
   * @param actions - Exclusively owned durable single-use actions.
   * @param ownerOf - Current runtime delivery owner for the exact calling Agent.
   */
  constructor(private readonly ctx: Context, private readonly config: TenantRuntimeConfig & { readonly maxTrackedCalls: number },
    private readonly actions: ApprovalActionStore, private readonly ownerOf: (agent: Agent) => TenantReceiptRecord | undefined) {
    if (!Number.isInteger(config.maxTrackedCalls) || config.maxTrackedCalls <= 0) throw new Error('Invalid approval call tracking limit')
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') {
        this.calls.delete(session.id)
        this.overflowed.delete(session.id)
        return
      }
      const agent = ctx.agents.get(session.id)
      if (!agent || !this.ownerOf(agent) || this.overflowed.has(session.id)) return
      if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
        const calls = this.calls.get(session.id) ?? new Map<ToolCallId, SessionEvent>()
        if (calls.size >= this.config.maxTrackedCalls) {
          this.calls.delete(session.id)
          this.overflowed.add(session.id)
          return
        }
        calls.set(event.type === 'tool/call' ? event.data.callId : event.data.subCallId, event)
        this.calls.set(session.id, calls)
      } else if (event.type === 'tool/result') {
        this.calls.get(session.id)?.delete(event.data.message.toolCallId)
      } else if (event.type === 'tool/ptc-dispatch') {
        this.calls.get(session.id)?.delete(event.data.subCallId)
      }
    })
    ctx.on('approval/request', (request, next) => {
      const owner = this.ownerOf(request.agent)
      if (!owner) return next()
      const operation = this.request(request, owner)
      this.creating.add(operation)
      void operation.then(() => this.creating.delete(operation), () => this.creating.delete(operation))
      return operation
    })
    ctx.effect(() => () => this.close(), 'IM approval waits')
  }

  private summary(request: ApprovalRequest): string | null {
    const context = resolveApprovalContext(Array.from(this.calls.get(request.agent.session.id)?.values() ?? []), request)
    if (!context) return null
    const view = this.ctx.tools.get(context.name, request.agent)?.presentCall?.(context.arguments)
    if (!view) return null
    // Use the tool-owned presentation title, never rawInput, diffs, or raw arguments.
    return sanitizeOutboundText(view.title)
      .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
      .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|$))/g, '')
  }

  private valid(entry: LiveApproval): boolean {
    const owner = this.ownerOf(entry.request.agent)
    return !this.closed && !entry.request.signal?.aborted && Date.now() < entry.record.expiresAt
      && owner?.deliveryKey === entry.receipt.deliveryKey && owner.requestId === entry.receipt.requestId
      && owner.operatorId === entry.receipt.operatorId && owner.sessionId === entry.receipt.sessionId
  }

  private async request(request: ApprovalRequest, receipt: TenantReceiptRecord): Promise<ApprovalOutcome> {
    if (this.closed || request.signal?.aborted) return 'cancelled'
    const [provider, appId, tenantId, chatId, senderId] = z.tuple([
      z.enum(['feishu', 'dingtalk']), z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1),
    ]).parse(JSON.parse(receipt.deliveryKey))
    const record = await this.actions.create({ operatorId: parseOperatorId(receipt.operatorId),
      targetTenantId: this.config.tenantId, sessionId: request.agent.session.id, requestId: randomUUID(),
      callId: request.callId ?? null, toolName: request.toolName,
      actor: { provider, appId, tenantId, chatId, senderId }, summary: this.summary(request) })
    const completion = Promise.withResolvers<ApprovalOutcome>()
    const entry: LiveApproval = { request, receipt, record, settle: completion.resolve }
    this.pending.set(record.id, entry)
    const abort = () => { completion.resolve('cancelled') }
    const timer = setTimeout(() => { completion.resolve('unavailable') }, Math.max(0, record.expiresAt - Date.now()))
    request.signal?.addEventListener('abort', abort, { once: true })
    if (!this.valid(entry)) abort()
    try { return await completion.promise } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      this.pending.delete(record.id)
      await this.actions.cancel(record.id)
    }
  }

  /**
   * List live approval cards for one authenticated delivery.
   * @param deliveryKey - Current operator-bound delivery.
   * @param operatorId - Administrator-authorized operator identity.
   * @returns Live redacted cards only for that delivery and operator.
   */
  list(deliveryKey: string, operatorId: string): readonly PendingApprovalCard[] {
    return Array.from(this.pending.values()).filter(entry => this.valid(entry)
      && entry.receipt.deliveryKey === deliveryKey && entry.receipt.operatorId === operatorId).map(entry => ({
      actionId: entry.record.id, deliveryKey, toolName: entry.record.toolName, summary: entry.record.summary,
      expiresAt: entry.record.expiresAt, canAllow: entry.record.callId !== null && entry.record.summary !== null,
    }))
  }

  /**
   * Consume one verified decision for the current live approval.
   * @param actionId - Opaque card action identifier.
   * @param actor - Identity established by a verified platform callback and active binding.
   * @param operatorId - Current bound operator, rechecked after durability by the ingress caller.
   * @param decision - Explicit button decision; arbitrary chat text is never accepted here.
   * @returns True only when this exact still-live request accepted the decision.
   */
  async answer(actionId: ApprovalActionId, actor: ApprovalActionActor, operatorId: string, decision: 'allow' | 'reject'): Promise<boolean> {
    const entry = this.pending.get(actionId)
    if (!entry || !this.valid(entry) || entry.receipt.operatorId !== operatorId) return false
    if (decision === 'allow' && this.summary(entry.request) !== entry.record.summary) return false
    try {
      await this.actions.consume(actionId, actor, entry.record, decision)
    } catch (error) {
      if (error instanceof ApprovalActionUnavailableError) return false
      throw error
    }
    if (!this.valid(entry)) return false
    entry.settle(decision === 'allow' ? 'allowed-once' : 'rejected')
    return true
  }

  /** Withdraw all live approval waits and persist cancellation. */
  async close(): Promise<void> {
    this.closed = true
    for (const entry of this.pending.values()) entry.settle('cancelled')
    const results = await Promise.allSettled(this.creating)
    const failures: unknown[] = []
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
    if (failures.length) throw new AggregateError(failures, 'Approval cancellation failed')
    this.calls.clear()
    this.overflowed.clear()
  }
}
