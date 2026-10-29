import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { IngressService, type TenantIpcClientProvider, type ImReplySender, type IngressConfig } from '../src/ingress.ts'
import { encodeOperatorBindingKey } from '../src/storage.ts'
import type { IncomingImMessage } from '../src/types.ts'
import { createServiceFixture } from './service-fixture.ts'

const config = {
  maxStoredDeliveries: 100, maxPendingAdmissions: 32, maxPromptBytes: 1024, maxReplyBytes: 1024,
  maxEventAgeMs: 60_000, maxFutureSkewMs: 1000, maxOutboxAttempts: 1,
}
function event(overrides: Partial<IncomingImMessage> = {}): IncomingImMessage {
  return { provider: 'feishu', appId: 'app', tenantId: 'organization', chatId: 'chat', senderId: 'sender', eventId: randomUUID(),
    messageId: 'message', createTime: Date.now(), chatType: 'p2p', text: 'hello', ...overrides }
}
async function fixture(overrides: Partial<IngressConfig> = {}) {
  const f = await createServiceFixture()
  let connects = 0
  let unavailable = false
  let failOnce = false
  let lostAck = false
  let sends = 0
  let uncertainSend = false
  const provider: TenantIpcClientProvider = {
    async getClient() {
      connects++
      if (unavailable || failOnce) { failOnce = false; throw new Error('tenant unavailable') }
      return {
        async submitDelivery(params) {
          const ack = await f.runtime.handleSubmitDelivery({ ...params, id: randomUUID(), type: 'submit_delivery' })
          if (lostAck) throw new Error('connection lost after submit')
          return ack
        },
        getDelivery: (key, sessionId) => f.runtime.handleGetDelivery({
          id: randomUUID(), type: 'get_delivery', deliveryKey: key, ...(sessionId === undefined ? {} : { sessionId }),
        }),
        cancelDelivery: key => f.runtime.handleCancelDelivery({ id: randomUUID(), type: 'cancel_delivery', deliveryKey: key }),
      }
    },
  }
  const sender: ImReplySender = {
    async sendReply(record) {
      sends++
      expect(record.outboxReplyText).toBe('public final reply')
      if (uncertainSend) throw new Error('send acknowledgement lost')
      return { messageId: 'actual-external-id' }
    },
  }
  const ingress = new IngressService({ ...config, ...overrides }, f.ingress, provider, sender)
  const input = event()
  const bindingKey = encodeOperatorBindingKey('feishu', input.appId, input.tenantId, input.chatId, input.senderId)
  await f.ingress.putBinding({ bindingKey, operatorId: f.operatorId, targetTenantId: 'runtime-a', provider: 'feishu',
    appId: input.appId, tenantId: input.tenantId, chatId: input.chatId, senderId: input.senderId,
    authorizedAt: new Date().toISOString(), revokedAt: null })
  const waitDelivered = async (key: string, status = 'sent') => {
    await vi.waitFor(async () => { await ingress.dispatchPending(); expect(f.ingress.getDelivery(key)?.outboxStatus).toBe(status) })
  }
  return { ...f, input, bindingKey, service: ingress, waitDelivered,
    connects: () => connects, sends: () => sends, failOnce: () => { failOnce = true },
    unavailable: (value: boolean) => { unavailable = value },
    lostAck: () => { lostAck = true }, uncertainSend: () => { uncertainSend = true } }
}

