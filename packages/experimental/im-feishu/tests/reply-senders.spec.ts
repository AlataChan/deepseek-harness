/** Persisted destination selection and truthful platform acceptance. */
import { expect, it, vi } from 'vitest'
import { FeishuReplySender, DingTalkReplySender } from '../src/reply-senders.ts'
import { createServiceFixture } from './service-fixture.ts'

it('sends Feishu replies only to their stored chat and preserves the actual accepted ID', async () => {
  const f = await createServiceFixture()
  try {
    const key = JSON.stringify(['feishu', 'app', 'org', 'bound-chat', 'sender', 'event'])
    await f.ingress.recordDeliveryReceived({ deliveryKey: key, operatorId: f.operatorId,
      targetTenantId: f.runtime.config.tenantId, prompt: 'fixture' })
    const record = await f.ingress.completeWithReply(key, 'session', 'final reply')
    const send = vi.fn(async () => ({ messageId: 'platform-message-id', chatId: 'bound-chat', status: 'sent' as const }))
    const sender = new FeishuReplySender({ sendTextMessage: send })
    expect(await sender.sendReply(record)).toEqual({ messageId: 'platform-message-id' })
    expect(send).toHaveBeenCalledExactlyOnceWith({ chatId: 'bound-chat', text: 'final reply' })
    await expect(sender.sendReply({ ...record, deliveryKey: key.replace('feishu', 'dingtalk') })).rejects.toThrow('Invalid')
    expect(send).toHaveBeenCalledTimes(1)
  } finally { await f.close() }
})

it('uses an unexpired persisted DingTalk capability without fabricating a message ID', async () => {
  const f = await createServiceFixture()
  try {
    const key = JSON.stringify(['dingtalk', 'app', 'org', 'bound-chat', 'sender', 'event'])
    const route = { kind: 'dingtalk-session-webhook' as const,
      url: 'https://oapi.dingtalk.com/robot/sendBySession?session=test-only', expiresAt: Date.now() + 60000 }
    await f.ingress.recordDeliveryReceived({ deliveryKey: key, operatorId: f.operatorId,
      targetTenantId: f.runtime.config.tenantId, prompt: 'fixture', replyRoute: route })
    const record = await f.ingress.completeWithReply(key, 'session', 'final reply')
    const send = vi.fn(async () => ({ status: 'sent' as const }))
    const sender = new DingTalkReplySender({ sendSessionWebhookReply: send })
    expect(await sender.sendReply(record)).toEqual({ messageId: null })
    expect(send).toHaveBeenCalledExactlyOnceWith(route.url, 'final reply')
    await expect(sender.sendReply({ ...record, replyRoute: { ...route, expiresAt: Date.now() - 1 } })).rejects.toThrow('expired')
    await expect(sender.sendReply({ ...record, replyRoute: null })).rejects.toThrow('Missing')
    expect(send).toHaveBeenCalledTimes(1)
  } finally { await f.close() }
})
