import { describe, expect, it, vi } from 'vitest'
import { RpcId } from '@deepseek-ai/dsh-client-connection'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { Context } from '@deepseek-ai/cordis'
import {
  VSCODE_CARRIER_PROTOCOL_VERSION,
  VsCodeStreamId,
  type VsCodeCarrierFrame,
} from '../src/protocol.ts'
import {
  VsCodeHostGateway,
  type HostGatewayOptions,
} from '../src/host-gateway.ts'
import {
  Config as pluginConfig,
  apply as applyPlugin,
  inject as pluginInject,
} from '../src/index.ts'
import type { NodeIpcPort } from '../src/ipc-channel.ts'

const graph: WebBootGraph = {
  rev: 'graph-1',
  entries: [{ id: '@fixture/client', rev: 'bundle-1', url: '/plugins/fixture/client.js?rev=bundle-1' }],
  batches: [{
    phase: 'application',
    url: '/plugins/combo.js',
    rev: 'combo-1',
    entries: ['@fixture/client'],
  }],
}

function hello(overrides: Partial<Extract<VsCodeCarrierFrame, { type: 'control/hello' }>> = {}): VsCodeCarrierFrame {
  return {
    type: 'control/hello',
    protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
    extensionVersion: '0.1.0',
    workspaceRoot: '/workspace',
    locale: 'zh-cn',
    ...overrides,
  }
}

