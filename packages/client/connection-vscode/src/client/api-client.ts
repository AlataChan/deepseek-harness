/** ApiProxy and event-stream client over the bounded VS Code Webview bridge. */

import {
  RpcId,
  type ClientRequest,
  type ClientResponse,
  type HostFrame,
  type HostOpenPayload,
  type MuxFrame,
  type MuxOpenPayload,
  type RpcMessage,
  type RpcReceipt,
  type RpcRequest,
  type ServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { rpcMessageSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import {
  assertConnectionRpcTarget,
  type ClientConnectionRpc,
} from '@deepseek-ai/dsh-client-connection/client-shared'
import { sendVsCodeFrame, VsCodeWireDecoder } from '../codec.ts'
import {
  type IdeEvent,
  VsCodeStreamId,
  type VsCodeCarrierFrame,
  type VsCodeStreamId as VsCodeStreamIdType,
} from '../protocol.ts'
import type { VsCodeBridgePort, VsCodeIdePort } from './bridge-port.ts'

/** Default bounded unary deadline inherited by surface configuration. */
export const DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS = 30_000

/** Default maximum requests awaiting correlated downlink responses. */
export const DEFAULT_VSCODE_MAX_PENDING_REQUESTS = 256

/** Default maximum streams retained across open and close handshakes. */
export const DEFAULT_VSCODE_MAX_OPEN_STREAMS = 16

/** Deterministic limits and id source for one Webview API client. */
export interface VsCodeApiClientOptions {
  /** Unary response deadline in milliseconds. */
  responseTimeoutMs?: number
  /** Maximum simultaneous unary or response-receipt correlations. */
  maxPendingRequests?: number
  /** Maximum stream records awaiting a terminal downlink frame. */
  maxOpenStreams?: number
  /** Stream id source; production uses `crypto.randomUUID()`. */
  createStreamId?: () => VsCodeStreamIdType
}

type PendingKind = 'response' | 'receipt'

interface PendingRequest {
  readonly kind: PendingKind
  readonly resolve: (value: ServerResponse | RpcReceipt) => void
  readonly reject: (error: Error) => void
  readonly detachAbort: () => void
}

type StreamEnvelope = RpcRequest<MuxFrame | HostFrame>
type StreamItem =
  | { kind: 'frame'; envelope: StreamEnvelope }
  | { kind: 'end' }
  | { kind: 'error'; error: Error }

interface StreamParser {
  parse(value: unknown): MuxFrame | HostFrame
}

class RuntimeGenerationUnavailableError extends Error {}

interface ActiveStream {
  readonly id: VsCodeStreamIdType
  readonly parser: StreamParser
  readonly onOpen: (() => void) | undefined
  readonly inbox: StreamItem[]
  wake: (() => void) | undefined
  opened: boolean
  locallyClosed: boolean
  terminal: boolean
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string' && reason !== '') return new Error(reason)
  return new DOMException('The operation was aborted', 'AbortError')
}

function defaultStreamId(): VsCodeStreamIdType {
  return VsCodeStreamId(crypto.randomUUID())
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Webview carrier implementing the existing ApiProxy client interface and logical RPC channel. */
export class VsCodeApiClient extends AbstractApiClient {
  private decoder: VsCodeWireDecoder
  private readonly maxPendingRequests: number
  private readonly maxOpenStreams: number
  private readonly createStreamId: () => VsCodeStreamIdType
  private readonly pending = new Map<RpcId, PendingRequest>()
  private readonly cancelled = new Set<RpcId>()
  private readonly streams = new Map<VsCodeStreamIdType, ActiveStream>()
  private inboundTail: Promise<void> = Promise.resolve()
  private outboundTail: Promise<void> = Promise.resolve()
  private unsubscribe!: () => void
  private readonly unsubscribeRuntime: () => void
  private generation = 0
  private runtimeReady = true
  private runtimeUnavailable = new RuntimeGenerationUnavailableError('VS Code runtime generation is not ready')
  private closed: Error | undefined

  /** Generic `/api` RPC channel over the same correlation table. */
  readonly rpc: ClientConnectionRpc = {
    call: async (channel, endpoint, payload, signal) => {
      assertConnectionRpcTarget(channel, endpoint)
      if (channel !== '/api') throw new Error(`connection: channel ${JSON.stringify(channel)} is unavailable over the VS Code bridge`)
      const response = await this.request({
        type: 'client-request', rpcId: this.mintRpcId(), method: endpoint, payload,
      }, 'response', signal)
      return response.result
    },
  }

  /**
   * Attach one client to a shell-owned bridge port.
   * @param port - physical record delivery and subscription port.
   * @param options - bounded correlation, stream, timeout, and id settings.
   * @param ide - shell lifecycle events used to reset transient runtime generations.
   */
  constructor(
    private readonly port: VsCodeBridgePort,
    options: VsCodeApiClientOptions = {},
    ide?: Pick<VsCodeIdePort, 'subscribeEvents'>,
  ) {
    super(positiveInteger(options.responseTimeoutMs ?? DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS, 'responseTimeoutMs'))
    this.maxPendingRequests = positiveInteger(
      options.maxPendingRequests ?? DEFAULT_VSCODE_MAX_PENDING_REQUESTS,
      'maxPendingRequests',
    )
    this.maxOpenStreams = positiveInteger(options.maxOpenStreams ?? DEFAULT_VSCODE_MAX_OPEN_STREAMS, 'maxOpenStreams')
    this.createStreamId = options.createStreamId ?? defaultStreamId
    positiveInteger(port.maxLogicalRpcBytes, 'maxLogicalRpcBytes')
    this.decoder = new VsCodeWireDecoder({
      maxLogicalRpcBytes: port.maxLogicalRpcBytes,
      onViolation: (error) => { this.terminate(error) },
    })
    this.unsubscribe = port.subscribe((value) => { this.receive(value) })
    this.unsubscribeRuntime = ide?.subscribeEvents((event) => { this.acceptIdeEvent(event) }) ?? (() => {})
  }

  /** Permanently stop this Client instance and reject every owned operation. */
  dispose(): void {
    this.terminate(new Error('VS Code API client is closed'))
  }

  protected doFetch(_input: URL, init?: RequestInit): Promise<Response> {
    if (typeof init?.body !== 'string') return Promise.reject(new Error('VS Code API request body must be JSON text'))
    let message: RpcMessage
    try {
      message = rpcMessageSchema.parse(JSON.parse(init.body)) as unknown as RpcMessage
    } catch (error) {
      return Promise.reject(new Error('VS Code API request body is invalid', { cause: error }))
    }
    if (message.type !== 'client-request' && message.type !== 'client-response') {
      return Promise.reject(new Error(`${message.type} cannot travel upstream`))
    }
    const result = message.type === 'client-request'
      ? this.request(message, 'response', init.signal ?? undefined)
      : this.request(message, 'receipt', init.signal ?? undefined)
    return result.then(value => new Response(JSON.stringify(value), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }

  protected override openMux(
    payload: MuxOpenPayload,
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.openStream(
      id => ({ type: 'stream/open', streamId: id, stream: 'mux', payload }),
      signal,
      muxFrameSchema,
      onOpen,
    )
  }

  protected override openHost(
    payload: HostOpenPayload,
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.openStream(
      id => ({ type: 'stream/open', streamId: id, stream: 'host', payload }),
      signal,
      hostFrameSchema,
      onOpen,
    )
  }

  private request(message: ClientRequest, kind: 'response', signal: AbortSignal | undefined): Promise<ServerResponse>
  private request(message: ClientResponse, kind: 'receipt', signal: AbortSignal | undefined): Promise<RpcReceipt>
  private request(
    message: ClientRequest | ClientResponse,
    kind: PendingKind,
    signal: AbortSignal | undefined,
  ): Promise<ServerResponse | RpcReceipt> {
    if (this.closed !== undefined) return Promise.reject(this.closed)
    if (signal?.aborted === true) return Promise.reject(abortError(signal))
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(new Error(`VS Code bridge pending request limit ${String(this.maxPendingRequests)} reached`))
    }
    if (this.pending.has(message.rpcId)) return Promise.reject(new Error(`duplicate pending rpcId ${message.rpcId}`))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.pending.delete(message.rpcId)
        detachAbort()
        this.rememberCancelled(message.rpcId)
        reject(abortError(signal as AbortSignal))
      }
      const detachAbort = (): void => { signal?.removeEventListener('abort', onAbort) }
      this.pending.set(message.rpcId, { kind, resolve, reject, detachAbort })
      signal?.addEventListener('abort', onAbort, { once: true })
      void this.sendFrame({ type: 'rpc/message', message }).catch((error: unknown) => {
        const pending = this.pending.get(message.rpcId)
        if (pending === undefined) return
        this.pending.delete(message.rpcId)
        pending.detachAbort()
        // A current-generation non-Error send failure terminates and clears this
        // entry before this observer; surviving rejections are internal Errors.
        pending.reject(error as Error)
      })
    })
  }

  private async *openStream<F extends MuxFrame | HostFrame>(
    createOpenFrame: (id: VsCodeStreamIdType) => Extract<VsCodeCarrierFrame, { type: 'stream/open' }>,
    signal: AbortSignal,
    parser: StreamParser,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    if (this.closed !== undefined) throw this.closed
    if (signal.aborted) return
    if (this.streams.size >= this.maxOpenStreams) {
      throw new Error(`VS Code bridge open stream limit ${String(this.maxOpenStreams)} reached`)
    }
    const id = this.createStreamId()
    if (this.streams.has(id)) throw new Error(`duplicate VS Code stream id ${id}`)
    const active: ActiveStream = {
      id, parser, onOpen, inbox: [], wake: undefined,
      opened: false, locallyClosed: false, terminal: false,
    }
    this.streams.set(id, active)
    const onAbort = (): void => { this.closeLocalStream(active) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      try {
        await this.sendFrame(createOpenFrame(id))
      } catch (error) {
        active.terminal = true
        this.streams.delete(id)
        throw error
      }
      if (isAborted(signal)) this.closeLocalStream(active)
      while (true) {
        while (active.inbox.length > 0) {
          const item = active.inbox.shift() as StreamItem
          if (item.kind === 'end') return
          if (item.kind === 'error') throw item.error
          yield item.envelope as RpcRequest<F>
        }
        await new Promise<void>((resolve) => { active.wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      if (!active.terminal) this.closeLocalStream(active)
    }
  }

  private receive(value: unknown): void {
    if (this.closed !== undefined) return
    const generation = this.generation
    const decoder = this.decoder
    const operation = this.inboundTail.then(async () => {
      if (!this.acceptsInboundGeneration(generation)) return
      const frame = await decoder.accept(value)
      if (!this.acceptsInboundGeneration(generation)) return
      if (frame !== undefined) this.acceptFrame(frame)
    })
    this.inboundTail = operation.catch((error: unknown) => {
      if (generation === this.generation) this.terminate(error)
    })
  }

  private acceptsInboundGeneration(generation: number): boolean {
    return this.closed === undefined && generation === this.generation
  }

  private acceptIdeEvent(event: IdeEvent): void {
    if (event.event !== 'runtime.state') return
    if (event.payload.state === 'ready') {
      this.runtimeReady = true
      return
    }
    if (event.payload.state === 'stopping' || event.payload.state === 'restarting' || event.payload.state === 'failed') {
      this.resetGeneration(event.payload.state)
    }
  }

  private resetGeneration(state: 'stopping' | 'restarting' | 'failed'): void {
    this.generation++
    this.runtimeReady = false
    this.runtimeUnavailable = new RuntimeGenerationUnavailableError(`VS Code runtime generation ${state}`)
    this.decoder.dispose()
    this.decoder = new VsCodeWireDecoder({
      maxLogicalRpcBytes: this.port.maxLogicalRpcBytes,
      onViolation: (error) => { this.terminate(error) },
    })
    const error = new Error(`VS Code runtime generation ${state}`)
    for (const pending of this.pending.values()) {
      pending.detachAbort()
      pending.reject(error)
    }
    this.pending.clear()
    this.cancelled.clear()
    for (const active of this.streams.values()) {
      active.terminal = true
      this.enqueue(active, { kind: 'end' })
    }
    this.streams.clear()
  }

  private acceptFrame(frame: VsCodeCarrierFrame): void {
    switch (frame.type) {
      case 'rpc/message':
        if (frame.message.type !== 'server-response') {
          this.terminate(new Error(`${frame.message.type} is not a correlated VS Code downlink response`))
          return
        }
        this.settlePending(frame.message.rpcId, 'response', frame.message)
        return
      case 'rpc/receipt':
        this.settlePending(frame.rpcId, 'receipt', frame.receipt)
        return
      case 'stream/opened':
        this.openedStream(frame.streamId)
        return
      case 'stream/frame':
        this.pushStreamFrame(frame.streamId, frame.message)
        return
      case 'stream/end':
        this.finishStream(frame.streamId, { kind: 'end' })
        return
      case 'stream/error':
        this.finishStream(frame.streamId, { kind: 'error', error: new Error(frame.message) })
        return
      case 'control/error':
        this.terminate(new Error(`VS Code companion ${frame.code}: ${frame.message}`))
        return
      case 'control/hello':
      case 'control/ready':
      case 'control/shutdown':
      case 'control/shutdown-complete':
      case 'stream/open':
      case 'stream/close':
        this.terminate(new Error(`${frame.type} is not accepted from the VS Code downlink`))
    }
  }

  private settlePending(rpcId: RpcId, kind: PendingKind, value: ServerResponse | RpcReceipt): void {
    if (this.cancelled.delete(rpcId)) return
    const pending = this.pending.get(rpcId)
    if (pending === undefined) {
      this.terminate(new Error(`uncorrelated VS Code ${kind} for rpcId ${rpcId}`))
      return
    }
    if (pending.kind !== kind) {
      this.terminate(new Error(`VS Code rpcId ${rpcId} expected ${pending.kind}, received ${kind}`))
      return
    }
    this.pending.delete(rpcId)
    pending.detachAbort()
    pending.resolve(value)
  }

  private openedStream(id: VsCodeStreamIdType): void {
    const active = this.streams.get(id)
    if (active === undefined || active.opened) {
      this.terminate(new Error(`unexpected stream/opened for ${id}`))
      return
    }
    active.opened = true
    if (!active.locallyClosed) active.onOpen?.()
  }

  private pushStreamFrame(id: VsCodeStreamIdType, message: Extract<RpcMessage, { type: 'server-request' }>): void {
    const active = this.streams.get(id)
    if (active === undefined || !active.opened) {
      this.terminate(new Error(`unexpected stream/frame for ${id}`))
      return
    }
    let payload: MuxFrame | HostFrame
    try {
      payload = active.parser.parse(message.payload)
    } catch (error) {
      this.terminate(error)
      return
    }
    this.onEnvelope(message)
    if (!active.locallyClosed) this.enqueue(active, {
      kind: 'frame', envelope: { rpcId: message.rpcId, payload },
    })
  }

  private finishStream(id: VsCodeStreamIdType, item: Extract<StreamItem, { kind: 'end' | 'error' }>): void {
    const active = this.streams.get(id)
    if (active === undefined) {
      this.terminate(new Error(`unexpected stream terminal frame for ${id}`))
      return
    }
    active.terminal = true
    this.streams.delete(id)
    if (!active.locallyClosed) this.enqueue(active, item)
  }

  private closeLocalStream(active: ActiveStream): void {
    if (active.locallyClosed || active.terminal) return
    active.locallyClosed = true
    this.enqueue(active, { kind: 'end' })
    void this.sendFrame({ type: 'stream/close', streamId: active.id }).catch(() => {})
  }

  private enqueue(active: ActiveStream, item: StreamItem): void {
    active.inbox.push(item)
    active.wake?.()
    active.wake = undefined
  }

  private sendFrame(frame: VsCodeCarrierFrame): Promise<void> {
    const generation = this.generation
    const operation = this.outboundTail.then(async () => {
      if (this.closed !== undefined) throw this.closed
      if (generation !== this.generation) throw new Error('VS Code runtime generation changed before send')
      if (!this.runtimeReady) throw this.runtimeUnavailable
      await sendVsCodeFrame(frame, record => this.port.send(record), {
        maxLogicalRpcBytes: this.port.maxLogicalRpcBytes,
      })
    })
    this.outboundTail = operation.catch((error: unknown) => {
      if (generation === this.generation && !(error instanceof RuntimeGenerationUnavailableError)) {
        this.terminate(error)
      }
    })
    return operation
  }

  private rememberCancelled(rpcId: RpcId): void {
    if (this.cancelled.size >= this.maxPendingRequests) {
      const oldest = this.cancelled.values().next().value as RpcId
      this.cancelled.delete(oldest)
    }
    this.cancelled.add(rpcId)
  }

  private terminate(reason: unknown): void {
    if (this.closed !== undefined) return
    const error = reason instanceof Error ? reason : new Error(String(reason))
    this.closed = error
    this.decoder.dispose()
    this.unsubscribe()
    this.unsubscribeRuntime()
    for (const pending of this.pending.values()) {
      pending.detachAbort()
      pending.reject(error)
    }
    this.pending.clear()
    this.cancelled.clear()
    for (const active of this.streams.values()) {
      active.terminal = true
      this.enqueue(active, { kind: 'error', error })
    }
    this.streams.clear()
  }
}
