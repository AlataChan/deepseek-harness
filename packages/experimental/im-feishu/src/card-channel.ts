/** Generic interactive-card ports shared by desktop consumers; no question-feature dependency. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { NormalizedFeishuCardAction } from './feishu-normalizer.ts'

/** Persisted authorization generation; retained only while channel configuration is unchanged. */
export type CardGeneration = Branded<'im-card-generation'>
/** Validates a persisted channel-generation UUID.
 * @param value - Durable UUID field.
 * @returns Branded generation identity.
 */
export function parseCardGeneration(value: string): CardGeneration {
  return brandString<CardGeneration>(z.uuid().parse(value))
}
/** Configured platform identity and canonical local workspace. */
export interface CardChannelBinding {
  readonly appId: string
  readonly tenantId: string
  readonly chatId: string
  readonly operatorId: string
  readonly workspace: string
  readonly generation: CardGeneration
}
/** Callback admission result, distinct from completion of any requested work. */
export interface CardCallbackResult {
  readonly success: boolean
  readonly toast?: string
  /** Optional replacement card after the consumer has authenticated the complete target. */
  readonly card?: Readonly<Record<string, JsonValue>>
}
/** One registered kind receives normalized SDK identity and the server-owned binding. */
export type CardConsumer = (action: NormalizedFeishuCardAction, binding: CardChannelBinding) => Promise<CardCallbackResult>
/** Generic publication/callback capability of the already-owned connection. */
export interface CardChannel {
  readonly binding: CardChannelBinding
  /** Send to the configured chat through the sole connection owner.
   * @param card - JSON card fields.
   * @returns Platform-assigned message identity; thrown send failures may be uncertain.
   */
  publish(card: Readonly<Record<string, JsonValue>>): Promise<{ messageId: string }>
}
/** Publication refused locally before any outbound request was dispatched. */
export class CardPublishRefusal extends Error {}
/** Consumer registry survives connection replacement, without retaining live approval handles. */
export class CardConsumers {
  private readonly handlers = new Map<string, CardConsumer>()
  /** Register one explicit callback kind.
   * @param kind - Consumer-owned action kind.
   * @param handler - Authenticated normalized callback consumer.
   * @returns Registration disposer.
   */
  register(kind: string, handler: CardConsumer): () => void {
    if (this.handlers.has(kind)) throw new Error(`Card kind already registered: ${kind}`)
    this.handlers.set(kind, handler)
    return () => { if (this.handlers.get(kind) === handler) this.handlers.delete(kind) }
  }
  /** Dispatch only a registered action kind.
   * @param action - SDK-normalized button action.
   * @param binding - Current server-owned channel identity.
   * @returns Consumer outcome, or a refusal for an unregistered kind.
   */
  dispatch(action: NormalizedFeishuCardAction, binding: CardChannelBinding): Promise<CardCallbackResult> {
    const kind = action.actionValue.kind
    const handler = typeof kind === 'string' ? this.handlers.get(kind) : undefined
    return handler ? handler(action, binding) : Promise.resolve({ success: false, toast: '此卡片操作不可用。' })
  }
}
/** One runtime generation, owning callback and send drainage but no Agent handles. */
export class OwnedCardChannel implements CardChannel {
  readonly binding: CardChannelBinding
  private closed = false
  private readonly operations = new Set<Promise<unknown>>()
  constructor(binding: CardChannelBinding, private readonly consumers: CardConsumers,
    private readonly send: (card: Readonly<Record<string, JsonValue>>) => Promise<{ messageId: string }>,
    private readonly maxBytes: number) {
    this.binding = Object.freeze({ ...binding })
  }
  /** Publish bounded JSON through the connection's existing outbound transport.
   * @param card - Consumer-built card fields.
   * @returns Platform message identity; never an application-completion claim.
   */
  publish(card: Readonly<Record<string, JsonValue>>): Promise<{ messageId: string }> {
    if (this.closed) return Promise.reject(new CardPublishRefusal('Card channel is closed'))
    if (Buffer.byteLength(JSON.stringify(card), 'utf8') > this.maxBytes) return Promise.reject(new CardPublishRefusal('Card byte limit exceeded'))
    return this.track(Promise.resolve().then(() => this.send(card)))
  }
  /** Refuse foreign identities before dispatching a button through the existing socket.
   * @param action - SDK-normalized identity and action values.
   * @returns Admission outcome for the card toast.
   */
  handleCardAction(action: NormalizedFeishuCardAction): Promise<CardCallbackResult> {
    const b = this.binding
    if (this.closed || action.appId !== b.appId || action.tenantKey !== b.tenantId
      || action.chatId !== b.chatId || action.operatorId !== b.operatorId || action.actionTag !== 'button') {
      return Promise.resolve({ success: false, toast: '此操作已失效或没有权限。' })
    }
    return this.track(Promise.resolve().then(() => this.consumers.dispatch(action, b)))
  }
  /** Close intake synchronously, then await already-admitted sends and callbacks.
   * @returns Quiescence of this connection generation.
   */
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.operations])
  }
  private async track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    try { return await operation } finally { this.operations.delete(operation) }
  }
}