function createHarness(overrides: Partial<HostGatewayOptions> = {}) {
  const sent: VsCodeCarrierFrame[] = []
  const close = vi.fn()
  const openStream = overrides.openStream ?? vi.fn(async () => (async function * () {})())
  const gateway = new VsCodeHostGateway({
    apiFetchHandler: overrides.apiFetchHandler ?? {
      fetch: async () => new Response(JSON.stringify({
        type: 'server-response',
        rpcId: 'rpc-1',
        result: { ok: true, value: { items: [] } },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    },
    openStream,
    clientModules: {
      graph: () => graph,
      clientPath: () => '/artifacts/client.js',
    },
    expectedWorkspaceRoot: '/workspace',
    runtimeVersion: '0.1.2-rc.1',
    maxLogicalRpcBytes: 4096,
    send: async (frame) => { sent.push(frame) },
    close,
    readBundle: async () => new TextEncoder().encode('bundle'),
    sha256: async () => 'a'.repeat(64),
    ...overrides,
  })
  return { close, gateway, sent, openStream }
}

async function ready(harness: ReturnType<typeof createHarness>): Promise<void> {
  await harness.gateway.accept(hello())
  expect(harness.sent[0]?.type).toBe('control/ready')
}

class AutoPort implements NodeIpcPort {
  connected = true
  readonly sent: unknown[] = []
  readonly messages = new Set<(value?: unknown) => void>()
  readonly disconnects = new Set<(value?: unknown) => void>()

  send(value: unknown, callback: (error: Error | null) => void): boolean {
    this.sent.push(value)
    queueMicrotask(() => { callback(null) })
    return true
  }

  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    if (event === 'message') this.messages.add(listener)
    else this.disconnects.add(listener)
  }

  off(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    if (event === 'message') this.messages.delete(listener)
    else this.disconnects.delete(listener)
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    for (const listener of this.disconnects) listener()
  }
}

function pluginContext(): Context {
  const ctx = new Context()
  ctx.provide('connection', {
    createSharedFetchHandler: () => ({
      fetch: async () => new Response('not found', { status: 404 }),
    }),
  } as never)
  ctx.provide('clientModules', {
    graph: () => graph,
    clientPath: () => '/artifacts/client.js',
  } as never)
  ctx.provide('typertGateway', {
    wireStream: { open: async function * () {}, failure: () => ({ code: 'x', message: 'x', details: {} }) },
  } as never)
  return ctx
}

describe('desktop companion handshake and RPC', () => {
  it('declares Connection, modules, and the Typert gateway', () => {
    expect(pluginInject).toEqual(['connection', 'clientModules', 'typertGateway'])
    expect(pluginConfig({ workspaceRoot: '/workspace' })).toMatchObject({
      workspaceRoot: '/workspace',
    })
  })

  it('mounts the Cordis plugin on an injected port and drains it with the fiber', async () => {
    const ctx = pluginContext()
    const port = new AutoPort()
    applyPlugin(ctx, { workspaceRoot: '/workspace', maxLogicalRpcBytes: 4096 }, {
      port,
      runtimeVersion: '0.1.2-rc.1',
    })
    expect(port.disconnects.size).toBe(1)
    await ctx.fiber.dispose()
  })

  it('answers hello with the boot graph and bundle digest', async () => {
    const harness = createHarness()
    await harness.gateway.accept(hello())
    expect(harness.sent[0]).toMatchObject({
      type: 'control/ready',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      runtimeVersion: '0.1.2-rc.1',
      graph,
      bundles: [{
        id: '@fixture/client',
        rev: 'bundle-1',
        sourcePath: '/artifacts/client.js',
        sha256: 'a'.repeat(64),
      }],
    })
  })

  it('rejects a protocol mismatch and a workspace mismatch', async () => {
    const protocol = createHarness()
    await protocol.gateway.accept(hello({ protocolVersion: 1 }))
    expect(protocol.sent[0]).toMatchObject({ type: 'control/error', code: 'protocol-mismatch' })
    expect(protocol.close).toHaveBeenCalledOnce()

    const workspace = createHarness()
    await workspace.gateway.accept(hello({ workspaceRoot: '/other' }))
    expect(workspace.sent[0]).toMatchObject({ type: 'control/error', code: 'workspace-mismatch' })
  })

  it('forwards a unary client-request through the Connection fetch handler', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/api/session.list')
      const body = await request.json() as { rpcId: string }
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { items: [] } },
      }), { status: 200 })
    })
    const harness = createHarness({ apiFetchHandler: { fetch } })
    await ready(harness)
    await harness.gateway.accept({
      type: 'rpc/message',
      message: {
        type: 'client-request',
        rpcId: RpcId('rpc-1'),
        method: 'session.list',
        payload: {},
      },
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(harness.sent[1]).toMatchObject({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: 'rpc-1', result: { ok: true } },
    })
  })

  it('forwards $events/result with a literal dollar so Connection can match the endpoint', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/api/$events/result')
      const body = await request.json() as { rpcId: string }
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: {} },
      }), { status: 200 })
    })
    const harness = createHarness({ apiFetchHandler: { fetch } })
    await ready(harness)
    await harness.gateway.accept({
      type: 'rpc/message',
      message: {
        type: 'client-request',
        rpcId: RpcId('rpc-events'),
        method: '$events/result',
        payload: {},
      },
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(harness.sent[1]).toMatchObject({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: 'rpc-events', result: { ok: true } },
    })
    expect(harness.close).not.toHaveBeenCalled()
  })

  it('returns a failed server-response for HTTP 404 without closing the connection', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname
      if (pathname === '/api/$events/result') {
        return new Response('not found', { status: 404 })
      }
      expect(pathname).toBe('/api/session/cancel')
      const body = await request.json() as { rpcId: string }
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: {} },
      }), { status: 200 })
    })
    const harness = createHarness({ apiFetchHandler: { fetch } })
    await ready(harness)
    await harness.gateway.accept({
      type: 'rpc/message',
      message: {
        type: 'client-request',
        rpcId: RpcId('rpc-events'),
        method: '$events/result',
        payload: {},
      },
    })
    expect(harness.close).not.toHaveBeenCalled()
    expect(harness.sent[1]).toMatchObject({
      type: 'rpc/message',
      message: {
        type: 'server-response',
        rpcId: 'rpc-events',
        result: {
          ok: false,
          error: {
            code: 'gateway/internal',
            message: 'Connection carrier returned HTTP 404 for $events/result',
          },
        },
      },
    })
    await harness.gateway.accept({
      type: 'rpc/message',
      message: {
        type: 'client-request',
        rpcId: RpcId('rpc-cancel'),
        method: 'session/cancel',
        payload: {},
      },
    })
    expect(harness.sent[2]).toMatchObject({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: 'rpc-cancel', result: { ok: true } },
    })
    expect(harness.close).not.toHaveBeenCalled()
  })

  it('pumps a Typert stream and closes it', async () => {
    const openStream = vi.fn(async (_endpoint: string, _payload: unknown, signal: AbortSignal) => (
      async function * () {
        yield { type: 'baseline' }
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
      }
    )())
    const harness = createHarness({ openStream })
    await ready(harness)
    const streamId = VsCodeStreamId('s1')
    await harness.gateway.accept({
      type: 'stream/open',
      streamId,
      endpoint: 'session.control',
      payload: {},
    })
    expect(harness.sent.map(frame => frame.type)).toEqual([
      'control/ready',
      'stream/opened',
      'stream/frame',
    ])
    expect(harness.sent[2]).toMatchObject({ type: 'stream/frame', streamId, value: { type: 'baseline' } })
    await harness.gateway.accept({ type: 'stream/close', streamId })
  })

  it('completes shutdown after hello', async () => {
    const harness = createHarness()
    await ready(harness)
    await harness.gateway.accept({ type: 'control/shutdown' })
    expect(harness.sent.at(-1)).toMatchObject({ type: 'control/shutdown-complete' })
    expect(harness.close).toHaveBeenCalledOnce()
  })
})
