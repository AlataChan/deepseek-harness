/** Durable card publication and callback routing through the active operator binding. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { TargetTenantId } from './types.ts'
import { parseTargetTenantId } from './types.ts'
import type { TenantIpcClient } from './ipc.ts'
import { OperatorBindingUnavailableError, type IngressService } from './ingress.ts'
import type { IngressStorage } from './storage.ts'
import { listInteractionsResponseSchema } from './interaction-protocol.ts'
import { approvalCard, questionCard, parseQuestionForm } from './interaction-cards.ts'

const cardSchema = z.discriminatedUnion('kind', [
  listInteractionsResponseSchema.shape.approvals.element.extend({ kind: z.literal('approval') }),
  listInteractionsResponseSchema.shape.questions.element.extend({ kind: z.literal('question') }),
])
const publishedSchema = z.object({
  actionId: z.uuid(), deliveryKey: z.string().min(1), operatorId: z.string().min(1), targetTenantId: z.string().min(1),
  card: cardSchema, expiresAt: z.number(),
  publication: z.enum(['pending', 'in_flight', 'sent', 'failed', 'unknown']), messageId: z.string().nullable(),
  decision: z.enum(['pending', 'in_flight', 'accepted', 'rejected', 'unknown']),
}).strict()
type PublishedInteraction = z.infer<typeof publishedSchema>
/** Business records contain redacted card content and transport state, never callback tokens. */
export const publishedInteractionDomain = defineDomain({ name: 'im_published_interactions', version: 1,
  tables: { cards: domainTable<string, PublishedInteraction>(publishedSchema) } })
/** Surface-resolved retention, concurrency, byte bounds and locale. */
export const interactionIngressConfigSchema = z.object({
  maxRecords: z.number().int().positive(), maxPendingCallbacks: z.number().int().positive(),
  maxCardBytes: z.number().int().positive(), locale: z.enum(['en', 'zh']),
}).strict()
/** Card ingress limits. */
export type InteractionIngressConfig = z.infer<typeof interactionIngressConfigSchema>
/** Normalized identity must come from the authenticated SDK event, never card action values. */
export interface VerifiedInteractionCallback {
  readonly provider: 'feishu'
  readonly appId: string
  readonly tenantKey: string
  readonly chatId: string
  readonly operatorId: string
  readonly openMessageId: string
  readonly actionTag: string
  readonly actionValue: Record<string, unknown>
  readonly actionName?: string | undefined
  readonly formValue?: Record<string, unknown> | undefined
}

class InteractionUnavailableError extends Error {}

/** Ingress owns publication; tenant runtime owns the live request and the eventual grant. */
export class InteractionIngress {
  private readonly cards: KvTable<string, PublishedInteraction>
  private readonly config: InteractionIngressConfig
  private pumping: Promise<void> | undefined
  private readonly callbacks = new Set<Promise<{ success: boolean }>>()
  private closed = false

  /**
   * @param domain - Exclusive ingress journal under the ingress writer lease.
   * @param config - Validated retention, callback, byte and locale limits.
   * @param storage - Ingress delivery/binding authority.
   * @param ingress - Serializes live binding administration and callback decisions.
   * @param client - Production-authenticated tenant client lookup.
   * @param publish - Official Feishu mutation returning the real accepted message ID.
   */
  constructor(domain: Domain<typeof publishedInteractionDomain>, config: InteractionIngressConfig,
    private readonly storage: IngressStorage, private readonly ingress: IngressService,
    private readonly client: (tenant: TargetTenantId) => Promise<Pick<TenantIpcClient, 'listInteractions' | 'answerInteraction'>>,
    private readonly publish: (chatId: string, card: Record<string, unknown>) => Promise<{ messageId: string }>) {
    this.cards = domain.table('cards')
    this.config = interactionIngressConfigSchema.parse(config)
  }

  /** Run one serialized publication and recovery pass. */
  pollPending(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Interaction ingress is closed'))
    this.pumping ??= this.poll().finally(() => { this.pumping = undefined })
    return this.pumping
  }