describe('Durable ingress and real tenant integration', () => {
  it('ACKs persistence before IPC and dispatches a retried message exactly once after recovery', async () => {
    const f = await fixture()
    try {
      f.unavailable(true)
      const [first, retry] = await Promise.all([f.service.handleIncomingMessage(f.input), f.service.handleIncomingMessage(f.input)])
      expect(first.requestId).toBe(retry.requestId)
      expect(retry.duplicate).toBe(true)
      expect(f.connects()).toBe(0)
      await expect(f.service.dispatchPending()).rejects.toThrow('could not be dispatched')
      expect(f.ingress.getDelivery(first.deliveryKey)?.status).toBe('received')
      f.unavailable(false)
      await f.waitDelivered(first.deliveryKey)
      expect(f.adapter.calls).toBe(1)
      expect(f.sends()).toBe(1)
      await f.service.dispatchPending()
      expect(f.sends()).toBe(1)
    } finally { await f.service.close(); await f.close() }
  })

  it('refuses payload changes, foreign organization and revoked bindings before model work', async () => {
    const f = await fixture()
    try {
      await f.service.handleIncomingMessage(f.input)
      await expect(f.service.handleIncomingMessage({ ...f.input, text: 'changed' })).rejects.toThrow('Conflicting')
      await expect(f.service.handleIncomingMessage({ ...f.input, tenantId: 'foreign' })).rejects.toThrow('binding')
      await f.service.revokeBinding(f.bindingKey)
      await expect(f.service.handleIncomingMessage(f.input)).rejects.toThrow('binding')
      await f.service.dispatchPending()
      expect(f.adapter.calls).toBe(0)
    } finally { await f.service.close(); await f.close() }
  })

  it('does not ACK a failed durable write', async () => {
    const f = await fixture()
    try {
      vi.spyOn(f.ingress, 'recordDeliveryReceived').mockRejectedValueOnce(new Error('durability unavailable'))
      await expect(f.service.handleIncomingMessage(f.input)).rejects.toThrow('durability')
      expect(f.ingress.listDeliveries()).toHaveLength(0)
      expect(f.connects()).toBe(0)
    } finally { await f.service.close(); await f.close() }
  })

  it('reconciles an uncertain submit without replaying and never retries an uncertain reply', async () => {
    const f = await fixture()
    try {
      const accepted = await f.service.handleIncomingMessage(f.input)
      f.lostAck()
      await expect(f.service.dispatchPending()).rejects.toThrow('could not be dispatched')
      expect(f.ingress.getDelivery(accepted.deliveryKey)?.status).toBe('unknown')
      f.uncertainSend()
      await f.waitDelivered(accepted.deliveryKey, 'unknown')
      expect(f.adapter.calls).toBe(1)
      expect(f.sends()).toBe(1)
      await f.service.dispatchPending()
      expect(f.sends()).toBe(1)
    } finally { await f.service.close(); await f.close() }
  })

  it('keeps provider identities separate and makes progress after another conversation fails', async () => {
    const f = await fixture()
    try {
      const second = event({ provider: 'dingtalk', replyRoute: { kind: 'dingtalk-session-webhook', url: 'https://oapi.dingtalk.com/robot/sendBySession?session=fixture', expiresAt: Date.now() + 60000 } })
      await expect(f.service.handleIncomingMessage(second)).rejects.toThrow('binding')
      const binding = f.ingress.getBinding(f.bindingKey)
      if (!binding) throw new Error('missing fixture binding')
      const bindingKey = encodeOperatorBindingKey('dingtalk', second.appId, second.tenantId, second.chatId, second.senderId)
      await f.ingress.putBinding({ ...binding, provider: 'dingtalk', bindingKey })
      const first = await f.service.handleIncomingMessage(f.input)
      const accepted = await f.service.handleIncomingMessage(second)
      expect(first.deliveryKey).not.toBe(accepted.deliveryKey)
      f.failOnce()
      await expect(f.service.dispatchPending()).rejects.toThrow('could not be dispatched')
      expect(f.ingress.getDelivery(first.deliveryKey)?.status).toBe('received')
      await f.waitDelivered(accepted.deliveryKey)
      await f.waitDelivered(first.deliveryKey)
      expect(f.handles.size).toBe(2)
    } finally { await f.service.close(); await f.close() }
  })

  it('bounds pending admission while durable storage is stalled', async () => {
    const f = await fixture({ maxPendingAdmissions: 1 })
    const gate = Promise.withResolvers<undefined>()
    const original = f.ingress.recordDeliveryReceived.bind(f.ingress)
    const write = vi.spyOn(f.ingress, 'recordDeliveryReceived').mockImplementation(async (params) => {
      await gate.promise
      return original(params)
    })
    let first: Promise<unknown> | undefined
    try {
      first = f.service.handleIncomingMessage(f.input)
      await vi.waitFor(() => { expect(write).toHaveBeenCalledOnce() })
      await expect(f.service.handleIncomingMessage(event())).rejects.toThrow('pending admission limit')
      gate.resolve(undefined)
      await first
    } finally {
      gate.resolve(undefined)
      await first
      await f.service.close()
      await f.close()
    }
  })

  it('rejects oversized multibyte and future-dated input before writing', async () => {
    const f = await fixture()
    try {
      await expect(f.service.handleIncomingMessage({ ...f.input, text: '汉'.repeat(400) })).rejects.toThrow('oversized')
      await expect(f.service.handleIncomingMessage({ ...f.input, createTime: Date.now() + 10_000 })).rejects.toThrow('window')
      expect(f.ingress.listDeliveries()).toHaveLength(0)
    } finally { await f.service.close(); await f.close() }
  })
  it('orders binding revocation between concurrent card decisions', async () => {
    const f = await fixture()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    try {
      const delivery = await f.service.handleIncomingMessage(f.input)
      const first = f.service.withAuthorizedBinding(delivery.deliveryKey, async () => {
        entered.resolve(undefined)
        await release.promise
        return 'first decision'
      })
      await entered.promise
      const revoked = f.service.revokeBinding(f.bindingKey)
      const later = f.service.withAuthorizedBinding(delivery.deliveryKey, () => Promise.resolve('unsafe decision'))
      const rejected = expect(later).rejects.toThrow('binding is unavailable')
      release.resolve(undefined)
      expect(await first).toBe('first decision')
      await revoked
      await rejected
    } finally { release.resolve(undefined); await f.service.close(); await f.close() }
  })

})
