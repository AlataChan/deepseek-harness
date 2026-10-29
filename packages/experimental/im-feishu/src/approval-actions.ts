/**
 * Durable single-use approval actions. Consuming a record reserves a decision;
 * the caller must recheck the exact live request before granting a tool operation.
 * @module @deepseek-ai/dsh-experimental-im-feishu/approval-actions
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { parseOperatorId, parseTargetTenantId } from './types.ts'

/** Expected denial of an expired, consumed, foreign or unverifiable action. */
export class ApprovalActionUnavailableError extends Error {}

/** Opaque server-generated card action identity. */
export type ApprovalActionId = Branded<'ImApprovalActionId'>

/** Authenticated platform actor, including the application and private conversation namespace. */
const actorSchema = z.object({
  provider: z.enum(['feishu', 'dingtalk']), appId: z.string().min(1), tenantId: z.string().min(1),
  chatId: z.string().min(1), senderId: z.string().min(1),
}).strict()
/** Identity supplied only by a verified platform callback and current binding lookup. */
export type ApprovalActionActor = z.infer<typeof actorSchema>

const actionSchema = z.object({
  id: z.uuid().transform(value => brandString<ApprovalActionId>(value)),
  epoch: z.uuid(),
  operatorId: z.string().min(1).transform(parseOperatorId),
  targetTenantId: z.string().min(1).transform(parseTargetTenantId),
  sessionId: z.string().min(1).transform(SessionId),
  requestId: z.string().min(1),
  callId: z.string().min(1).transform(ToolCallId).nullable(),
  toolName: z.string().min(1), actor: actorSchema,
  summary: z.string().nullable(),
  createdAt: z.number(), expiresAt: z.number(),
  state: z.enum(['pending', 'consumed', 'cancelled']),
  decision: z.enum(['allow', 'reject']).nullable(),
}).strict()

/** Durable action fields contain a redacted summary, never raw tool arguments. */
export type ApprovalActionRecord = z.infer<typeof actionSchema>

/** Unreleased domain version one; storage-sqlite owns the separate physical schema version. */
export const approvalActionDomain = defineDomain({
  name: 'im_approval_actions', version: 1,
  tables: { actions: domainTable<string, ApprovalActionRecord>(actionSchema) },
})

/** Deployment-resolved action capacity, expiry and presentation bounds. */
export const approvalActionConfigSchema = z.object({
  maxRecords: z.number().int().positive(),
  maxPending: z.number().int().positive(),
  timeoutMs: z.number().int().positive().max(2_147_483_647),
  maxSummaryBytes: z.number().int().positive(),
}).strict()
/** Limits validated before accepting any interaction. */
export type ApprovalActionConfig = z.infer<typeof approvalActionConfigSchema>

/** Store owned by one tenant process under its IM writer lease. */
export class ApprovalActionStore {
  private readonly epoch = randomUUID()
  private pendingCreates = 0
  private readonly table: KvTable<string, ApprovalActionRecord>
  private readonly config: ApprovalActionConfig

  /**
   * @param domain - Exclusively owned durable action domain.
   * @param config - Validated action retention, capacity and expiry limits.
   */
  constructor(domain: Domain<typeof approvalActionDomain>, config: ApprovalActionConfig) {
    this.table = domain.table('actions')
    this.config = approvalActionConfigSchema.parse(config)
  }

  /**
   * Persist a card binding only after the runtime has resolved the exact pending tool request.
   * @param input - Trusted request identity and tool-owned redacted summary; absent summary forbids allow.
   * @returns The new durable server-generated action record.
   */
  async create(input: Pick<ApprovalActionRecord,
    'operatorId' | 'targetTenantId' | 'sessionId' | 'requestId' | 'callId' | 'toolName' | 'actor' | 'summary'>): Promise<ApprovalActionRecord> {
    const rows = Array.from(this.table.entries(), ([, record]) => record)
    if (rows.length + this.pendingCreates >= this.config.maxRecords) throw new Error('Approval action retention limit reached')
    if (rows.filter(record => record.state === 'pending' && record.epoch === this.epoch
      && record.expiresAt > Date.now()).length + this.pendingCreates >= this.config.maxPending) {
      throw new Error('Approval action pending limit reached')
    }
    if (input.summary !== null && Buffer.byteLength(input.summary, 'utf8') > this.config.maxSummaryBytes) {
      throw new Error('Approval summary exceeds byte limit')
    }
    const now = Date.now()
    const record: ApprovalActionRecord = {
      ...input, id: brandString<ApprovalActionId>(randomUUID()), epoch: this.epoch,
      createdAt: now, expiresAt: now + this.config.timeoutMs, state: 'pending', decision: null,
    }
    this.pendingCreates++
    try {
      await this.table.put(record.id, record)
      return record
    } finally {
      this.pendingCreates--
    }
  }

  /**
   * Atomically consume one action for its persisted actor and exact live request identity.
   * @param id - Opaque action identifier from a validated callback.
   * @param actor - Platform-authenticated actor, never card-supplied identity fields.
   * @param request - Exact currently pending request resolved in the runtime.
   * @param decision - Explicit button decision; natural language is not accepted.
   * @returns The consumed record; caller must recheck cancellation/revocation after this durability await.
   */
  consume(id: ApprovalActionId, actor: ApprovalActionActor,
    request: Pick<ApprovalActionRecord, 'sessionId' | 'requestId' | 'callId' | 'toolName' | 'operatorId' | 'targetTenantId'>,
    decision: 'allow' | 'reject'): Promise<ApprovalActionRecord> {
    return this.table.update(id, (current) => {
      if (current.epoch !== this.epoch || current.state !== 'pending' || Date.now() >= current.expiresAt
        || current.sessionId !== request.sessionId || current.requestId !== request.requestId
        || current.callId !== request.callId || current.toolName !== request.toolName
        || current.operatorId !== request.operatorId || current.targetTenantId !== request.targetTenantId
        || current.actor.provider !== actor.provider || current.actor.appId !== actor.appId
        || current.actor.tenantId !== actor.tenantId || current.actor.chatId !== actor.chatId
        || current.actor.senderId !== actor.senderId) throw new ApprovalActionUnavailableError('Approval action is unavailable')
      if (decision === 'allow' && (current.callId === null || current.summary === null)) {
        throw new ApprovalActionUnavailableError('Approval arguments are unavailable')
      }
      return { ...current, state: 'consumed', decision }
    })
  }

  /**
   * Withdraw an unconsumed live action before request cancellation or disposal finishes.
   * @param id - Action owned by this process.
   * @returns Durability of the cancelled state; consumed decisions remain consumed.
   */
  async cancel(id: ApprovalActionId): Promise<void> {
    await this.table.update(id, current => current.epoch === this.epoch && current.state === 'pending'
      ? { ...current, state: 'cancelled' }
      : current)
  }
  /**
   * Remove expired records without granting or replaying any request.
   * @returns Number of expired records removed; the live-request owner cancels its own waits separately.
   */
  async pruneExpired(): Promise<number> {
    let removed = 0
    const now = Date.now()
    for (const [id, record] of this.table.entries()) {
      if (record.expiresAt <= now) { await this.table.delete(id); removed++ }
    }
    return removed
  }

}