  private async poll(): Promise<void> {
    for (const delivery of this.storage.listDeliveries()) {
      if (this.closed) return
      const identity = z.tuple([z.enum(['feishu', 'dingtalk']), z.string(), z.string(), z.string(), z.string(), z.string()])
        .parse(JSON.parse(delivery.deliveryKey))
      if (identity[0] !== 'feishu' || !['in_flight', 'unknown'].includes(delivery.status)) continue
      await this.ingress.withAuthorizedBinding(delivery.deliveryKey, async (binding) => {
        if (binding.operatorId !== delivery.operatorId || binding.targetTenantId !== delivery.targetTenantId) throw new Error('Interaction binding changed')
        const runtime = await this.client(parseTargetTenantId(binding.targetTenantId))
        const pending = await runtime.listInteractions(delivery.deliveryKey, binding.operatorId)
        const cards = [...pending.approvals.map(card => ({ ...card, kind: 'approval' as const })),
          ...pending.questions.map(card => ({ ...card, kind: 'question' as const }))]
        for (const card of cards) {
          if (this.closed || card.expiresAt <= Date.now()) continue
          let record = this.cards.get(card.actionId)
          if (!record) {
            if (Array.from(this.cards.entries()).length >= this.config.maxRecords) throw new Error('Interaction journal retention exhausted')
            record = { actionId: card.actionId, deliveryKey: delivery.deliveryKey, operatorId: binding.operatorId,
              targetTenantId: binding.targetTenantId, card, expiresAt: card.expiresAt,
              publication: 'pending', messageId: null, decision: 'pending' }
            await this.cards.put(card.actionId, record)
          }
          if (record.deliveryKey !== delivery.deliveryKey || record.operatorId !== binding.operatorId
            || JSON.stringify(record.card) !== JSON.stringify(card)) throw new Error('Conflicting interaction identity')
          if (record.publication === 'in_flight') {
            await this.cards.update(record.actionId, current => ({ ...current, publication: 'unknown' }))
            continue
          }
          if (record.publication !== 'pending') continue
          const payload = card.kind === 'approval' ? approvalCard(card, this.config.locale) : questionCard(card, this.config.locale)
          if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > this.config.maxCardBytes) throw new Error('Interaction card exceeds byte limit')
          await this.cards.update(record.actionId, current => ({ ...current, publication: 'in_flight' }))
          try {
            this.assertOpen()
            const sent = await this.publish(identity[3], payload)
            await this.cards.update(record.actionId, current => ({ ...current, publication: 'sent', messageId: sent.messageId }))
          } catch (error) {
            const failed = z.object({ status: z.literal('failed') }).safeParse(error).success
            await this.cards.update(record.actionId, current => ({ ...current, publication: failed ? 'failed' : 'unknown' }))
          }
        }
      })
    }
  }

  /**
   * Route an authenticated callback through the current operator binding.
   * @param action - SDK-authenticated event identity and explicit button/form values.
   * @returns Whether the tenant consumed one exact live request; does not claim execution.
   */
  handleCardAction(action: VerifiedInteractionCallback): Promise<{ success: boolean }> {
    if (this.closed || this.callbacks.size >= this.config.maxPendingCallbacks) return Promise.resolve({ success: false })
    const operation = this.answer(action)
    this.callbacks.add(operation)
    void operation.then(() => this.callbacks.delete(operation), () => this.callbacks.delete(operation))
    return operation
  }

  private async answer(action: VerifiedInteractionCallback): Promise<{ success: boolean }> {
    if (action.actionTag !== 'button') return { success: false }
    const approval = z.object({ actionId: z.uuid(), kind: z.literal('approval'), decision: z.enum(['allow', 'reject']) }).strict()
      .safeParse(action.actionValue)
    const questionId = action.actionName?.startsWith('question_') ? action.actionName.slice('question_'.length) : undefined
    const id = approval.success ? approval.data.actionId : questionId
    if (!id || !z.uuid().safeParse(id).success) return { success: false }
    const record = this.cards.get(id)
    if (!record || record.publication !== 'sent' || record.messageId !== action.openMessageId
      || record.decision !== 'pending' || record.expiresAt <= Date.now()) return { success: false }
    try {
      return await this.ingress.withAuthorizedBinding(record.deliveryKey, async (binding) => {
        if (this.closed) return { success: false }
        if (binding.provider !== action.provider || binding.appId !== action.appId || binding.tenantId !== action.tenantKey
          || binding.chatId !== action.chatId || binding.senderId !== action.operatorId
          || binding.operatorId !== record.operatorId || binding.targetTenantId !== record.targetTenantId) return { success: false }
        const response = record.card.kind === 'approval' && approval.success
          ? { kind: 'approval' as const, decision: approval.data.decision }
          : record.card.kind === 'question' && questionId === id
            ? this.questionResponse(record.card, action.formValue) : null
        if (!response) return { success: false }
        await this.cards.update(id, (current) => {
          if (current.decision !== 'pending' || Date.now() >= current.expiresAt) throw new InteractionUnavailableError('Interaction was consumed or expired')
          return { ...current, decision: 'in_flight' }
        })
        try {
          const runtime = await this.client(parseTargetTenantId(binding.targetTenantId))
          this.assertOpen()
          const result = await runtime.answerInteraction({ deliveryKey: record.deliveryKey, operatorId: binding.operatorId,
            actionId: id, actor: { provider: action.provider, appId: action.appId, tenantId: action.tenantKey,
              chatId: action.chatId, senderId: action.operatorId }, response })
          await this.cards.update(id, current => ({ ...current, decision: result.accepted ? 'accepted' : 'rejected' }))
          return { success: result.accepted }
        } catch (_error) {
          // The remote decision may have committed; never retry it after uncertain acknowledgement.
          await this.cards.update(id, current => ({ ...current, decision: 'unknown' }))
          return { success: false }
        }
      })
    } catch (error) {
      if (error instanceof OperatorBindingUnavailableError || error instanceof InteractionUnavailableError) return { success: false }
      throw error
    }
  }

  private questionResponse(card: Extract<PublishedInteraction['card'], { kind: 'question' }>, input: unknown) {
    try { return { kind: 'question' as const, answer: parseQuestionForm(card, input) } }
    catch (error) {
      // Malformed form fields are deterministic denials; no durable operation runs in this parser.
      if (error instanceof Error) return null
      throw error
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Interaction ingress is closed')
  }

  /** Stop admission and drain all owned publication and callback work. */
  async close(): Promise<void> {
    this.closed = true
    await Promise.all([this.pumping, ...this.callbacks])
  }
}
