import { describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createDesktopImRuntime, type DesktopImRuntime } from '../src/desktop.ts'
import type { FeishuEventDispatcherLike, FeishuWSClientLike } from '../src/feishu-transport.ts'
import { DesktopImLease } from '../src/desktop-lease.ts'
import { TOPIC_ROBOT, type DWClientLike, type DingTalkDownStream, type DingTalkCallbackAck } from '@deepseek-ai/dsh-experimental-im-dingtalk'

class FixtureModel extends LlmAdapter {
  calls = 0
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Desktop IM reply' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Desktop IM reply' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
class Dispatcher implements FeishuEventDispatcherLike {
  handlers: Record<string, (data: unknown) => Promise<unknown>> = {}
  register(handlers: Record<string, (data: unknown) => Promise<unknown>>): this { Object.assign(this.handlers, handlers); return this }
  invoke(data: unknown): Promise<unknown> { return this.handlers['im.message.receive_v1']!(data) }
}
class Socket implements FeishuWSClientLike {
  connected = false
  async start(): Promise<void> { this.connected = true }
  close(): void { this.connected = false }
  getConnectionStatus() { return { state: this.connected ? 'connected' as const : 'idle' as const } }
}
class DingSocket implements DWClientLike {
  connected = false
  listener: ((frame: DingTalkDownStream) => Promise<DingTalkCallbackAck>) | undefined
  registerCallbackListener(_topic: string, listener: (frame: DingTalkDownStream) => Promise<DingTalkCallbackAck>): this {
    this.listener = listener
    return this
  }
  socketCallBackResponse(): void {}
  async connect(): Promise<void> { this.connected = true }
  disconnect(): void { this.connected = false }
  async invoke(id: string, sender = 'operator'): Promise<DingTalkCallbackAck> {
    if (!this.listener) throw new Error('Missing DingTalk callback')
    return this.listener({ headers: { messageId: id, topic: TOPIC_ROBOT, contentType: 'application/json' },
      data: JSON.stringify({ conversationId: 'chat', conversationType: '1', chatbotUserId: 'app', msgId: id,
        senderId: sender, senderCorpId: 'org', sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=synthetic',
        sessionWebhookExpiredTime: Date.now() + 3600000, createAt: Date.now(), msgtype: 'text', text: { content: 'Hello desktop' } }) })
  }
}
function event(id: string, sender = 'operator') {
  return { event_id: id, event_type: 'im.message.receive_v1', create_time: String(Date.now()), app_id: 'app', tenant_key: 'org',
    sender: { sender_type: 'user', sender_id: { open_id: sender } },
    message: { message_id: `message-${id}`, chat_id: 'chat', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: 'Hello desktop' }) } }
}

describe('single-user desktop IM delivery', () => {
  it.each(['feishu', 'dingtalk'] as const)('%s uses durable ingress and real Agents, rejects foreign identities and deduplicates retry', async (provider) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-im-delivery-')))
    const ctx = new Context()
    const dispatcher = new Dispatcher(); const socket = new Socket(); const stream = new DingSocket(); const model = new FixtureModel()
    const sent: string[] = []
    let runtime: DesktopImRuntime | undefined
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Storage)
      ctx.llm.registerAdapter(['fixture'], model)
      runtime = await createDesktopImRuntime(ctx, { provider, appId: 'app', appSecret: 'synthetic',
        tenantId: 'org', chatId: 'chat', senderId: 'operator', cwd: root,
        modelSelection: { provider: 'fixture', model: 'fixture' }, stateDirectory: join(root, 'state'),
        dispatchIntervalMs: 10, shutdownTimeoutMs: 5000, maxReconciliationEvents: 1000,
        ingress: { maxStoredDeliveries: 100, maxPendingAdmissions: 10, maxPromptBytes: 32768, maxReplyBytes: 32768, maxEventAgeMs: 300000, maxFutureSkewMs: 30000, maxOutboxAttempts: 3 } }, () => { throw new Error('Unexpected dispatcher failure') }, {
        feishu: { clientFactory: { createWSClient: () => socket, createEventDispatcher: () => dispatcher },
          fetchFn: async (url, init) => {
            if (String(url).includes('tenant_access_token')) return new Response(JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 'synthetic-token', expire: 3600 }))
            if (typeof init?.body !== 'string') throw new Error('Expected JSON text body')
            sent.push(init.body)
            return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { message_id: 'reply-1' } }))
          } },
        dingtalk: { clientFactory: { createDWClient: () => stream }, fetchFn: async (_url, init) => {
          if (typeof init?.body !== 'string') throw new Error('Expected JSON text body')
          sent.push(init.body)
          return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }))
        } },
      })
      expect(() => DesktopImLease.acquire(join(root, 'state'))).toThrow()
      await runtime.start()
      expect(runtime.isConnected()).toBe(true)
      if (provider === 'feishu') await expect(dispatcher.invoke(event('foreign', 'stranger'))).rejects.toThrow('No active operator')
      else await stream.invoke('foreign', 'stranger')
      expect(model.calls).toBe(0)
      const receive = () => provider === 'feishu' ? dispatcher.invoke(event('delivery-1')) : stream.invoke('delivery-1')
      await receive()
      await expect.poll(() => model.calls, { timeout: 1000 }).toBe(1)
      await expect.poll(() => sent.length, { timeout: 1000 }).toBe(1)
      expect(sent[0]).toContain('Desktop IM reply')
      expect(model.calls).toBe(1)
      await receive()
      await runtime.close()
      expect(model.calls).toBe(1)
      expect(socket.connected).toBe(false)
      expect(stream.connected).toBe(false)
      const lease = DesktopImLease.acquire(join(root, 'state')); lease.release()
    } finally { await runtime?.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  }, 15000)
})
