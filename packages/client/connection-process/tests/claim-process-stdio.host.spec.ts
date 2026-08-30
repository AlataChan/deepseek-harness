import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { StdioLinePort } from '../src/stdio-line-port.ts'
import {
  claimProcessStdio,
  getClaimedStdioPort,
  resetClaimedStdioForTests,
} from '../src/claim-process-stdio.ts'
import { apply } from '../src/index.ts'
import { VSCODE_CARRIER_PROTOCOL_VERSION, type VsCodeCarrierFrame } from '../src/protocol.ts'
import { VsCodeWireDecoder } from '../src/codec.ts'

function publishClaimedStdio(port: StdioLinePort): void {
  (globalThis as typeof globalThis & { __dshClaimedStdio?: StdioLinePort }).__dshClaimedStdio = port
}

const graph = {
  rev: 'graph-1',
  entries: [{ id: '@fixture/client', rev: 'bundle-1', url: '/plugins/fixture/client.js?rev=bundle-1' }],
  batches: [{
    phase: 'application' as const,
    url: '/plugins/combo.js',
    rev: 'combo-1',
    entries: ['@fixture/client'],
  }],
}

afterEach(() => {
  resetClaimedStdioForTests()
})

describe('claimProcessStdio', () => {
  it('returns one port and routes later stdout.write calls to stderr', async () => {
    const port = claimProcessStdio()
    expect(getClaimedStdioPort()).toBe(port)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((
      _chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      if (typeof encoding === 'function') encoding()
      else callback?.()
      return true
    })
    process.stdout.write('leaked-after-claim')
    await new Promise<void>((resolve, reject) => {
      process.stdout.write('leaked-with-callback', (error) => {
        if (error != null) reject(error)
        else resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      port.send({ type: 'control/hello' }, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })
    expect(stderr.mock.calls.some(call => String(call[0]).includes('leaked-after-claim'))).toBe(true)
    expect(stderr.mock.calls.some(call => String(call[0]).includes('leaked-with-callback'))).toBe(true)
    stderr.mockRestore()
  })

  it('treats reset as a no-op when nothing is claimed', () => {
    resetClaimedStdioForTests()
    expect(getClaimedStdioPort()).toBeUndefined()
  })

  it('reads a claim published only on the process global', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const port = new StdioLinePort({ input, output })
    publishClaimedStdio(port)
    expect(getClaimedStdioPort()).toBe(port)
  })

  it('refuses a second claim when only the process global is set', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    publishClaimedStdio(new StdioLinePort({ input, output }))
    expect(() => claimProcessStdio({ input, output })).toThrow(/already claimed/u)
  })

  it('throws on a second claim in the same process', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    claimProcessStdio({ input, output })
    expect(() => claimProcessStdio({ input, output })).toThrow(/already claimed/u)
  })

  it('lets Host apply use the claimed port instead of ProcessIpcPort', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', (chunk: Buffer) => { chunks.push(chunk.toString('utf8')) })
    claimProcessStdio({ input, output })

    const ctx = new Context()
    ctx.provide('connection', {
      createSharedFetchHandler: () => ({
        fetch: async () => new Response(JSON.stringify({
          type: 'server-response',
          rpcId: 'rpc-1',
          result: { ok: true, value: {} },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
      }),
    })
    ctx.provide('typertGateway', {
      wireStream: { open: async () => (async function * () {})() },
    })
    ctx.provide('clientModules', {
      graph: () => graph,
      clientPath: () => fileURLToPath(import.meta.url),
    })
    apply(ctx, { maxLogicalRpcBytes: 4096, workspaceRoot: '/workspace' }, {
      workspaceRoot: '/workspace',
      runtimeVersion: 'test',
    })

    const hello: VsCodeCarrierFrame = {
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: '1.0.0',
      workspaceRoot: '/workspace',
      locale: 'en',
    }
    input.write(`${JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(hello) })}\n`)

    await vi.waitFor(async () => {
      const decoder = new VsCodeWireDecoder()
      const line = chunks.join('').split('\n').find(value => value.length > 0)
      expect(line).toBeDefined()
      const frame = await decoder.accept(JSON.parse(line as string))
      expect(frame).toMatchObject({ type: 'control/ready', runtimeVersion: 'test' })
    })
  })
})
