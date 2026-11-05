/** Durable publication and callback validation for Session-bound Feishu questions. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TenantReceiptStorage, tenantReceiptDomainSpec, reconcileDelivery } from '@deepseek-ai/dsh-experimental-im-feishu'
import { CardPublishRefusal } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import type { CardChannel, CardChannelBinding, CardConsumer, CardCallbackResult } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import type { NormalizedFeishuCardAction } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import type SessionDecisionsService from '../service.ts'
import type { DecisionId } from '../types.ts'
import { questionCard } from './cards.ts'

/** Existing receipt schema, isolated from ordinary IM conversation receipts. */
export const decisionReceiptDomain = { ...tenantReceiptDomainSpec, name: 'decision_answer_receipts' }
const bindingSchema = z.object({ appId: z.string(), tenantId: z.string(), chatId: z.string(), operatorId: z.string(),
  workspace: z.string(), generation: z.uuid() }).strict()
/** Private publication metadata retained in its question aggregate; no answer body or SDK token. */
export const publicationSchema = z.object({
  publicationId: z.uuid(), decisionId: z.uuid(), revision: z.number().int().nonnegative(),
  sessionId: z.string().min(1), expiresAtUtc: z.iso.datetime(), binding: bindingSchema,
  state: z.enum(['in_flight', 'sent', 'failed', 'unknown']), messageId: z.string().min(1).nullable(),
}).strict()
const clickSchema = z.object({ kind: z.literal('session-question'), publicationId: z.uuid(), decisionId: z.uuid(),
  revision: z.number().int().nonnegative(), choiceOrdinal: z.number().int().positive() }).strict()
