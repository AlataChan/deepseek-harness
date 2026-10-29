import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { apply as applyIngressPlugin } from '../src/ingress-plugin.ts'
import type { ImReplySender } from '../src/ingress.ts'
import type { IncomingImMessage } from '../src/types.ts'
import { TenantIpcClient } from '../src/ipc.ts'
import { encodeOperatorBindingKey } from '../src/storage.ts'

describe('IngressPlugin (Tool-free ingress service)', () => {
  it('initializes with writer lease, authorizes bindings, and admits inbound messages', async () => {
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-ingress-plugin-state-')))
    await chmod(stateDir, 0o700)

    const ctx = new Context()
    try {
      await ctx.plugin(Storage)

      let replySent = false
      const mockReplySender: ImReplySender = {
        sendReply: () => {
          replySent = true
          return Promise.resolve({ messageId: 'om_12345' })
        },
      }

      const operatorBinding = {
        bindingKey: encodeOperatorBindingKey('feishu', 'app_1', 'tenant_1', 'chat_1', 'user_1'),
        operatorId: 'operator_alice',
        targetTenantId: 'tenant_alpha',
        provider: 'feishu' as const,
        appId: 'app_1',
        tenantId: 'tenant_1',
        chatId: 'chat_1',
        senderId: 'user_1',
        authorizedAt: new Date().toISOString(),
        revokedAt: null,
      }

      await applyIngressPlugin(
        ctx,
        {
          stateDirectory: stateDir,
          tenants: {
            tenant_alpha: {
              socketPath: join(stateDir, 'tenant.sock'),
            },
          },
          operatorBindings: [operatorBinding],
          maxStoredDeliveries: 100,
          maxPendingAdmissions: 10,
          maxPromptBytes: 4096,
          maxReplyBytes: 4096,
          maxEventAgeMs: 60000,
          maxFutureSkewMs: 5000,
          maxOutboxAttempts: 3,
          dispatchIntervalMs: 0, // Manual pumping in test
        },
        {
          replySender: mockReplySender,
          clientFactory: (targetTenantId, endpoint) =>
            new TenantIpcClient({
              socketPath: endpoint.socketPath,
              ingressId: 'ingress-main',
              targetTenantId,
            }),
        },
      )

      const ingress = ctx.imIngress
      expect(Boolean(ingress)).toBe(true)

      // 1. Valid incoming message
      const validMsg: IncomingImMessage = {
        provider: 'feishu',
        appId: 'app_1',
        tenantId: 'tenant_1',
        chatId: 'chat_1',
        senderId: 'user_1',
        eventId: 'evt_1',
        messageId: 'msg_1',
        createTime: Date.now(),
        chatType: 'p2p',
        text: 'Hello coordinator',
      }

      const result1 = await ingress.handleIncomingMessage(validMsg)
      expect(result1.duplicate).toBe(false)
      expect(typeof result1.requestId).toBe('string')

      // 2. Duplicate incoming message
      const result2 = await ingress.handleIncomingMessage(validMsg)
      expect(result2.duplicate).toBe(true)
      expect(result2.requestId).toBe(result1.requestId)

      // 3. Unauthorized sender message is rejected
      const unauthorizedMsg: IncomingImMessage = {
        provider: 'feishu',
        appId: 'app_1',
        tenantId: 'tenant_1',
        chatId: 'chat_1',
        senderId: 'user_unauthorized',
        eventId: 'evt_2',
        messageId: 'msg_2',
        createTime: Date.now(),
        chatType: 'p2p',
        text: 'Unwanted message',
      }
      await expect(ingress.handleIncomingMessage(unauthorizedMsg)).rejects.toThrow(
        /No active operator binding/,
      )

      // Teardown
      await ctx.fiber.dispose()
      expect(replySent).toBe(false) // No reply was pumped in this unit test
    } finally {
      await rm(stateDir, { recursive: true, force: true })
    }
  })
})
