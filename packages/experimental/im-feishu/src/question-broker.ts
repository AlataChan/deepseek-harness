/** Durable, single-use structured questions for an exact live tenant delivery. */
import { randomUUID } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AskUserQuestionRequest, AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { TenantReceiptRecord } from './storage.ts'
import type { ApprovalActionActor } from './approval-actions.ts'

/** Bounded content validation is completed against deployment limits by the tenant broker. */
export const questionSchema = z.object({
  id: z.string().min(1), question: z.string().min(1), detail: z.string().optional(), header: z.string().optional(),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() }).strict()).optional(),
  multiSelect: z.boolean().optional(),
  intent: z.object({ kind: z.literal('plan-review'), approve: z.string(), callId: z.string().optional() }).optional(),
}).strict()
/** Structured wire answers; validity is checked against the exact pending question. */
export const answerSchema = z.object({ answers: z.array(z.object({
  id: z.string().min(1), selected: z.array(z.string().min(1)), custom: z.string().optional(),
}).strict()) }).strict()
const actorSchema = z.object({ provider: z.enum(['feishu', 'dingtalk']), appId: z.string().min(1), tenantId: z.string().min(1),
  chatId: z.string().min(1), senderId: z.string().min(1) }).strict()
/** Opaque tenant-generated structured-question identity. */
export type QuestionActionId = Branded<'ImQuestionActionId'>
/** Validate an opaque question identity at durable and wire readers. */
export const questionActionIdSchema = z.uuid().transform(value => brandString<QuestionActionId>(value))
const recordSchema = z.object({
  id: questionActionIdSchema, epoch: z.uuid(), deliveryKey: z.string().min(1), operatorId: z.string().min(1),
  sessionId: z.string().min(1), requestId: z.string().min(1), actor: actorSchema,
  questions: z.array(questionSchema), expiresAt: z.number(), state: z.enum(['pending', 'consumed', 'cancelled']),
  answer: answerSchema.nullable(),
}).strict()
type QuestionRecord = z.infer<typeof recordSchema>

/** Unreleased domain records are separate from Session format generations. */
export const questionActionDomain = defineDomain({ name: 'im_question_actions', version: 1,
  tables: { actions: domainTable<string, QuestionRecord>(recordSchema) } })
/** Deployment limits for question storage, display, answers, and lifetime. */
export const questionBrokerConfigSchema = z.object({
  maxRecords: z.number().int().positive(), maxPending: z.number().int().positive(),
  timeoutMs: z.number().int().positive().max(2_147_483_647), maxQuestionBytes: z.number().int().positive(),
  maxAnswerBytes: z.number().int().positive(), maxItems: z.number().int().positive(), maxOptions: z.number().int().positive(),
}).strict()
/** Validated question broker limits. */
export type QuestionBrokerConfig = z.infer<typeof questionBrokerConfigSchema>
/** Card content identifies only a current opaque action, with no execution authority. */
export interface PendingQuestionCard {
  readonly actionId: QuestionActionId
  readonly questions: readonly z.infer<typeof questionSchema>[]
  readonly expiresAt: number
}
interface QuestionWait {
  readonly record: QuestionRecord
  readonly request: AskUserQuestionRequest
  readonly resolve: (answer: AskUserQuestionAnswer) => void
  readonly reject: (error: Error) => void
}

class QuestionActionUnavailableError extends Error {}

/** Tenant answerer; question selections cannot grant a tool approval. */
export class TenantQuestionBroker {
  private readonly epoch = randomUUID()
  private readonly table: KvTable<string, QuestionRecord>
  private readonly config: QuestionBrokerConfig
  private readonly pending = new Map<QuestionActionId, QuestionWait>()
  private readonly work = new Set<Promise<AskUserQuestionAnswer>>()
  private creating = 0
  private closed = false

  /**
   * @param ctx - Tenant Cordis effect owner.
   * @param domain - Exclusive durable domain under the tenant writer lease.
   * @param config - Validated display, retention and expiry limits.
   * @param ownerOf - Exact live Agent ownership lookup.
   */
  constructor(ctx: Context, domain: Domain<typeof questionActionDomain>, config: QuestionBrokerConfig,
    private readonly ownerOf: (agent: Agent) => TenantReceiptRecord | undefined) {
    this.table = domain.table('actions')
    this.config = questionBrokerConfigSchema.parse(config)
    ctx.on('user-questions/request', (request, next) => {
      const owner = request.agent && this.ownerOf(request.agent)
      if (!owner || request.wait?.timed) return next()
      const operation = this.ask(request, owner)
      this.work.add(operation)
      void operation.then(() => this.work.delete(operation), () => this.work.delete(operation))
      return operation
    })
    ctx.effect(() => () => this.close(), 'IM question waits')
  }

  private valid(wait: QuestionWait): boolean {
    const owner = wait.request.agent && this.ownerOf(wait.request.agent)
    return !this.closed && !wait.request.signal?.aborted && Date.now() < wait.record.expiresAt
      && owner?.deliveryKey === wait.record.deliveryKey && owner.requestId === wait.record.requestId
      && owner.sessionId === wait.record.sessionId && owner.operatorId === wait.record.operatorId
  }

