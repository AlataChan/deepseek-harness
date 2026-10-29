/** Real HTTP failure controls for platform mutation acceptance. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { FeishuOutboundClient } from '../src/feishu-outbound.ts'

async function withPlatformResponse(status: number, body: string, check: (client: FeishuOutboundClient) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url?.includes('/auth/')) {
      response.end(JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 'test-token', expire: 7200 }))
      return
    }
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(body)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test listener')
  const client = new FeishuOutboundClient({ appId: 'fixture', appSecret: 'fixture', timeoutMs: 1000,
    fetchFn: (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init) })
  try { await check(client) } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  }
}

describe('Feishu uncertain send acceptance', () => {
  it.each([
    [200, '{invalid'],
    [200, '{}'],
    [200, '{"code":0,"msg":"ok","data":{}}'],
    [500, '{"code":500,"msg":"server error"}'],
    [408, 'timed out'],
  ])('keeps HTTP %s response %s unknown without retrying', async (status, body) => {
    await withPlatformResponse(status, body, async (client) => {
      await expect(client.sendTextMessage({ chatId: 'chat', text: 'public reply' })).rejects.toMatchObject({ status: 'unknown' })
    })
  })

  it('distinguishes a definite HTTP rejection', async () => {
    await withPlatformResponse(400, 'bad request', async (client) => {
      await expect(client.sendTextMessage({ chatId: 'chat', text: 'reply' })).rejects.toMatchObject({ status: 'failed' })
    })
  })

  it('accepts only a real message ID from a successful response', async () => {
    await withPlatformResponse(200, '{"code":0,"msg":"ok","data":{"message_id":"platform-id"}}', async (client) => {
      await expect(client.sendTextMessage({ chatId: 'chat', text: 'reply' })).resolves.toEqual({ status: 'sent', messageId: 'platform-id' })
    })
  })

  it.each(['http://open.feishu.cn', 'https://localhost', 'https://open.feishu.cn:444', 'https://secret@open.feishu.cn'])('refuses unsafe API origin %s', (domain) => {
    expect(() => new FeishuOutboundClient({ appId: 'app', appSecret: 'secret', domain })).toThrow('official HTTPS origin')
  })
})
