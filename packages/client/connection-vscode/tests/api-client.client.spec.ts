/** VS Code Webview API client correlation, stream, and lifecycle behavior. */

import { Binary } from '@deepseek-ai/cosmokit'
import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest, type ClientResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { VsCodeApiClient, type VsCodeApiClientOptions } from '../src/client/api-client.ts'
import {
  VsCodeStreamId,
  WireMessageId,
  type IdeEvent,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '../src/protocol.ts'
import { BridgeHarness } from './bridge-harness.client.ts'

const DESCRIPTION = {
  version: '0.1.0', cwd: '/workspace', attachedSessions: 0, canOpenPath: true,
}

class ExposedClient extends VsCodeApiClient {
  /** Invoke the protected fetch seam with hostile test input. */
  rawFetch(init?: RequestInit): Promise<Response> {
    return this.doFetch(new URL('http://dsh.internal/api/test'), init)
  }
}

class ScriptedIdClient extends VsCodeApiClient {
  /** @param ids - deterministic unary ids returned in order. */
  constructor(port: BridgeHarness, options: VsCodeApiClientOptions, private readonly ids: RpcId[]) {
    super(port, options)
  }

  protected override mintRpcId(): RpcId {
    const id = this.ids.shift()
    if (id === undefined) throw new Error('scripted rpc ids exhausted')
    return id
  }
}

class StickyBridgeHarness extends BridgeHarness {
  /** Keep the listener installed so late shell delivery exercises the client's closed guard. */
  override subscribe(listener: (value: unknown) => void): () => void {
    super.subscribe(listener)
    return () => {}
  }
}

class IdeHarness {
  private readonly listeners = new Set<(event: IdeEvent) => void>()

  /** Subscribe to runtime and editor events. */
  subscribeEvents(listener: (event: IdeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Deliver one parsed IDE event. */
  emit(event: IdeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

class GatedBridgeHarness extends BridgeHarness {
  readonly started = Promise.withResolvers<undefined>()
  readonly release = Promise.withResolvers<undefined>()
  private first = true

  /** Hold the first physical send so a queued frame can cross a runtime generation. */
  override async send(record: VsCodeWireRecord): Promise<void> {
    if (this.first) {
      this.first = false
      this.started.resolve(undefined)
      await this.release.promise
    }
    await super.send(record)
  }
}

function requestOf(frame: VsCodeCarrierFrame): ClientRequest | ClientResponse | undefined {
  return frame.type === 'rpc/message'
    && (frame.message.type === 'client-request' || frame.message.type === 'client-response')
    ? frame.message
    : undefined
}

describe('VsCodeApiClient', () => {
  it('sends Host interception candidates as ordinary unchanged ClientRequest frames', async () => {
    const port = new BridgeHarness()
    port.onFrame = async (frame) => {
      const request = requestOf(frame)
      if (request?.type !== 'client-request') return
      const value = request.method === 'host.describe' ? DESCRIPTION : { opened: true }
      await port.receive({
        type: 'rpc/message',
        message: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } },
      })
    }
    const client = new VsCodeApiClient(port, { responseTimeoutMs: 100 })
    await expect(client.host.describe({})).resolves.toMatchObject({ result: { ok: true } })
    await expect(client.host.openPath({ path: '/workspace/a.ts:7:2' })).resolves.toMatchObject({
      result: { ok: true, value: { opened: true } },
    })
    expect(port.sent.map(requestOf)).toEqual([
      expect.objectContaining({ type: 'client-request', method: 'host.describe', payload: {} }),
      expect.objectContaining({
        type: 'client-request', method: 'host.openPath', payload: { path: '/workspace/a.ts:7:2' },
      }),
    ])
    client.dispose()
  })

  it('correlates unary responses and respond receipts through one bounded bridge', async () => {
    const port = new BridgeHarness()
    port.onFrame = async (frame) => {
      const request = requestOf(frame)
      if (request?.type === 'client-request') {
        await port.receive({
          type: 'rpc/message',
          message: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: DESCRIPTION } },
        })
      } else if (request?.type === 'client-response') {
        await port.receive({
          type: 'rpc/receipt', rpcId: request.rpcId, receipt: { accepted: true },
        })
      }
    }
    const client = new VsCodeApiClient(port, { responseTimeoutMs: 100 })
    await expect(client.host.describe({})).resolves.toMatchObject({ result: { ok: true, value: DESCRIPTION } })
    await expect(client.respond({
      type: 'client-response', rpcId: RpcId('answer-1'), result: { ok: true, value: {} },
    })).resolves.toEqual({ accepted: true })
    expect(port.sent.every(frame => frame.type === 'rpc/message')).toBe(true)
    client.dispose()
  })

  it('bounds pending calls, cancels callers, ignores their late response, and enforces timeout', async () => {
    const port = new BridgeHarness()
    const client = new VsCodeApiClient(port, { maxPendingRequests: 1, responseTimeoutMs: 500 })
    const abort = new AbortController()
    const first = client.host.describe({}, abort.signal)
    await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
    await expect(client.host.describe({})).rejects.toThrow(/pending request limit/)
    const firstRequest = requestOf(port.sent[0]!) as ClientRequest
    abort.abort(new Error('caller cancelled'))
    await expect(first).rejects.toThrow(/caller cancelled/)
    await port.receive({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: firstRequest.rpcId, result: { ok: true, value: DESCRIPTION } },
    })
    client.dispose()

    const timeoutPort = new BridgeHarness()
    const timeoutClient = new VsCodeApiClient(timeoutPort, { responseTimeoutMs: 10 })
    const timed = timeoutClient.host.describe({})
    await expect(timed).rejects.toThrow()
    timeoutClient.dispose()
  })

  it('opens downlink-only mux and Host streams, signals readiness, closes, and reports stream errors', async () => {
    const port = new BridgeHarness()
    const client = new VsCodeApiClient(port, {
      responseTimeoutMs: 100,
      createStreamId: (() => {
        let next = 0
        return () => VsCodeStreamId(`stream-${String(++next)}`)
      })(),
    })
    const opened: string[] = []
    const muxAbort = new AbortController()
    const mux = client.events.mux({}, muxAbort.signal, () => { opened.push('mux') })[Symbol.asyncIterator]()
    const muxNext = mux.next()
    await vi.waitFor(() => { expect(port.sent[0]).toMatchObject({ type: 'stream/open', stream: 'mux' }) })
    expect(opened).toEqual([])
    await port.receive({ type: 'stream/opened', streamId: VsCodeStreamId('stream-1') })
    await port.receive({
      type: 'stream/frame', streamId: VsCodeStreamId('stream-1'),
      message: {
        type: 'server-request', rpcId: RpcId('mux-frame'), method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 4 },
      },
    })
    await expect(muxNext).resolves.toMatchObject({
      done: false, value: { rpcId: 'mux-frame', payload: { type: 'session/subscribed' } },
    })
    expect(opened).toEqual(['mux'])
    const muxDone = mux.next()
    await port.receive({ type: 'stream/end', streamId: VsCodeStreamId('stream-1') })
    await expect(muxDone).resolves.toEqual({ done: true, value: undefined })

    const hostAbort = new AbortController()
    const host = client.events.host({}, hostAbort.signal)[Symbol.asyncIterator]()
    const hostNext = host.next()
    await vi.waitFor(() => { expect(port.sent).toContainEqual(expect.objectContaining({ type: 'stream/open', stream: 'host' })) })
    await port.receive({ type: 'stream/opened', streamId: VsCodeStreamId('stream-2') })
    await port.receive({ type: 'stream/error', streamId: VsCodeStreamId('stream-2'), message: 'host failed' })
    await expect(hostNext).rejects.toThrow(/host failed/)
    hostAbort.abort()
    expect(port.sent.every(frame => frame.type !== 'stream/frame')).toBe(true)
    client.dispose()
  })

  it('sends one close on cancellation and fails pending work on malformed or uncorrelated downlink', async () => {
    const port = new BridgeHarness()
    const client = new VsCodeApiClient(port, { responseTimeoutMs: 100 })
    const abort = new AbortController()
    const stream = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    const next = stream.next()
    await vi.waitFor(() => { expect(port.sent.some(frame => frame.type === 'stream/open')).toBe(true) })
    const open = port.sent.find((frame): frame is Extract<VsCodeCarrierFrame, { type: 'stream/open' }> => frame.type === 'stream/open')!
    abort.abort()
    await expect(next).resolves.toEqual({ done: true, value: undefined })
    await vi.waitFor(() => {
      expect(port.sent.filter(frame => frame.type === 'stream/close')).toEqual([
        { type: 'stream/close', streamId: open.streamId },
      ])
    })
    await port.receive({ type: 'stream/end', streamId: open.streamId })

    const pending = client.host.describe({})
    await vi.waitFor(() => { expect(port.sent.some(frame => requestOf(frame)?.type === 'client-request')).toBe(true) })
    await port.receive({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: RpcId('unknown'), result: { ok: true, value: DESCRIPTION } },
    })
    await expect(pending).rejects.toThrow(/uncorrelated/)
    await expect(client.host.describe({})).rejects.toThrow(/uncorrelated/)
  })

  it('supports generic /api RPC and rejects undeclared logical targets', async () => {
    const port = new BridgeHarness()
    port.onFrame = async (frame) => {
      const request = requestOf(frame)
      if (request?.type !== 'client-request') return
      await port.receive({
        type: 'rpc/message',
        message: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { created: true } } },
      })
    }
    const client = new VsCodeApiClient(port, { responseTimeoutMs: 100 })
    await expect(client.rpc.call('/api', 'goals/create', { args: {} })).resolves.toEqual({
      ok: true, value: { created: true },
    })
    await expect(client.rpc.call('/other', 'goals/create', {})).rejects.toThrow(/channel.*unavailable/)
    await expect(client.rpc.call('/api', '../bad', {})).rejects.toThrow(/invalid RPC target/)
    client.dispose()
  })

  it('validates construction and the protected JSON upstream seam', async () => {
    expect(() => { new VsCodeApiClient(new BridgeHarness(), { responseTimeoutMs: Number.NaN }) })
      .toThrow(/responseTimeoutMs/)
    expect(() => { new VsCodeApiClient(new BridgeHarness(), { maxPendingRequests: 0 }) })
      .toThrow(/maxPendingRequests/)
    expect(() => { new VsCodeApiClient(new BridgeHarness(), { maxOpenStreams: 0 }) })
      .toThrow(/maxOpenStreams/)
    expect(() => { new VsCodeApiClient(new BridgeHarness(0)) }).toThrow(/maxLogicalRpcBytes/)

    const rawPort = new BridgeHarness()
    rawPort.onFrame = async (frame) => {
      const message = requestOf(frame)
      if (message?.type === 'client-request') {
        await rawPort.receive({
          type: 'rpc/message',
          message: { type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: DESCRIPTION } },
        })
      } else if (message?.type === 'client-response') {
        await rawPort.receive({ type: 'rpc/receipt', rpcId: message.rpcId, receipt: { accepted: true } })
      }
    }
    const client = new ExposedClient(rawPort)
    await expect(client.rawFetch()).rejects.toThrow(/JSON text/)
    await expect(client.rawFetch({ body: '{' })).rejects.toThrow()
    await expect(client.rawFetch({ body: JSON.stringify({
      type: 'server-response', rpcId: 'server-up', result: { ok: true, value: {} },
    }) })).rejects.toThrow(/cannot travel upstream/)
    await expect(client.rawFetch({ body: JSON.stringify({
      type: 'client-request', rpcId: 'raw-request', method: 'host.describe', payload: {},
    }), signal: null })).resolves.toHaveProperty('ok', true)
    await expect(client.rawFetch({ body: JSON.stringify({
      type: 'client-response', rpcId: 'raw-response', result: { ok: true, value: {} },
    }), signal: null })).resolves.toHaveProperty('ok', true)
    client.dispose()
  })

  it('rejects duplicate ids and response-kind mismatches', async () => {
    const duplicatePort = new BridgeHarness()
    const duplicate = new ScriptedIdClient(
      duplicatePort,
      { responseTimeoutMs: 500 },
      [RpcId('same'), RpcId('same')],
    )
    const first = duplicate.host.describe({})
    await vi.waitFor(() => { expect(duplicatePort.sent).toHaveLength(1) })
    await expect(duplicate.host.describe({})).rejects.toThrow(/duplicate pending rpcId/)
    duplicate.dispose()
    await expect(first).rejects.toThrow(/closed/)

    const receiptPort = new BridgeHarness()
    const receiptClient = new ScriptedIdClient(receiptPort, { responseTimeoutMs: 100 }, [RpcId('response-kind')])
    const responsePending = receiptClient.host.describe({})
    await vi.waitFor(() => { expect(receiptPort.sent).toHaveLength(1) })
    await receiptPort.receive({ type: 'rpc/receipt', rpcId: RpcId('response-kind'), receipt: { accepted: true } })
    await expect(responsePending).rejects.toThrow(/expected response, received receipt/)

    const responsePort = new BridgeHarness()
    const responseClient = new VsCodeApiClient(responsePort, { responseTimeoutMs: 100 })
    const receiptPending = responseClient.respond({
      type: 'client-response', rpcId: RpcId('receipt-kind'), result: { ok: true, value: {} },
    })
    await vi.waitFor(() => { expect(responsePort.sent).toHaveLength(1) })
    await responsePort.receive({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: RpcId('receipt-kind'), result: { ok: true, value: {} } },
    })
    await expect(receiptPending).rejects.toThrow(/expected receipt, received response/)
  })

  it('bounds cancelled-id tombstones and preserves abort reasons', async () => {
    const port = new BridgeHarness()
    const client = new ScriptedIdClient(
      port,
      { maxPendingRequests: 1, responseTimeoutMs: 500 },
      [RpcId('cancel-a'), RpcId('cancel-b'), RpcId('cancel-c')],
    )
    const firstAbort = new AbortController()
    const first = client.host.describe({}, firstAbort.signal)
    firstAbort.abort('string cancellation')
    await expect(first).rejects.toThrow(/string cancellation/)

    const secondAbort = new AbortController()
    const second = client.host.describe({}, secondAbort.signal)
    secondAbort.abort('')
    await expect(second).rejects.toThrow(/aborted/)
    await port.receive({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: RpcId('cancel-b'), result: { ok: true, value: DESCRIPTION } },
    })
    const already = AbortSignal.abort(new Error('already aborted'))
    await expect(client.host.describe({}, already)).rejects.toThrow(/already aborted/)
    client.dispose()
  })

  it('resets pending work for runtime lifecycle events and validates the replacement decoder', async () => {
    const port = new BridgeHarness()
    const ide = new IdeHarness()
    const client = new VsCodeApiClient(port, { responseTimeoutMs: 500 }, ide)
    ide.emit({ type: 'ide/event', event: 'workspace.selected', payload: { workspaceRoot: '/workspace' } })
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'idle' } })
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'starting' } })

    const pending = client.host.describe({})
    await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'restarting' } })
    await expect(pending).rejects.toThrow(/generation restarting/)
    await expect(client.host.describe({})).rejects.toThrow(/generation restarting/)

    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
    port.emitRaw({ type: 'not-wire' })
    await vi.waitFor(async () => {
      await expect(client.host.describe({})).rejects.toThrow()
    })
    client.dispose()
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'failed' } })
  })

  it('ignores stale fragmented frames and decode failures after runtime generation changes', async () => {
    const digestGates = [Promise.withResolvers<ArrayBuffer>(), Promise.withResolvers<ArrayBuffer>()]
    let digestIndex = 0
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async () => await digestGates[digestIndex++]!.promise,
    )
    try {
      const port = new BridgeHarness()
      const ide = new IdeHarness()
      const client = new VsCodeApiClient(port, { responseTimeoutMs: 100 }, ide)
      port.onFrame = async (frame) => {
        const request = requestOf(frame)
        if (request?.type !== 'client-request') return
        await port.receive({
          type: 'rpc/message',
          message: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: DESCRIPTION } },
        })
      }
      const encoded = JSON.stringify({ type: 'control/shutdown' })
      const bytes = new TextEncoder().encode(encoded)
      let messageId = WireMessageId('stale-frame')
      port.emitRaw({
        type: 'wire/chunk-start', messageId, totalBytes: bytes.byteLength, sha256: '0'.repeat(64),
      })
      port.emitRaw({ type: 'wire/chunk', messageId, index: 0, data: Binary.toBase64(bytes) })
      port.emitRaw({ type: 'wire/chunk-end', messageId, chunks: 1 })
      await vi.waitFor(() => { expect(digest).toHaveBeenCalledOnce() })
      ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'restarting' } })
      digestGates[0]!.resolve(new Uint8Array(32).buffer)
      ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
      await expect(client.host.describe({})).resolves.toMatchObject({ result: { ok: true } })

      messageId = WireMessageId('stale-error')
      port.emitRaw({
        type: 'wire/chunk-start', messageId, totalBytes: bytes.byteLength, sha256: '0'.repeat(64),
      })
      port.emitRaw({ type: 'wire/chunk', messageId, index: 0, data: Binary.toBase64(bytes) })
      port.emitRaw({ type: 'wire/chunk-end', messageId, chunks: 1 })
      await vi.waitFor(() => { expect(digest).toHaveBeenCalledTimes(2) })
      ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'restarting' } })
      digestGates[1]!.resolve(new Uint8Array(32).fill(1).buffer)
      ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
      await expect(client.host.describe({})).resolves.toMatchObject({ result: { ok: true } })
      client.dispose()
    } finally {
      digest.mockRestore()
    }
  })

  it('rejects an outbound frame queued across a runtime generation change', async () => {
    const port = new GatedBridgeHarness()
    const ide = new IdeHarness()
    const client = new VsCodeApiClient(port, { responseTimeoutMs: 500 }, ide)
    const first = client.host.describe({})
    await port.started.promise
    const second = client.host.describe({})
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'restarting' } })
    await expect(first).rejects.toThrow(/generation restarting/)
    await expect(second).rejects.toThrow(/generation restarting/)
    port.release.resolve(undefined)
    await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })

    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
    port.onFrame = async (frame) => {
      const request = requestOf(frame)
      if (request?.type !== 'client-request') return
      await port.receive({
        type: 'rpc/message',
        message: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: DESCRIPTION } },
      })
    }
    await expect(client.host.describe({})).resolves.toMatchObject({ result: { ok: true } })
    expect(port.sent).toHaveLength(2)
    client.dispose()
  })

  it('enforces stream ids and capacity and handles already-aborted streams', async () => {
    const abortedPort = new BridgeHarness()
    const abortedClient = new VsCodeApiClient(abortedPort)
    const aborted = abortedClient.events.mux({}, AbortSignal.abort())[Symbol.asyncIterator]()
    await expect(aborted.next()).resolves.toEqual({ done: true, value: undefined })
    expect(abortedPort.sent).toEqual([])
    abortedClient.dispose()
    await expect(abortedClient.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toThrow(/closed/)

    const limitedPort = new BridgeHarness()
    const limited = new VsCodeApiClient(limitedPort, { maxOpenStreams: 1 })
    const one = limited.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    const oneNext = one.next()
    await vi.waitFor(() => { expect(limitedPort.sent).toHaveLength(1) })
    await expect(limited.events.host({}, new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toThrow(/open stream limit/)
    limited.dispose()
    await expect(oneNext).rejects.toThrow(/closed/)

    const duplicatePort = new BridgeHarness()
    const duplicate = new VsCodeApiClient(duplicatePort, {
      createStreamId: () => VsCodeStreamId('duplicate-stream'),
    })
    const first = duplicate.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    const firstNext = first.next()
    await vi.waitFor(() => { expect(duplicatePort.sent).toHaveLength(1) })
    await expect(duplicate.events.host({}, new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toThrow(/duplicate VS Code stream id/)
    duplicate.dispose()
    await expect(firstNext).rejects.toThrow(/closed/)
  })

  it('handles Host frames and suppresses opened/data callbacks after local close', async () => {
    const port = new BridgeHarness()
    const ids = [VsCodeStreamId('host-valid'), VsCodeStreamId('locally-closed')]
    const client = new VsCodeApiClient(port, { createStreamId: () => ids.shift()! })
    const host = client.events.host({}, new AbortController().signal)[Symbol.asyncIterator]()
    const hostNext = host.next()
    await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
    await port.receive({ type: 'stream/opened', streamId: VsCodeStreamId('host-valid') })
    await port.receive({
      type: 'stream/frame', streamId: VsCodeStreamId('host-valid'),
      message: {
        type: 'server-request', rpcId: RpcId('host-frame'), method: 'host/session-removed',
        payload: { type: 'host/session-removed', sessionId: 'session-1' },
      },
    })
    await expect(hostNext).resolves.toMatchObject({ value: { payload: { type: 'host/session-removed' } } })
    const hostDone = host.next()
    await port.receive({ type: 'stream/end', streamId: VsCodeStreamId('host-valid') })
    await expect(hostDone).resolves.toEqual({ done: true, value: undefined })

    const opened = vi.fn()
    const abort = new AbortController()
    const local = client.events.mux({}, abort.signal, opened)[Symbol.asyncIterator]()
    const localNext = local.next()
    await vi.waitFor(() => { expect(port.sent).toHaveLength(2) })
    abort.abort()
    await expect(localNext).resolves.toEqual({ done: true, value: undefined })
    await port.receive({ type: 'stream/opened', streamId: VsCodeStreamId('locally-closed') })
    await port.receive({
      type: 'stream/frame', streamId: VsCodeStreamId('locally-closed'),
      message: {
        type: 'server-request', rpcId: RpcId('late-frame'), method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: 'late', lastSeq: -1 },
      },
    })
    await port.receive({ type: 'stream/end', streamId: VsCodeStreamId('locally-closed') })
    expect(opened).not.toHaveBeenCalled()
    client.dispose()
  })

  it('closes a stream when cancellation races its completed open send', async () => {
    const port = new BridgeHarness()
    const abort = new AbortController()
    port.onFrame = (frame) => {
      if (frame.type === 'stream/open') abort.abort()
    }
    const client = new VsCodeApiClient(port)
    const iterator = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await vi.waitFor(() => { expect(port.sent.some(frame => frame.type === 'stream/close')).toBe(true) })
    const open = port.sent.find((frame): frame is Extract<VsCodeCarrierFrame, { type: 'stream/open' }> => frame.type === 'stream/open')!
    await port.receive({ type: 'stream/end', streamId: open.streamId })
    client.dispose()
  })

  it('rejects invalid stream lifecycle and payload frames', async () => {
    const cases: Array<(port: BridgeHarness, client: VsCodeApiClient) => Promise<void>> = [
      async (port, client) => {
        await port.receive({ type: 'stream/opened', streamId: VsCodeStreamId('unknown') })
        await expect(client.host.describe({})).rejects.toThrow(/unexpected stream\/opened/)
      },
      async (port, client) => {
        const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
        const next = iterator.next()
        await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
        const open = port.sent[0] as Extract<VsCodeCarrierFrame, { type: 'stream/open' }>
        await port.receive({
          type: 'stream/frame', streamId: open.streamId,
          message: {
            type: 'server-request', rpcId: RpcId('early'), method: 'session/subscribed',
            payload: { type: 'session/subscribed', sessionId: 's', lastSeq: 0 },
          },
        })
        await expect(next).rejects.toThrow(/unexpected stream\/frame/)
      },
      async (port, client) => {
        const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
        const next = iterator.next()
        await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
        const open = port.sent[0] as Extract<VsCodeCarrierFrame, { type: 'stream/open' }>
        await port.receive({ type: 'stream/opened', streamId: open.streamId })
        await port.receive({ type: 'stream/opened', streamId: open.streamId })
        await expect(next).rejects.toThrow(/unexpected stream\/opened/)
      },
      async (port, client) => {
        const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
        const next = iterator.next()
        await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
        const open = port.sent[0] as Extract<VsCodeCarrierFrame, { type: 'stream/open' }>
        await port.receive({ type: 'stream/opened', streamId: open.streamId })
        await port.receive({
          type: 'stream/frame', streamId: open.streamId,
          message: { type: 'server-request', rpcId: RpcId('bad'), method: 'session/subscribed', payload: {} },
        })
        await expect(next).rejects.toThrow()
      },
      async (port, client) => {
        await port.receive({ type: 'stream/end', streamId: VsCodeStreamId('unknown') })
        await expect(client.host.describe({})).rejects.toThrow(/unexpected stream terminal/)
      },
    ]
    for (const drive of cases) {
      const port = new BridgeHarness()
      const client = new VsCodeApiClient(port)
      await drive(port, client)
      client.dispose()
    }
  })

  it('rejects every upstream-only or terminal control frame on the downlink', async () => {
    const frames: VsCodeCarrierFrame[] = [
      { type: 'control/error', code: 'fixture', message: 'stopped' },
      { type: 'control/hello', protocolVersion: 1, extensionVersion: '1', workspaceRoot: '/w', locale: 'en' },
      {
        type: 'control/ready', protocolVersion: 1, runtimeVersion: '1',
        graph: { rev: 'g', entries: [] }, bundles: [], maxLogicalRpcBytes: 4096,
      },
      { type: 'control/shutdown' },
      { type: 'control/shutdown-complete' },
      { type: 'stream/open', streamId: VsCodeStreamId('up-open'), stream: 'host', payload: {} },
      { type: 'stream/close', streamId: VsCodeStreamId('up-close') },
      {
        type: 'rpc/message',
        message: { type: 'client-request', rpcId: RpcId('up-request'), method: 'host.describe', payload: {} },
      },
      {
        type: 'rpc/message',
        message: { type: 'client-response', rpcId: RpcId('up-response'), result: { ok: true, value: {} } },
      },
      {
        type: 'rpc/message',
        message: { type: 'server-request', rpcId: RpcId('up-server'), method: 'session/subscribed', payload: {} },
      },
    ]
    for (const frame of frames) {
      const port = new BridgeHarness()
      const client = new VsCodeApiClient(port)
      await port.receive(frame)
      await expect(client.host.describe({})).rejects.toThrow()
      client.dispose()
    }
  })

  it('closes on malformed records, fragmented control, send failure, and disposal races', async () => {
    const malformedPort = new BridgeHarness()
    const malformed = new VsCodeApiClient(malformedPort)
    malformedPort.emitRaw({ type: 'not-wire' })
    await expect(malformed.host.describe({})).rejects.toThrow()

    const fragmentedPort = new BridgeHarness(1024 * 1024)
    const fragmented = new VsCodeApiClient(fragmentedPort)
    const pending = fragmented.host.describe({})
    await fragmentedPort.receive({ type: 'control/error', code: 'large', message: 'x'.repeat(300_000) })
    await expect(pending).rejects.toThrow(/large/)

    const failedPort = new BridgeHarness()
    failedPort.sendFailure = 'plain send failure'
    const failed = new VsCodeApiClient(failedPort)
    await expect(failed.host.describe({})).rejects.toThrow(/plain send failure/)

    const racePort = new BridgeHarness()
    const race = new VsCodeApiClient(racePort)
    const racePending = race.host.describe({})
    racePort.emitRaw({ type: 'wire/message', encoded: JSON.stringify({ type: 'control/shutdown' }) })
    race.dispose()
    await expect(racePending).rejects.toThrow(/closed/)
    race.dispose()

    const stickyPort = new StickyBridgeHarness()
    const sticky = new VsCodeApiClient(stickyPort)
    sticky.dispose()
    stickyPort.emitRaw({ type: 'wire/message', encoded: JSON.stringify({ type: 'control/shutdown' }) })
  })
})