function sameBinding(a: z.infer<typeof bindingSchema>, b: z.infer<typeof bindingSchema>): boolean {
  return (['appId', 'tenantId', 'chatId', 'operatorId', 'workspace', 'generation'] as const).every(key => a[key] === b[key])
}
/** Generic desktop capabilities consumed by this feature only. */
export interface QuestionCardOwner {
  cardChannel(): CardChannel | undefined
  registerCardConsumer(kind: string, consumer: CardConsumer): () => void
}
/** Feishu adapter shares the B1 admission owner and never owns asking-Agent handles. */
export class FeishuQuestions {
  private closed = false
  private readonly operations = new Set<Promise<unknown>>()
  private readonly unregister: () => void
  constructor(private readonly ctx: Context, private readonly service: SessionDecisionsService,
    private readonly owner: QuestionCardOwner, private readonly receipts: TenantReceiptStorage,
    private readonly maxEvents: number) {
    this.unregister = owner.registerCardConsumer('session-question', (action, binding) =>
      this.track(this.answer(action, binding)))
  }
  /** Claim publication before dispatch; ambiguous sends are retained and never automatically replayed.
   * @param decisionId - Saved question identity.
   * @returns Completion after one bounded send or a safe no-op when unavailable/already published.
   */
  publish(decisionId: DecisionId): Promise<void> { return this.track(this.publishOne(decisionId)) }
  private async publishOne(decisionId: DecisionId): Promise<void> {
    if (this.closed) return
    const channel = this.owner.cardChannel()
    const view = await this.service.get(decisionId)
    if (!channel || !view || view.choices.length < 2 || view.lifecycle !== 'open'
      || view.suspended || view.answerIndex !== 'none') return
    const agent = this.ctx.agents.get(view.sessionId)
    if (!agent || agent.session.header.origin === 'subagent' || agent.session.header.cwd !== channel.binding.workspace) return
    const pending = publicationSchema.parse({ publicationId: randomUUID(), decisionId, revision: view.revision,
      sessionId: view.sessionId, expiresAtUtc: view.expiresAtUtc, binding: channel.binding, state: 'in_flight', messageId: null })
    if (!await this.service.writeNotification(decisionId, undefined, pending, view.revision)) return
    try {
      if (!this.current(channel.binding) || this.owner.cardChannel() !== channel) throw new Error('Channel generation changed')
      const sent = await channel.publish(questionCard(view, pending.publicationId))
      await this.service.writeNotification(decisionId, pending, { ...pending, state: 'sent', messageId: sent.messageId })
    } catch (error) {
      await this.service.writeNotification(decisionId, pending, { ...pending, state: error instanceof CardPublishRefusal ? 'failed' : 'unknown' })
    }
  }
  private current(binding: CardChannelBinding): boolean {
    const live = this.owner.cardChannel()?.binding
    return !this.closed && live !== undefined && sameBinding(live, binding)
  }
  private async answer(action: NormalizedFeishuCardAction, binding: CardChannelBinding): Promise<CardCallbackResult> {
    const refused = { success: false, toast: '此问题已失效或状态待确认，请回到桌面查看。' }
    const click = clickSchema.safeParse(action.actionValue)
    if (!click.success || !this.current(binding)) return refused
    const id = brandString<DecisionId>(click.data.decisionId)
    const raw = await this.service.notification(id)
    const parsed = publicationSchema.safeParse(raw)
    if (!parsed.success) return refused
    const publication = parsed.data
    if (publication.state !== 'sent' || publication.messageId !== action.openMessageId
      || publication.publicationId !== click.data.publicationId || publication.decisionId !== click.data.decisionId
      || publication.revision !== click.data.revision
      || !sameBinding(publication.binding, binding)
      || action.appId !== binding.appId || action.tenantKey !== binding.tenantId
      || action.chatId !== binding.chatId || action.operatorId !== binding.operatorId) return refused
    const sessionId = brandString<SessionId>(publication.sessionId)
    const agent = this.ctx.agents.get(sessionId)
    const header = agent?.session.header ?? (await this.ctx.sessionPersistence.stat(sessionId))?.header
    const view = await this.service.get(id)
    if (!header || header.origin === 'subagent' || header.cwd !== binding.workspace
      || !view || view.sessionId !== sessionId || click.data.choiceOrdinal > view.choices.length) return refused
    if (Date.parse(publication.expiresAtUtc) <= Date.now() || view.lifecycle !== 'open' && view.answerIndex !== 'admitted'
      || view.suspended) return { ...refused, card: questionCard(view, publication.publicationId, false) }
    const key = JSON.stringify([publication.publicationId, publication.decisionId, publication.revision])
    const payload = { choiceOrdinal: click.data.choiceOrdinal }
    const outcome = await this.service.admitAnswer(id, click.data.revision, payload, async (reserved) => {
      if (!this.current(binding)) throw new Error('Channel was revoked before admission')
      await this.receipts.recordAdmitting({ deliveryKey: key, sessionId: reserved.sessionId,
        requestId: reserved.requestId, operatorId: binding.operatorId })
      if (!this.current(binding)) throw new Error('Channel was revoked during receipt admission')
    })
    const current = await this.service.get(id)
    const card = current === undefined ? {} : { card: questionCard(current, publication.publicationId, false) }
    if (outcome.outcome !== 'accepted' && outcome.outcome !== 'admitted') return { ...refused, ...card }
    await this.reconcile(key, sessionId)
    return { success: true, toast: '回答已受理；执行结果请查看原对话。', ...card }
  }
  private async reconcile(key: string, sessionId: SessionId): Promise<void> {
    const receipt = this.receipts.getReceipt(key)
    if (!receipt) return
    const handle = await this.ctx.sessionPersistence.open(sessionId, 'read')
    try {
      const snapshot = await handle.read(0, this.maxEvents)
      const result = reconcileDelivery(receipt, { id: sessionId, events: snapshot.events })
      if (result.state === 'admitted' || result.state === 'completed') await this.receipts.markAdmitted(key)
    } finally { await handle.close() }
  }
  /** Withdraw the callback consumer and await all owned operations without cancelling Agents.
   * @returns Adapter quiescence.
   */
  async close(): Promise<void> {
    this.closed = true
    this.unregister()
    await Promise.allSettled([...this.operations])
  }
  private async track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    try { return await operation } finally { this.operations.delete(operation) }
  }
}
