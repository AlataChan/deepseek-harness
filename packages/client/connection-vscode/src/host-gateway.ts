/** Companion-side handshake, RPC routing, event pumps, and bundle announcement. */

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ApiProxy, HostFrame, MuxFrame, RpcId, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId as createRpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { rpcReceiptSchema, serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { toFetchHandler, toServerRequest } from '@deepseek-ai/dsh-host-apiproxy'
import type { ClientBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import type { ClientBundleRecord } from '@deepseek-ai/dsh-client-modules'
import {
  assertImageBodyCapacity,
  type ImageCapacitySource,
} from '@deepseek-ai/dsh-client-connection/body-capacity'
import {
  VSCODE_CARRIER_PROTOCOL_VERSION,
  type ClientBundleLocation,
  type VsCodeCarrierFrame,
  type VsCodeStreamId,
} from './protocol.ts'

const INTERNAL_BASE = 'http://dsh.internal'

/** Client-module view required by the VS Code surface adapter. */
export interface HostClientModules {
  /** Return the current immutable boot graph. */
  graph(): ClientBootGraph
  /** Return bundle locations in graph order. */
  bundleRecords(): readonly ClientBundleRecord[]
}

/** Injected gateway dependencies and platform ports. */
export interface HostGatewayOptions {
  /** Existing Host API implementation. */
  apiProxy: ApiProxy
  /** Transport-neutral Client Plugin registry. */
  clientModules: HostClientModules
  /** Optional attachment configuration used by the shared capacity invariant. */
  imageCapacitySource: ImageCapacitySource
  /** Workspace root selected when the companion was launched. */
  expectedWorkspaceRoot: string
  /** Installed Harness runtime version. */
  runtimeVersion: string
  /** Resolved logical capacity for RPC and stream-data frames. */
  maxLogicalRpcBytes: number
  /** Read one discovered Client Plugin artifact. */
  readBundle?: (path: string) => Promise<Uint8Array>
  /** Compute a lowercase SHA-256 digest for one artifact. */
  sha256?: (bytes: Uint8Array) => Promise<string>
  /** Mint the narrow request id used only to open an ApiProxy stream. */
  createRpcId?: () => RpcId
  /** Deliver one logical frame through the bounded IPC channel. */
  send(frame: VsCodeCarrierFrame): Promise<void>
  /** Request physical-channel closure after a terminal frame is delivered. */
  close(): void
}

interface ActiveStream {
  readonly abort: AbortController
  promise: Promise<void>
}

type GatewayState = 'awaiting-hello' | 'ready' | 'closing' | 'closed'

async function defaultReadBundle(path: string): Promise<Uint8Array> {
  return readFile(path)
}

function defaultSha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'))
}

function defaultCreateRpcId(): RpcId {
  return createRpcId(randomUUID())
}

/** Companion-side owner for one extension connection and all event-stream pumps. */
export class VsCodeHostGateway {
  private readonly fetchHandler: ReturnType<typeof toFetchHandler>
  private readonly streams = new Map<VsCodeStreamId, ActiveStream>()
  private readonly readBundle: NonNullable<HostGatewayOptions['readBundle']>
  private readonly sha256: NonNullable<HostGatewayOptions['sha256']>
  private readonly mintRpcId: NonNullable<HostGatewayOptions['createRpcId']>
  private state: GatewayState = 'awaiting-hello'
  private disposal: Promise<void> | undefined

  /** @param options - ApiProxy, client graph, capacities, and injected platform ports. */
  constructor(private readonly options: HostGatewayOptions) {
    assertImageBodyCapacity(options.imageCapacitySource, options.maxLogicalRpcBytes)
    this.fetchHandler = toFetchHandler(options.apiProxy)
    this.readBundle = options.readBundle ?? defaultReadBundle
    this.sha256 = options.sha256 ?? defaultSha256
    this.mintRpcId = options.createRpcId ?? defaultCreateRpcId
  }

  /**
   * Route one already-decoded logical frame in strict arrival order.
   * @param frame - carrier frame delivered by {@link VsCodeIpcChannel}.
   */
  async accept(frame: VsCodeCarrierFrame): Promise<void> {
    if (this.state === 'closed' || this.state === 'closing') return
    try {
      if (this.state === 'awaiting-hello') {
        await this.acceptHandshake(frame)
        return
      }
      await this.acceptReadyFrame(frame)
    } catch (error) {
      await this.fail('gateway-failure', error)
    }
  }

  /**
   * Abort and await every stream pump without sending further frames.
   * @returns the shared idempotent disposal promise.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.state = 'closed'
    this.disposal = this.stopStreams()
    return this.disposal
  }

  private async acceptHandshake(frame: VsCodeCarrierFrame): Promise<void> {
    if (frame.type !== 'control/hello') {
      await this.fail('handshake-required', new Error('control/hello must be the first logical frame'))
      return
    }
    if (frame.protocolVersion !== VSCODE_CARRIER_PROTOCOL_VERSION) {
      await this.fail(
        'protocol-mismatch',
        new Error(`extension protocol ${String(frame.protocolVersion)} is incompatible with runtime protocol ${String(VSCODE_CARRIER_PROTOCOL_VERSION)}`),
      )
      return
    }
    if (resolve(frame.workspaceRoot) !== resolve(this.options.expectedWorkspaceRoot)) {
      await this.fail('workspace-mismatch', new Error('extension workspace does not match the launched companion workspace'))
      return
    }
    const graph = this.options.clientModules.graph()
    const bundles = await this.bundleLocations(graph)
    await this.options.send({
      type: 'control/ready',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      runtimeVersion: this.options.runtimeVersion,
      graph,
      bundles,
      maxLogicalRpcBytes: this.options.maxLogicalRpcBytes,
    })
    this.state = 'ready'
  }

  private async bundleLocations(graph: ClientBootGraph): Promise<ClientBundleLocation[]> {
    const records = new Map(this.options.clientModules.bundleRecords().map(record => [record.entry.id, record]))
    return Promise.all(graph.entries.map(async (entry) => {
      const record = records.get(entry.id)
      if (record === undefined || record.entry.rev !== entry.rev) {
        throw new Error(`client graph entry ${entry.id}@${entry.rev} has no matching bundle artifact`)
      }
      const bytes = await this.readBundle(record.clientPath)
      return {
        id: entry.id,
        rev: entry.rev,
        sourcePath: record.clientPath,
        sha256: await this.sha256(bytes),
      }
    }))
  }

  private async acceptReadyFrame(frame: VsCodeCarrierFrame): Promise<void> {
    switch (frame.type) {
      case 'rpc/message':
        await this.acceptRpc(frame.message)
        return
      case 'stream/open':
        await this.openStream(frame)
        return
      case 'stream/close':
        await this.closeStream(frame.streamId)
        return
      case 'control/shutdown':
        await this.shutdown()
        return
      case 'control/hello':
      case 'control/ready':
      case 'control/error':
      case 'control/shutdown-complete':
      case 'rpc/receipt':
      case 'stream/opened':
      case 'stream/frame':
      case 'stream/end':
      case 'stream/error':
        await this.fail('unexpected-frame', new Error(`${frame.type} is not accepted from the extension`))
    }
  }

  private async acceptRpc(message: Extract<VsCodeCarrierFrame, { type: 'rpc/message' }>['message']): Promise<void> {
    switch (message.type) {
      case 'client-request': {
        const response = await this.fetchHandler.fetch(new URL(`/api/${encodeURIComponent(message.method)}`, INTERNAL_BASE), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
        })
        if (!response.ok) throw new Error(`ApiProxy carrier returned HTTP ${String(response.status)} for ${message.method}`)
        await this.options.send({ type: 'rpc/message', message: serverResponseSchema.parse(await response.json()) })
        return
      }
      case 'client-response': {
        const response = await this.fetchHandler.fetch(new URL('/api/respond', INTERNAL_BASE), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
        })
        await this.options.send({
          type: 'rpc/receipt', rpcId: message.rpcId, receipt: rpcReceiptSchema.parse(await response.json()),
        })
        return
      }
      case 'server-request':
      case 'server-response':
        await this.fail('unexpected-frame', new Error(`${message.type} is downlink-only`))
    }
  }

  private async openStream(frame: Extract<VsCodeCarrierFrame, { type: 'stream/open' }>): Promise<void> {
    if (this.streams.has(frame.streamId)) {
      await this.options.send({ type: 'stream/error', streamId: frame.streamId, message: 'stream already open' })
      return
    }
    const abort = new AbortController()
    const active: ActiveStream = { abort, promise: Promise.resolve() }
    this.streams.set(frame.streamId, active)
    await this.options.send({ type: 'stream/opened', streamId: frame.streamId })
    const source = frame.stream === 'mux'
      ? this.options.apiProxy.events.mux(
        { rpcId: this.mintRpcId(), payload: frame.payload }, abort.signal,
      )
      : this.options.apiProxy.events.host(
        { rpcId: this.mintRpcId(), payload: frame.payload }, abort.signal,
      )
    active.promise = this.pumpStream(frame.streamId, active, source)
    // A pump rejects only when the IPC send fails; VsCodeIpcChannel owns that
    // terminal failure and closes the physical channel.
    void active.promise.catch(() => {})
  }

  private async pumpStream(
    streamId: VsCodeStreamId,
    active: ActiveStream,
    source: AsyncIterable<RpcRequest<MuxFrame | HostFrame>>,
  ): Promise<void> {
    let failed = false
    try {
      for await (const narrow of source) {
        if (this.state !== 'ready') return
        await this.options.send({ type: 'stream/frame', streamId, message: toServerRequest(narrow) })
      }
    } catch (error) {
      if (this.state === 'ready' && !active.abort.signal.aborted) {
        failed = true
        await this.options.send({ type: 'stream/error', streamId, message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      this.streams.delete(streamId)
    }
    if (!failed && this.state === 'ready') {
      await this.options.send({ type: 'stream/end', streamId })
    }
  }

  private async closeStream(streamId: VsCodeStreamId): Promise<void> {
    const active = this.streams.get(streamId)
    if (active === undefined) {
      await this.options.send({ type: 'stream/error', streamId, message: 'stream is not open' })
      return
    }
    active.abort.abort()
    await active.promise
  }

  private async shutdown(): Promise<void> {
    this.state = 'closing'
    await this.stopStreams()
    await this.options.send({ type: 'control/shutdown-complete' })
    this.state = 'closed'
    this.options.close()
  }

  private async fail(code: string, error: unknown): Promise<void> {
    if (this.state === 'closing' || this.state === 'closed') return
    this.state = 'closing'
    await this.stopStreams()
    const message = error instanceof Error ? error.message : String(error)
    try {
      await this.options.send({ type: 'control/error', code, message })
    } finally {
      this.state = 'closed'
      this.options.close()
    }
  }

  private async stopStreams(): Promise<void> {
    const active = [...this.streams.values()]
    for (const stream of active) stream.abort.abort()
    await Promise.allSettled(active.map(stream => stream.promise))
    this.streams.clear()
  }
}
