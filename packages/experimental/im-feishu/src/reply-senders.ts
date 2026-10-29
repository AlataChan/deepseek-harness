/** Platform-specific senders consume persisted destinations and real transport acceptance. */
import { z } from 'zod'
import type { DingTalkTransport } from '@deepseek-ai/dsh-experimental-im-dingtalk'
import type { FeishuOutboundClient } from './feishu-outbound.ts'
import type { IngressDeliveryRecord } from './storage.ts'
import type { ImReplySender } from './ingress.ts'

class InvalidReplyDestination extends Error {
  readonly status = 'failed'
}
const identitySchema = z.tuple([z.enum(['feishu', 'dingtalk']), z.string().min(1), z.string().min(1),
  z.string().min(1), z.string().min(1), z.string().min(1)])

/** Feishu accepts only its stored private-chat destination and a real returned message ID. */
export class FeishuReplySender implements ImReplySender {
  /** @param client - Actual configured official platform sender. */
  constructor(private readonly client: Pick<FeishuOutboundClient, 'sendTextMessage'>) {}

  async sendReply(record: IngressDeliveryRecord): Promise<{ messageId: string }> {
    const identity = identitySchema.parse(JSON.parse(record.deliveryKey))
    if (identity[0] !== 'feishu' || record.outboxReplyText === null) throw new InvalidReplyDestination('Invalid Feishu reply destination')
    const sent = await this.client.sendTextMessage({ chatId: identity[3], text: record.outboxReplyText })
    return { messageId: sent.messageId }
  }
}

/** DingTalk session-webhook acceptance has no platform message ID; never fabricate one. */
export class DingTalkReplySender implements ImReplySender {
  /** @param client - Actual configured official session-webhook sender. */
  constructor(private readonly client: Pick<DingTalkTransport, 'sendSessionWebhookReply'>) {}

  async sendReply(record: IngressDeliveryRecord): Promise<{ messageId: null }> {
    const identity = identitySchema.parse(JSON.parse(record.deliveryKey))
    if (identity[0] !== 'dingtalk' || !record.replyRoute || record.replyRoute.expiresAt <= Date.now()
      || record.outboxReplyText === null) throw new InvalidReplyDestination('Missing or expired DingTalk reply capability')
    await this.client.sendSessionWebhookReply(record.replyRoute.url, record.outboxReplyText)
    return { messageId: null }
  }
}
