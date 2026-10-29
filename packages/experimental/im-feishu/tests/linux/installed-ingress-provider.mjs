/** Test-only Cordis provider: installed ingress with deterministic external Feishu I/O. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const artifact = process.env.DSH_TEST_ARTIFACT_ROOT
if (!artifact) throw new Error('Missing installed qualification artifact')
const installed = path => pathToFileURL(join(artifact, 'node_modules', path)).href
const { apply: mountIngress } = await import(installed('@deepseek-ai/dsh-experimental-im-feishu/lib/ingress-plugin.js'))
const { TenantIpcClient } = await import(installed('@deepseek-ai/dsh-experimental-im-feishu/lib/index.js'))
const { EventDispatcher } = await import(installed('@larksuiteoapi/node-sdk/lib/index.js'))

export const name = 'installed-ingress-qualification'
export const inject = ['storage']

/** Mount the real ingress; only external SDK socket and HTTP operations are replaced. */
export async function apply(ctx, config) {
  for (const service of ['agents', 'tools', 'llm', 'subprocess']) {
    assert.equal(ctx.get(service), undefined, `Tool-free ingress mounted ${service}`)
  }
  const log = (...values) => process.stderr.write(values.map(String).join(' ') + '\n')
  const dispatcher = new EventDispatcher({ logger: { trace: log, debug: log, info: log, warn: log, error: log } })
  const isFeishu = config.channel.kind === 'feishu'
  let sent = 0
  const fetchFn = async (input, init) => {
    const url = new URL(input)
    assert.equal(init.method, 'POST')
    if (!isFeishu) {
      assert.equal(url.origin, 'https://oapi.dingtalk.com')
      assert.equal(url.pathname, '/robot/sendBySession')
      assert.equal(JSON.parse(init.body).text.content, 'PONG')
      sent++
      process.stdout.write(JSON.stringify({ type: 'sent', count: sent, text: 'PONG' }) + '\n')
      return Response.json({ errcode: 0, errmsg: 'ok' })
    }
    assert.equal(url.origin, 'https://open.feishu.cn')
    if (url.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      return Response.json({ code: 0, msg: 'ok', tenant_access_token: 'synthetic-token', expire: 7200 })
    }
    assert.equal(url.pathname, '/open-apis/im/v1/messages')
    assert.equal(url.searchParams.get('receive_id_type'), 'chat_id')
    const payload = JSON.parse(init.body)
    assert.equal(payload.receive_id, 'synthetic-chat')
    assert.equal(payload.msg_type, 'text')
    assert.equal(JSON.parse(payload.content).text, 'PONG')
    sent++
    process.stdout.write(JSON.stringify({ type: 'sent', count: sent, text: 'PONG' }) + '\n')
    return Response.json({ code: 0, msg: 'ok', data: { message_id: `synthetic-reply-${sent}` } })
  }
  let acknowledge
  let streamClient
  if (!isFeishu) {
    const { DWClient } = await import(installed('dingtalk-stream/dist/index.mjs'))
    streamClient = new DWClient({ clientId: 'synthetic-app', clientSecret: 'synthetic-only', keepAlive: false })
    streamClient.connect = async () => { streamClient.connected = true }
    streamClient.disconnect = () => { streamClient.connected = false }
    streamClient.send = (id, response) => {
      assert.equal(id, 'synthetic-stream-delivery')
      assert.deepEqual(response, { response: {} })
      assert.ok(acknowledge, 'Unexpected SDK acknowledgement')
      acknowledge({ code: 0, msg: 'accepted' })
      acknowledge = undefined
    }
  }
  await mountIngress(ctx, config, {
    clientFactory: (targetTenantId, endpoint) => new TenantIpcClient({ ...endpoint, ingressId: 'installed-ingress', targetTenantId }),
    feishu: {
      fetchFn,
      clientFactory: {
        createEventDispatcher: () => dispatcher,
        createWSClient: () => ({ start: async () => {}, close: () => {}, getConnectionStatus: () => ({ state: 'connected' }) }),
      },
    },
    ...(!isFeishu ? { dingtalk: { fetchFn, clientFactory: { createDWClient: () => streamClient } } } : {}),
  })
  const lines = createInterface({ input: process.stdin })
  let tail = Promise.resolve()
  lines.on('line', line => {
    tail = tail.then(async () => {
      const command = JSON.parse(line)
      assert.equal(command.type, 'deliver')
      assert.equal(typeof command.id, 'string')
      const result = isFeishu ? await dispatcher.invoke({
        schema: '2.0',
        header: { event_id: 'synthetic-event', event_type: 'im.message.receive_v1', create_time: String(Date.now()), app_id: 'synthetic-app', tenant_key: 'synthetic-org' },
        event: {
          sender: { sender_type: 'user', sender_id: { open_id: 'synthetic-user' } },
          message: { message_id: 'synthetic-message', chat_id: 'synthetic-chat', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: 'Reply with exactly the word: PONG. Do not use any tools.' }) },
        },
      }) : await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { acknowledge = undefined; reject(new Error('Installed DingTalk SDK did not ACK durable admission')) }, 5000)
        acknowledge = value => { clearTimeout(timer); resolve(value) }
        streamClient.onDownStream(JSON.stringify({ type: 'CALLBACK',
          headers: { messageId: 'synthetic-stream-delivery', topic: '/v1.0/im/bot/messages/get', contentType: 'application/json' },
          data: JSON.stringify({ conversationId: 'synthetic-chat', conversationType: '1', chatbotUserId: 'synthetic-bot',
            msgId: 'synthetic-event', senderId: 'synthetic-user', senderCorpId: 'synthetic-org',
            sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=synthetic',
            sessionWebhookExpiredTime: Date.now() + 3600000, createAt: Date.now(), msgtype: 'text',
            text: { content: 'Reply with exactly the word: PONG. Do not use any tools.' } }),
        }))
      })
      process.stdout.write(JSON.stringify({ type: 'ack', id: command.id, result, sent }) + '\n')
    }).catch(error => { ctx.logger.error(error); ctx.get('appExit')(1) })
  })
  ctx.effect(() => async () => { lines.close(); await tail }, 'Installed ingress probe input')
  ctx.effect(() => ctx.get('appReady').onReady(() => {
    process.stdout.write(JSON.stringify({ type: 'ready', toolFree: true }) + '\n')
  }), 'Installed ingress probe readiness')
}
