import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { ApiProxy, ClientResponse, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ClientBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '@deepseek-ai/dsh-client-connection/body-capacity'
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
import { VsCodeWireDecoder } from '../src/codec.ts'
import type { NodeIpcPort } from '../src/ipc-channel.ts'

const graph: ClientBootGraph = {
  rev: 'graph-1',
  entries: [{ id: '@fixture/client', rev: 'bundle-1', url: '/plugins/fixture/client.js?rev=bundle-1' }],
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

function scriptedApi(): ApiProxy {
  let listFailure = false
  const api = {
    sessions: {
      list: vi.fn(async (request: RpcRequest<{}>) => ({
        rpcId: request.rpcId,
        result: listFailure
          ? { ok: false as const, error: { code: 'internal' as const, message: 'fixture failure', details: {} } }
          : { ok: true as const, value: { items: [] } },
      })),
    },
    events: {
      mux: vi.fn(async function * (
        _request: RpcRequest<{}>, signal: AbortSignal,
      ): AsyncGenerator<RpcRequest<MuxFrame>> {
        yield {
          rpcId: RpcId('mux-frame'),
          payload: { type: 'session/subscribed', sessionId: 'session-1' as never, lastSeq: -1 },
        }
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
      }),
      host: vi.fn(async function * () {
        yield {
          rpcId: RpcId('host-frame'),
          payload: { type: 'host/session-removed', sessionId: 'session-1' as never },
        }
      }),
    },
    respond: vi.fn(async (message: ClientResponse) => (
      message.rpcId === RpcId('pending')
        ? { accepted: true as const }
        : { accepted: false as const, reason: 'not-pending' as const }
    )),
    setListFailure(value: boolean) { listFailure = value },
  }
  return api as unknown as ApiProxy
}

function createHarness(overrides: Partial<HostGatewayOptions> = {}, productionPorts = false) {
  const apiProxy = scriptedApi()
  const sent: VsCodeCarrierFrame[] = []
  const close = vi.fn()
  const fixturePorts = productionPorts ? {} : {
    readBundle: async () => new TextEncoder().encode('bundle'),
    sha256: async () => 'a'.repeat(64),
    createRpcId: () => RpcId('stream-open'),
  }
  const gateway = new VsCodeHostGateway({
    apiProxy,
    clientModules: {
      graph: () => graph,
      bundleRecords: () => [{ entry: graph.entries[0]!, clientPath: '/artifacts/client.js' }],
    },
    imageCapacitySource: { get: () => undefined },
    expectedWorkspaceRoot: '/workspace',
    runtimeVersion: '0.1.0-rc.5',
    maxLogicalRpcBytes: 4096,
    send: async (frame) => { sent.push(frame) },
    close,
    ...fixturePorts,
    ...overrides,
  })
  return { apiProxy, close, gateway, sent }
}

function streamCalls(
  apiProxy: ApiProxy,
  stream: 'host' | 'mux',
): readonly (readonly [RpcRequest<unknown>, AbortSignal])[] {
  const events = apiProxy.events as unknown as Record<
    'host' | 'mux',
    { mock: { calls: readonly (readonly [RpcRequest<unknown>, AbortSignal])[] } }
  >
  return events[stream].mock.calls
}

async function ready(harness: ReturnType<typeof createHarness>): Promise<void> {
  await harness.gateway.accept(hello())
  expect(harness.sent[0]?.type).toBe('control/ready')
}

class AutoPort implements NodeIpcPort {
  connected = true
  readonly sent: unknown[] = []
  readonly messages = new Set<(value: unknown) => void>()
  readonly disconnects = new Set<() => void>()

  send(value: unknown, callback: (error: Error | null) => void): boolean {
    this.sent.push(value)
    queueMicrotask(() => { callback(null) })
    return true
  }

  on(event: 'message' | 'disconnect', listener: ((value: unknown) => void) | (() => void)): void {
    if (event === 'message') this.messages.add(listener)
    else this.disconnects.add(listener as () => void)
  }

  off(event: 'message' | 'disconnect', listener: ((value: unknown) => void) | (() => void)): void {
    if (event === 'message') this.messages.delete(listener)
    else this.disconnects.delete(listener as () => void)
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    for (const listener of this.disconnects) listener()
  }

  emit(frame: VsCodeCarrierFrame): void {
    const record = { type: 'wire/message', encoded: JSON.stringify(frame) }
    for (const listener of this.messages) listener(record)
  }

  emitRaw(value: unknown): void {
    for (const listener of this.messages) listener(value)
  }
}

function pluginContext(): Context {
  const ctx = new Context()
  ctx.provide('apiProxy', scriptedApi())
  ctx.provide('clientModules', {
    graph: () => graph,
    bundleRecords: () => [{ entry: graph.entries[0]!, clientPath: fileURLToPath(import.meta.url) }],
  } as never)
  return ctx
}

describe('VS Code companion handshake and RPC', () => {
  it('mounts the Cordis plugin on an injected port and drains it with the fiber', async () => {
    const port = new AutoPort()
    const ctx = pluginContext()
    const fiber = ctx.plugin({
      inject: [...pluginInject],
      Config: pluginConfig,
      apply(child: Parameters<typeof applyPlugin>[0], config: Parameters<typeof applyPlugin>[1]) {
        applyPlugin(child, config, {
          port, runtimeVersion: '0.1.0-rc.5',
        })
      },
    }, { maxLogicalRpcBytes: 4096, workspaceRoot: '/workspace' })
    await fiber.await()
    port.emit(hello())
    await vi.waitFor(() => { expect(port.sent.length).toBeGreaterThan(0) })
    const decoder = new VsCodeWireDecoder()
    const decoded = await decoder.accept(port.sent[0])
    expect(decoded).toMatchObject({ type: 'control/ready', runtimeVersion: '0.1.0-rc.5' })
    await fiber.dispose()
    expect(port.connected).toBe(false)

    for (const mode of ['failure', 'disconnect'] as const) {
      const terminalPort = new AutoPort()
      const terminalContext = pluginContext()
      const terminalFiber = terminalContext.plugin({
        inject: [...pluginInject],
        apply(child) {
          applyPlugin(child, { maxLogicalRpcBytes: 4096 }, {
            port: terminalPort, workspaceRoot: '/workspace', runtimeVersion: 'v',
          })
        },
      })
      await terminalFiber.await()
      if (mode === 'failure') terminalPort.emitRaw({ type: 'invalid' })
      else terminalPort.disconnect()
      await vi.waitFor(() => { expect(terminalPort.connected).toBe(false) })
      await terminalFiber.dispose()
    }
  })

  it('uses process defaults, rejects a disconnected injected port, and closes after shutdown', async () => {
    const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected')
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
    const on = vi.spyOn(process, 'on').mockImplementation(() => process)
    const off = vi.spyOn(process, 'off').mockImplementation(() => process)
    const disconnect = vi.spyOn(process, 'disconnect').mockImplementation(() => {})
    try {
      Object.defineProperty(process, 'connected', { configurable: true, value: true })
      Object.defineProperty(process, 'send', { configurable: true, value: vi.fn(() => true) })
      const ctx = pluginContext()
      const fiber = ctx.plugin({
        inject: [...pluginInject], Config: pluginConfig, apply: applyPlugin,
      }, {})
      await fiber.await()
      await fiber.dispose()
      expect(on).toHaveBeenCalled()
      expect(off).toHaveBeenCalled()
      expect(disconnect).toHaveBeenCalledOnce()
    } finally {
      on.mockRestore()
      off.mockRestore()
      disconnect.mockRestore()
      if (connectedDescriptor === undefined) delete (process as { connected?: boolean }).connected
      else Object.defineProperty(process, 'connected', connectedDescriptor)
      if (sendDescriptor === undefined) delete (process as { send?: unknown }).send
      else Object.defineProperty(process, 'send', sendDescriptor)
    }

    const disconnected = new AutoPort()
    disconnected.connected = false
    expect(() => { applyPlugin(pluginContext(), { maxLogicalRpcBytes: 4096 }, {
      port: disconnected, workspaceRoot: '/workspace', runtimeVersion: 'v',
    }) }).toThrow(/connected Node IPC/)

    const port = new AutoPort()
    const ctx = pluginContext()
    const fiber = ctx.plugin({
      inject: [...pluginInject],
      apply(child) {
        applyPlugin(child, { maxLogicalRpcBytes: 4096 }, {
          port, workspaceRoot: '/workspace', runtimeVersion: 'v',
        })
      },
    })
    await fiber.await()
    port.emit(hello())
    await vi.waitFor(() => { expect(port.sent.length).toBeGreaterThan(0) })
    port.emit({ type: 'control/shutdown' })
    await vi.waitFor(() => { expect(port.connected).toBe(false) })
    await fiber.dispose()
  })

  it('announces the graph, verified bundle locations, runtime, and logical capacity', async () => {
    const harness = createHarness()
    await ready(harness)
    expect(harness.sent).toEqual([{
      type: 'control/ready',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      runtimeVersion: '0.1.0-rc.5',
      graph,
      bundles: [{
        id: '@fixture/client', rev: 'bundle-1', sourcePath: '/artifacts/client.js', sha256: 'a'.repeat(64),
      }],
      maxLogicalRpcBytes: 4096,
    }])
  })

  it('uses production file, digest, and stream-id ports by default', async () => {
    const sourcePath = fileURLToPath(import.meta.url)
    const expectedDigest = createHash('sha256').update(await import('node:fs/promises').then(fs => fs.readFile(sourcePath))).digest('hex')
    const harness = createHarness({
      clientModules: {
        graph: () => graph,
        bundleRecords: () => [{ entry: graph.entries[0]!, clientPath: sourcePath }],
      },
    }, true)
    await ready(harness)
    expect((harness.sent[0] as Extract<VsCodeCarrierFrame, { type: 'control/ready' }>).bundles[0]?.sha256)
      .toBe(expectedDigest)
    const hostId = VsCodeStreamId('defaults')
    await harness.gateway.accept({ type: 'stream/open', streamId: hostId, stream: 'host', payload: {} })
    await vi.waitFor(() => { expect(streamCalls(harness.apiProxy, 'host')).toHaveLength(1) })
    expect(streamCalls(harness.apiProxy, 'host')[0]?.[0].rpcId).toBeTruthy()
  })

  it('routes unary success and business error through the ApiProxy fetch handler', async () => {
    const harness = createHarness()
    await ready(harness)
    await harness.gateway.accept({
      type: 'rpc/message',
      message: { type: 'client-request', rpcId: RpcId('list-ok'), method: 'session.list', payload: {} },
    })
    expect(harness.sent.at(-1)).toEqual({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: RpcId('list-ok'), result: { ok: true, value: { items: [] } } },
    })

    ;(harness.apiProxy as unknown as { setListFailure(value: boolean): void }).setListFailure(true)
    await harness.gateway.accept({
      type: 'rpc/message',
      message: { type: 'client-request', rpcId: RpcId('list-error'), method: 'session.list', payload: {} },
    })
    expect(harness.sent.at(-1)).toEqual({
      type: 'rpc/message',
      message: {
        type: 'server-response', rpcId: RpcId('list-error'),
        result: { ok: false, error: { code: 'internal', message: 'fixture failure', details: {} } },
      },
    })
  })

  it('routes client responses to ApiProxy and returns correlated receipts', async () => {
    const harness = createHarness()
    await ready(harness)
    await harness.gateway.accept({
      type: 'rpc/message',
      message: { type: 'client-response', rpcId: RpcId('pending'), result: { ok: true, value: {} } },
    })
    expect(harness.sent.at(-1)).toEqual({
      type: 'rpc/receipt', rpcId: RpcId('pending'), receipt: { accepted: true },
    })
  })

  it('rejects missing, incompatible, mismatched, and duplicate handshakes', async () => {
    for (const first of [
      { type: 'control/shutdown' } as VsCodeCarrierFrame,
      hello({ protocolVersion: 999 }),
      hello({ workspaceRoot: '/other' }),
    ]) {
      const harness = createHarness()
      await harness.gateway.accept(first)
      expect(harness.sent[0]).toMatchObject({ type: 'control/error' })
      expect(harness.close).toHaveBeenCalledOnce()
    }

    const duplicate = createHarness()
    await ready(duplicate)
    await duplicate.gateway.accept(hello())
    expect(duplicate.sent.at(-1)).toMatchObject({ type: 'control/error', code: 'unexpected-frame' })
    expect(duplicate.close).toHaveBeenCalledOnce()
  })

  it('fails the handshake when a graph row has no matching bundle revision', async () => {
    for (const records of [
      [],
      [{ entry: { ...graph.entries[0]!, rev: 'other' }, clientPath: '/artifacts/client.js' }],
    ]) {
      const harness = createHarness({
        clientModules: { graph: () => graph, bundleRecords: () => records },
      })
      await harness.gateway.accept(hello())
      expect(harness.sent[0]).toMatchObject({ type: 'control/error', code: 'gateway-failure' })
      expect(harness.close).toHaveBeenCalledOnce()
    }

    const nonError = createHarness({ readBundle: async () => { throw 'plain bundle failure' } })
    await nonError.gateway.accept(hello())
    expect(nonError.sent[0]).toMatchObject({ type: 'control/error', message: 'plain bundle failure' })
  })

  it('fails load when the RPC capacity cannot carry configured aggregate images', () => {
    expect(() => createHarness({
      maxLogicalRpcBytes: DEFAULT_MAX_REQUEST_BODY_BYTES,
      imageCapacitySource: {
        get: () => ({ imageLimits: { maxMessageImageBytes: 100 * 1024 * 1024 } }),
      },
    })).not.toThrow()
    expect(() => createHarness({
      maxLogicalRpcBytes: 100,
      imageCapacitySource: {
        get: () => ({ imageLimits: { maxMessageImageBytes: 100 } }),
      },
    })).toThrow(/request capacity/)
  })

  it('turns an ApiProxy implementation crash into a terminal carrier error', async () => {
    const api = scriptedApi()
    api.sessions.list = async () => { throw new Error('implementation crashed') }
    const harness = createHarness({ apiProxy: api })
    await ready(harness)
    await Promise.all(['crash-1', 'crash-2'].map(rpcId => harness.gateway.accept({
      type: 'rpc/message',
      message: { type: 'client-request', rpcId: RpcId(rpcId), method: 'session.list', payload: {} },
    })))
    expect(harness.sent.at(-1)).toMatchObject({ type: 'control/error', code: 'gateway-failure' })
    expect(harness.close).toHaveBeenCalledOnce()
  })

  it('rejects both downlink RPC quadrants from the extension', async () => {
    for (const message of [{
      type: 'server-request' as const, rpcId: RpcId('server-request'), method: 'fixture', payload: {},
    }, {
      type: 'server-response' as const, rpcId: RpcId('server-response'), result: { ok: true as const, value: {} },
    }]) {
      const harness = createHarness()
      await ready(harness)
      await harness.gateway.accept({ type: 'rpc/message', message })
      expect(harness.sent.at(-1)).toMatchObject({ type: 'control/error', code: 'unexpected-frame' })
    }
  })
})

describe('VS Code companion streams and teardown', () => {
  it('opens mux and Host streams, converts frames, and aborts a client-closed mux', async () => {
    const harness = createHarness()
    await ready(harness)
    const muxId = VsCodeStreamId('mux-1')
    await harness.gateway.accept({ type: 'stream/open', streamId: muxId, stream: 'mux', payload: {} })
    await vi.waitFor(() => {
      expect(harness.sent).toContainEqual({ type: 'stream/opened', streamId: muxId })
      expect(harness.sent).toContainEqual({
        type: 'stream/frame', streamId: muxId,
        message: {
          type: 'server-request', rpcId: RpcId('mux-frame'), method: 'session/subscribed',
          payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: -1 },
        },
      })
    })
    const muxCall = streamCalls(harness.apiProxy, 'mux')[0]
    expect(muxCall?.[1].aborted).toBe(false)
    await harness.gateway.accept({ type: 'stream/close', streamId: muxId })
    expect(muxCall?.[1].aborted).toBe(true)
    expect(harness.sent).toContainEqual({ type: 'stream/end', streamId: muxId })

    const hostId = VsCodeStreamId('host-1')
    await harness.gateway.accept({ type: 'stream/open', streamId: hostId, stream: 'host', payload: {} })
    await vi.waitFor(() => {
      expect(harness.sent).toContainEqual({ type: 'stream/opened', streamId: hostId })
      expect(harness.sent).toContainEqual({ type: 'stream/end', streamId: hostId })
    })
  })

  it('rejects duplicate streams and client-to-server downlink frames', async () => {
    const harness = createHarness()
    await ready(harness)
    const streamId = VsCodeStreamId('mux-1')
    await harness.gateway.accept({ type: 'stream/open', streamId, stream: 'mux', payload: {} })
    await harness.gateway.accept({ type: 'stream/open', streamId, stream: 'mux', payload: {} })
    expect(harness.sent.at(-1)).toEqual({ type: 'stream/error', streamId, message: 'stream already open' })

    await harness.gateway.accept({ type: 'stream/opened', streamId })
    expect(harness.sent.at(-1)).toMatchObject({ type: 'control/error', code: 'unexpected-frame' })
    expect(harness.close).toHaveBeenCalledOnce()
  })

  it('reports stream failures, unknown closes, and waits for disposal quiescence', async () => {
    let release: (() => void) | undefined
    let finalized = false
    const api = scriptedApi()
    api.events.mux = async function * (_request, signal) {
      try {
        await new Promise<void>((resolve) => {
          release = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        throw new Error('stream stopped')
      } finally {
        finalized = true
      }
    }
    const harness = createHarness({ apiProxy: api })
    await ready(harness)
    const unknown = VsCodeStreamId('unknown')
    await harness.gateway.accept({ type: 'stream/close', streamId: unknown })
    expect(harness.sent.at(-1)).toEqual({ type: 'stream/error', streamId: unknown, message: 'stream is not open' })

    const streamId = VsCodeStreamId('slow')
    await harness.gateway.accept({ type: 'stream/open', streamId, stream: 'mux', payload: {} })
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    await harness.gateway.dispose()
    expect(finalized).toBe(true)
    const count = harness.sent.length
    release?.()
    await Promise.resolve()
    expect(harness.sent).toHaveLength(count)

    const throwingApi = scriptedApi()
    throwingApi.events.host = async function * () { throw new Error('host stream failed') }
    const throwing = createHarness({ apiProxy: throwingApi })
    await ready(throwing)
    const hostId = VsCodeStreamId('throwing')
    await throwing.gateway.accept({ type: 'stream/open', streamId: hostId, stream: 'host', payload: {} })
    await vi.waitFor(() => {
      expect(throwing.sent).toContainEqual({ type: 'stream/error', streamId: hostId, message: 'host stream failed' })
    })

    const plainApi = scriptedApi()
    plainApi.events.host = async function * () { throw 'plain stream failure' }
    const plain = createHarness({ apiProxy: plainApi })
    await ready(plain)
    const plainId = VsCodeStreamId('plain')
    await plain.gateway.accept({ type: 'stream/open', streamId: plainId, stream: 'host', payload: {} })
    await vi.waitFor(() => {
      expect(plain.sent).toContainEqual({ type: 'stream/error', streamId: plainId, message: 'plain stream failure' })
    })
  })

  it('suppresses late source frames and failed pump sends after disposal', async () => {
    let release: (() => void) | undefined
    const api = scriptedApi()
    api.events.mux = async function * () {
      await new Promise<void>((resolve) => { release = resolve })
      yield {
        rpcId: RpcId('late'),
        payload: { type: 'session/subscribed', sessionId: 'late' as never, lastSeq: -1 },
      }
    }
    const harness = createHarness({ apiProxy: api })
    await ready(harness)
    const streamId = VsCodeStreamId('late')
    await harness.gateway.accept({ type: 'stream/open', streamId, stream: 'mux', payload: {} })
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    const disposing = harness.gateway.dispose()
    release?.()
    await disposing
    expect(harness.sent.some(frame => frame.type === 'stream/frame' && frame.streamId === streamId)).toBe(false)
    const count = harness.sent.length
    await harness.gateway.accept(hello())
    expect(harness.sent).toHaveLength(count)
    await harness.gateway.dispose()

    let sends = 0
    const failing = createHarness({
      send: async () => {
        sends += 1
        if (sends > 2) throw new Error('IPC failed')
      },
    })
    await failing.gateway.accept(hello())
    expect(sends).toBe(1)
    const failingId = VsCodeStreamId('send-failure')
    await failing.gateway.accept({ type: 'stream/open', streamId: failingId, stream: 'host', payload: {} })
    await vi.waitFor(() => { expect(sends).toBeGreaterThan(3) })
    await Promise.resolve()
    await failing.gateway.dispose()
  })

  it('aborts pumps, sends shutdown completion, and closes after a graceful shutdown', async () => {
    const harness = createHarness()
    await ready(harness)
    const streamId = VsCodeStreamId('mux-1')
    await harness.gateway.accept({ type: 'stream/open', streamId, stream: 'mux', payload: {} })
    await vi.waitFor(() => { expect(streamCalls(harness.apiProxy, 'mux')).toHaveLength(1) })
    await harness.gateway.accept({ type: 'control/shutdown' })
    expect(harness.sent.at(-1)).toEqual({ type: 'control/shutdown-complete' })
    expect(harness.close).toHaveBeenCalledOnce()
    await harness.gateway.dispose()
  })
})
