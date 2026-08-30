import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { RpcId } from '@deepseek-ai/dsh-client-connection'
import {
  claimProcessStdio,
  resetClaimedStdioForTests,
  VSCODE_CARRIER_PROTOCOL_VERSION,
} from '@deepseek-ai/dsh-client-connection-process'
import { VsCodeWireDecoder } from '@deepseek-ai/dsh-client-connection-process/codec'
import * as ConnectionDesktop from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  resetClaimedStdioForTests()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const FixtureServices = {
  name: 'desktop-host-fixture',
  apply(ctx: Context) {
    ctx.provide('connection', {
      createSharedFetchHandler: () => ({
        fetch: async () => new Response(JSON.stringify({
          type: 'server-response',
          rpcId: 'rpc-1',
          result: { ok: true, value: { version: 'test' } },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
      }),
    })
    ctx.provide('typertGateway', {
      wireStream: { open: async () => (async function * () {})() },
    })
    ctx.provide('clientModules', {
      graph: () => ({
        rev: 'fixture',
        entries: [],
        batches: [],
      }),
      clientPath: () => undefined,
    })
  },
}

describe('the desktop Host carrier plugin', () => {
  it('mounts over a claimed stdio port and answers hello', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', (chunk: Buffer) => { chunks.push(chunk.toString('utf8')) })
    claimProcessStdio({ input, output })

    root = await mkdtemp(join(tmpdir(), 'dsh-connection-desktop-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: fixture-services',
      "  name: 'desktop-host-fixture'",
      '- id: connection-desktop',
      "  name: '@deepseek-ai/dsh-client-connection-desktop'",
      '  inject: [connection, clientModules, typertGateway]',
      '  config:',
      '    workspaceRoot: /workspace',
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['desktop-host-fixture', FixtureServices],
      ['@deepseek-ai/dsh-client-connection-desktop', ConnectionDesktop],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    const hello = {
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: 'test',
      workspaceRoot: '/workspace',
      locale: 'en',
    }
    input.write(`${JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(hello) })}\n`)

    await vi.waitFor(async () => {
      const readyLine = chunks.join('').split('\n').find(line => line.length > 0)
      expect(readyLine).toBeDefined()
      const ready = await new VsCodeWireDecoder().accept(JSON.parse(readyLine as string))
      expect(ready).toMatchObject({ type: 'control/ready' })
    })

    const rpcId = RpcId('describe-1')
    const request = {
      type: 'rpc/message',
      message: { type: 'client-request', rpcId, method: 'session.list', payload: {} },
    }
    input.write(`${JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(request) })}\n`)

    await vi.waitFor(async () => {
      const lines = chunks.join('').split('\n').filter(line => line.length > 0)
      expect(lines.length).toBeGreaterThan(1)
      const response = await new VsCodeWireDecoder().accept(JSON.parse(lines[1] as string))
      expect(response).toMatchObject({
        type: 'rpc/message',
        message: { type: 'server-response' },
      })
    })
  })
})
