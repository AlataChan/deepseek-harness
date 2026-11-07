/** Real SDK stdio negotiation and tool invocation against a private Unix-socket fixture. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')

test('model adapter advertises eight finite tools and forwards strict JSON without launching a shell', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ops-mcp-'))
  const socket = join(root, 'broker.sock')
  const requests = []
  const server = createServer(connection => {
    let input = ''
    connection.on('data', chunk => {
      input += chunk
      if (!input.includes('\n')) return
      requests.push(JSON.parse(input.split('\n')[0]))
      connection.end(JSON.stringify({ ok: true, result: { fixture: true } }) + '\n')
    })
  })
  await new Promise(resolve => server.listen(socket, resolve))
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../mcp-server.mjs', import.meta.url))], env: { OCTOPUS_OPS_SOCKET: socket }, stderr: 'pipe' })
  const client = new Client({ name: 'acceptance', version: '1.0.0' })
  try {
    await client.connect(transport)
    const list = await client.listTools()
    assert.equal(list.tools.length, 8)
    assert.deepEqual((await client.listResources()).resources, [])
    assert.deepEqual((await client.listResourceTemplates()).resourceTemplates, [])
    assert(!list.tools.some(tool => /shell|exec_command|sudo/.test(tool.name)))
    const response = await client.callTool({ name: 'host_status', arguments: {} })
    assert.equal(JSON.parse(response.content[0].text).fixture, true)
    assert.deepEqual(requests, [{ action: 'host_status', params: {} }])
    const unknown = await client.callTool({ name: 'arbitrary_shell', arguments: {} })
    assert.equal(unknown.isError, true)
    assert.equal(requests.length, 1)
  } finally {
    await client.close()
    await transport.close()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
