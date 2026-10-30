/** Test-only platform fixture for replaying an existing IM Session through the desktop adapter. */
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import { createDesktopImRuntime } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import type { FeishuEventDispatcherLike } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'

export const name = 'desktop-im-session-replay'
export const inject = ['agents', 'sessions', 'storage', 'sessionPersistence', 'appReady', 'appExit']

/** Replay a recorded human message through the desktop adapter.
 * @param ctx - Shipped headless profile patched by the snapshot owner.
 * @param config - Scenario-owned paths and recorded prompt.
 */
export async function apply(ctx: Context,
  config: { cwd: string; stateDirectory: string; prompt: string; replyFile: string }): Promise<void> {
  const appReady = ctx.get('appReady')
  const appExit = ctx.get('appExit')
  if (!appReady || !appExit) throw new Error('Desktop IM replay requires launcher readiness and exit services')
  let dispatcher: FeishuEventDispatcherLike | undefined
  let connected = false
  let complete: (() => void) | undefined
  const reply = new Promise<void>((resolve) => { complete = resolve })
  let handlers: Record<string, (data: unknown) => Promise<unknown>> = {}
  const runtime = await createDesktopImRuntime(ctx, {
    ...config, provider: 'feishu', appId: 'snapshot-app', appSecret: 'synthetic-only', tenantId: 'snapshot-org',
    chatId: 'snapshot-chat', senderId: 'snapshot-sender', modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    dispatchIntervalMs: 10, shutdownTimeoutMs: 5000, maxReconciliationEvents: 1000,
    ingress: { maxStoredDeliveries: 100, maxPendingAdmissions: 10, maxPromptBytes: 32768, maxReplyBytes: 32768,
      maxEventAgeMs: 300000, maxFutureSkewMs: 30000, maxOutboxAttempts: 3 },
  }, () => { appExit(1) }, { feishu: {
    clientFactory: {
      createWSClient: () => ({ start: async (value) => { dispatcher = value.eventDispatcher; connected = true },
        close: () => { connected = false }, getConnectionStatus: () => ({ state: connected ? 'connected' : 'idle' }) }),
      createEventDispatcher: () => ({ register(value) { handlers = value; return this }, invoke(data) { return handlers['im.message.receive_v1']!(data) } }),
    },
    fetchFn: async (url, init) => {
      if (String(url).includes('tenant_access_token')) return new Response(JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 'synthetic', expire: 3600 }))
      if (typeof init?.body !== 'string') throw new Error('Expected outbound message JSON')
      await writeFile(config.replyFile, init.body)
      complete?.()
      return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { message_id: 'synthetic-reply' } }))
    },
  } })
  ctx.effect(() => () => runtime.close(), 'desktop-im replay runtime')
  ctx.effect(() => appReady.onReady(() => {
    void (async () => {
      await runtime.start()
      if (!dispatcher) throw new Error('Missing fixture dispatcher')
      await dispatcher.invoke({ event_id: 'snapshot-event', event_type: 'im.message.receive_v1',
        create_time: String(Date.now()), app_id: 'snapshot-app', tenant_key: 'snapshot-org',
        sender: { sender_type: 'user', sender_id: { open_id: 'snapshot-sender' } },
        message: { message_id: 'snapshot-message', chat_id: 'snapshot-chat', chat_type: 'p2p', message_type: 'text',
          content: JSON.stringify({ text: config.prompt }) } })
      await reply
      await runtime.close()
      appExit(0)
    })().catch((error: unknown) => { ctx.logger.error('Desktop IM replay failed', error); appExit(1) })
  }), 'desktop-im replay readiness')
}