  private async ask(request: AskUserQuestionRequest, owner: TenantReceiptRecord): Promise<AskUserQuestionAnswer> {
    const questions = z.array(questionSchema).min(1).max(this.config.maxItems).parse(request.questions)
    if (new Set(questions.map(item => item.id)).size !== questions.length
      || questions.some(item => (item.options?.length ?? 0) > this.config.maxOptions
        || new Set(item.options?.map(option => option.label)).size !== (item.options?.length ?? 0))
      || Buffer.byteLength(JSON.stringify(questions), 'utf8') > this.config.maxQuestionBytes) {
      throw new UserQuestionError('Questions exceed configured bounds or contain duplicate identities', 'BAD_QUESTION')
    }
    if (this.closed || request.signal?.aborted) throw new UserQuestionError('Question cancelled', 'ASK_ABORTED')
    if (Array.from(this.table.entries()).length + this.creating >= this.config.maxRecords
      || this.pending.size + this.creating >= this.config.maxPending) throw new UserQuestionError('Question capacity reached', 'CAPACITY')
    const [provider, appId, tenantId, chatId, senderId] = z.tuple([
      z.enum(['feishu', 'dingtalk']), z.string(), z.string(), z.string(), z.string(), z.string(),
    ]).parse(JSON.parse(owner.deliveryKey))
    const record: QuestionRecord = { id: brandString<QuestionActionId>(randomUUID()), epoch: this.epoch, deliveryKey: owner.deliveryKey,
      operatorId: owner.operatorId, sessionId: owner.sessionId, requestId: owner.requestId,
      actor: { provider, appId, tenantId, chatId, senderId }, questions,
      expiresAt: Date.now() + this.config.timeoutMs, state: 'pending', answer: null }
    this.creating++
    try { await this.table.put(record.id, record) } finally { this.creating-- }
    const completion = Promise.withResolvers<AskUserQuestionAnswer>()
    const wait: QuestionWait = { record, request, resolve: completion.resolve, reject: completion.reject }
    this.pending.set(record.id, wait)
    const abort = () => { completion.reject(new UserQuestionError('Question cancelled', 'ASK_ABORTED')) }
    request.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { completion.reject(new UserQuestionError('Question expired', 'ASK_ABORTED')) },
      Math.max(0, record.expiresAt - Date.now()))
    if (!this.valid(wait)) abort()
    try { return await completion.promise } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      this.pending.delete(record.id)
      await this.table.update(record.id, current => current.state === 'pending' ? { ...current, state: 'cancelled' } : current)
    }
  }

  /**
   * List the current delivery’s pending questions.
   * @param deliveryKey - Active delivery selected by an authorization binding.
   * @param operatorId - Currently authorized operator.
   * @returns Bounded live question cards owned by this delivery.
   */
  list(deliveryKey: string, operatorId: string): readonly PendingQuestionCard[] {
    return Array.from(this.pending.values()).filter(wait => this.valid(wait)
      && wait.record.deliveryKey === deliveryKey && wait.record.operatorId === operatorId).map(wait => ({
      actionId: wait.record.id, questions: wait.record.questions, expiresAt: wait.record.expiresAt,
    }))
  }

  /**
   * Validate and consume one structured answer.
   * @param id - Opaque current question action.
   * @param actor - Platform-authenticated callback identity.
   * @param operatorId - Current administrator binding.
   * @param input - Structured answers from the wire; never a tool-approval outcome.
   * @returns True only after one durable consumption for the exact still-live request.
   */
  async answer(id: QuestionActionId, actor: ApprovalActionActor, operatorId: string, input: unknown): Promise<boolean> {
    const wait = this.pending.get(id)
    if (!wait || !this.valid(wait) || wait.record.operatorId !== operatorId) return false
    const parsed = answerSchema.safeParse(input)
    if (!parsed.success || Buffer.byteLength(JSON.stringify(input), 'utf8') > this.config.maxAnswerBytes) return false
    const answers = parsed.data.answers
    if (new Set(answers.map(item => item.id)).size !== answers.length || answers.length !== wait.record.questions.length) return false
    for (const question of wait.record.questions) {
      const answer = answers.find(item => item.id === question.id)
      if (!answer || new Set(answer.selected).size !== answer.selected.length || (!question.multiSelect && answer.selected.length > 1)
        || answer.selected.some(label => !question.options?.some(option => option.label === label))
        || (!answer.selected.length && !answer.custom?.trim())) return false
    }
    try {
      await this.table.update(id, (current) => {
        if (current.epoch !== this.epoch || current.state !== 'pending' || Date.now() >= current.expiresAt
          || !Object.entries(current.actor).every(([key, value]) => actor[key as keyof ApprovalActionActor] === value)) {
          throw new QuestionActionUnavailableError('Question action unavailable')
        }
        return { ...current, state: 'consumed', answer: parsed.data }
      })
    } catch (error) {
      if (error instanceof QuestionActionUnavailableError) return false
      throw error
    }
    if (!this.valid(wait)) return false
    wait.resolve({ answers: parsed.data.answers.map(item => ({
      id: item.id, selected: item.selected, ...(item.custom !== undefined ? { custom: item.custom } : {}),
    })) })
    return true
  }

  /** Cancel all owned questions and await their durable cancellation. */
  async close(): Promise<void> {
    this.closed = true
    for (const wait of this.pending.values()) wait.reject(new UserQuestionError('Question broker closed', 'ASK_ABORTED'))
    const results = await Promise.allSettled(this.work)
    const unexpected = results.find(result => result.status === 'rejected' && !(result.reason instanceof UserQuestionError))
    if (unexpected?.status === 'rejected') throw new Error('Question cleanup failed', { cause: unexpected.reason })
  }
}
