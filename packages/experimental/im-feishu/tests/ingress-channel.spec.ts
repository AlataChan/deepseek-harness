/** Actual ingress composition uses the installed platform dispatcher and durable acceptance. */
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { EventDispatcher } from '@larksuiteoapi/node-sdk'
import { expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { apply } from '../src/ingress-plugin.ts'
import { ImWriterLease } from '../src/writer-lease.ts'
import { TenantIpcClient } from '../src/ipc.ts'
import { encodeOperatorBindingKey } from '../src/storage.ts'
import type { FeishuWSClientLike } from '../src/feishu-transport.ts'

it.skipIf(process.platform === 'win32').each(['connected', 'failed'] as const)(
  'owns a real Feishu callback route and cleans up a %s startup', async (state) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'im-channel-')))
    const ctx = new Context()
    const dispatcher = new EventDispatcher({})
    const socketClose = vi.fn()
    const client: FeishuWSClientLike = {
      start: () => Promise.resolve(), close: socketClose, getConnectionStatus: () => ({ state }),
    }
    const connect = vi.fn(() => new TenantIpcClient(join(directory, 'unused.sock'), 'ingress', 'tenant-a'))
    try {
      await ctx.plugin(Storage)
      provideCmdline(ctx, { args: [], exit: () => { throw new Error('Unexpected process exit') },
        ready: { onReady: () => () => undefined } })
      const start = apply(ctx, {
        stateDirectory: directory, channel: { kind: 'feishu', appId: 'app', appSecret: 'fixture-only' },
        tenants: { 'tenant-a': { socketPath: join(directory, 'unused.sock') } },
        operatorBindings: [{ provider: 'feishu', appId: 'app', tenantId: 'org', chatId: 'chat', senderId: 'sender',
          bindingKey: encodeOperatorBindingKey('feishu', 'app', 'org', 'chat', 'sender'),
          operatorId: 'operator', targetTenantId: 'tenant-a', authorizedAt: new Date().toISOString(), revokedAt: null }],
      }, { clientFactory: connect, feishu: { clientFactory: {
        createWSClient: () => client, createEventDispatcher: () => dispatcher,
      } } })
      if (state === 'failed') {
        await expect(start).rejects.toThrow('failed')
      } else {
        await start
        const acceptance = vi.spyOn(ctx.imIngress, 'handleIncomingMessage')
        const event = { schema: '2.0', header: { event_id: 'event', event_type: 'im.message.receive_v1',
          create_time: String(Date.now()), app_id: 'app', tenant_key: 'org' },
        event: { sender: { sender_type: 'user', sender_id: { open_id: 'sender' } },
          message: { message_id: 'message', chat_id: 'chat', chat_type: 'p2p', message_type: 'text',
            content: JSON.stringify({ text: 'human prompt' }) } } }
        await expect(dispatcher.invoke(event)).resolves.toMatchObject({ code: 0, msg: 'admitted' })
        await expect(dispatcher.invoke(event)).resolves.toMatchObject({ code: 0, msg: 'duplicate_admitted' })
        expect(acceptance).toHaveBeenCalledTimes(2)
        const first = acceptance.mock.settledResults[0]
        const second = acceptance.mock.settledResults[1]
        if (first?.type !== 'fulfilled' || second?.type !== 'fulfilled') throw new Error('Missing durable acceptance')
        expect(first.value.requestId).toBe(second.value.requestId)
        expect(connect).not.toHaveBeenCalled()
      }
      await ctx.fiber.dispose()
      expect(socketClose).toHaveBeenCalled()
      const lease = await ImWriterLease.acquire(directory)
      await lease.release()
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
  },
)
