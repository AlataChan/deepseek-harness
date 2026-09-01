/** Typert transport over the bounded process-carrier bridge. */

import type { ClientRequest, RpcId, ServerResponse } from '@deepseek-ai/dsh-client-connection/client'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { sendVsCodeFrame, VsCodeWireDecoder } from '../codec.ts'
import {
  VsCodeStreamId,
  type VsCodeCarrierFrame,
  type VsCodeStreamId as VsCodeStreamIdType,
  type VsCodeWireRecord,
} from '../protocol.ts'

/** Browser-side carrier port; the raw shell API remains owned by the surface. */
export interface ProcessBridgePort {
  /** Logical RPC capacity announced by the companion handshake. */
  readonly maxLogicalRpcBytes: number
  /**
   * Deliver one validated physical record through the surface shell.
   * @param record - physical wire record.
   * @returns settled after the shell accepts the record.
   */
  send(record: VsCodeWireRecord): Promise<void>
  /**
   * Subscribe to untrusted physical records arriving from the surface shell.
   * @param listener - receives each inbound value.
   * @returns disposer for this subscription.
   */
  subscribe(listener: (value: unknown) => void): () => void
}

/** Default bounded unary deadline inherited by surface configuration. */
export const DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS = 30_000

/** Session remote that runs sidecar convert, LLM propose, and apply. */
export const ASK_KNOWLEDGE_FINISH_INGEST_METHOD = 'session/finishAskKnowledgeIngest'

/**
 * Unary deadline for {@link ASK_KNOWLEDGE_FINISH_INGEST_METHOD}.
 * The Host call includes recover, ingest-file, propose (LLM default 60s), and apply.
 */
export const ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS = 180_000

/** Session remote that runs sidecar convert-file without propose. */
export const ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD = 'session/finishAskKnowledgeExtract'

/**
 * Unary deadline for {@link ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD}.
 * Convert-file has no LLM propose step; a large PDF can still take tens of seconds.
 */
export const ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS = 90_000

/**
 * Resolve the unary deadline for one desktop/VS Code RPC method.
 * @param method - Connection remote method, for example `session/listAskKnowledgeLibraries`.
 * @param defaultMs - surface default, usually {@link DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS}.
 * @returns milliseconds until the client rejects the pending request.
 */
export function unaryResponseTimeoutMs(method: string, defaultMs: number): number {
  if (method === ASK_KNOWLEDGE_FINISH_INGEST_METHOD) {
    return defaultMs > ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS
      ? defaultMs
      : ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS
  }
  if (method === ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD) {
    return defaultMs > ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS
      ? defaultMs
      : ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS
  }
  return defaultMs
}

/** Default maximum requests awaiting correlated downlink responses. */
export const DEFAULT_VSCODE_MAX_PENDING_REQUESTS = 256

/** Default maximum streams retained across open and close handshakes. */
export const DEFAULT_VSCODE_MAX_OPEN_STREAMS = 16

/** Deterministic limits and id source for one process-carrier transport. */
export interface ProcessTransportOptions {
  /** Unary response deadline in milliseconds. */
  responseTimeoutMs?: number
  /** Maximum simultaneous unary correlations. */
  maxPendingRequests?: number
  /** Maximum stream records awaiting a terminal downlink frame. */
  maxOpenStreams?: number
  /** Stream id source; production uses `@deepseek-ai/dsh-util-crypto`. */
  createStreamId?: () => VsCodeStreamIdType
}

interface PendingRequest {
  readonly resolve: (value: ServerResponse) => void
  readonly reject: (error: Error) => void
  readonly detachAbort: () => void
  readonly timer: ReturnType<typeof setTimeout>
}

type StreamItem =
  | { kind: 'value'; value: unknown }
  | { kind: 'end' }
  | { kind: 'error'; error: Error }

interface ActiveStream {
  readonly id: VsCodeStreamIdType
  readonly inbox: StreamItem[]
  wake: (() => void) | undefined
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
  return VsCodeStreamId(randomUUID())
}

/** Process carrier implementing Connection `__DSH_TRANSPORT__` fetch and stream open. */
export class ProcessTransport {
  private decoder: VsCodeWireDecoder
  private readonly responseTimeoutMs: number
  private readonly maxPendingRequests: number
  private readonly maxOpenStreams: number
  private readonly createStreamId: () => VsCodeStreamIdType
  private readonly pending = new Map<string, PendingRequest>()
  private readonly streams = new Map<VsCodeStreamIdType, ActiveStream>()
  private inboundTail: Promise<void> = Promise.resolve()
  private outboundTail: Promise<void> = Promise.resolve()
  private readonly unsubscribe: () => void
  private closed: Error | undefined

  /**
   * Attach one transport to a shell-owned bridge port.
   * @param port - physical record delivery and subscription port.
   * @param options - bounded correlation, stream, timeout, and id settings.
   */
  constructor(
    private readonly port: ProcessBridgePort,
    options: ProcessTransportOptions = {},
  ) {
    this.responseTimeoutMs = positiveInteger(
      options.responseTimeoutMs ?? DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS,
      'responseTimeoutMs',
    )
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
  }

  /**
   * Unary Fetch for Connection RPC. The body must be a `client-request` envelope.
   * @param _input - unused URL; the method lives in the JSON body.
   * @param init - POST body and optional abort signal.
   */
  fetch(_input: URL | string, init?: RequestInit): Promise<Response> {
    if (typeof init?.body !== 'string') {
      return Promise.reject(new Error('desktop API request body must be JSON text'))
    }
    let message: ClientRequest
    try {
      const parsed: unknown = JSON.parse(init.body)
      if (
        typeof parsed !== 'object' || parsed === null
        || (parsed as { type?: unknown }).type !== 'client-request'
        || typeof (parsed as { rpcId?: unknown }).rpcId !== 'string'
        || typeof (parsed as { method?: unknown }).method !== 'string'
      ) {
        return Promise.reject(new Error('desktop API request body is invalid'))
      }
      message = parsed as ClientRequest
    } catch (error) {
      return Promise.reject(new Error('desktop API request body is invalid', { cause: error }))
    }
    return this.request(message, init.signal ?? undefined).then(value => new Response(JSON.stringify(value), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }

  /**
   * Open one Typert Remote stream through the process carrier.
   * @param endpoint - canonical Remote endpoint.
   * @param payload - decoded carrier payload.
   * @param signal - caller cancellation.
   */
  async *openStream(endpoint: string, payload: unknown, signal: AbortSignal): AsyncGenerator<unknown> {
    if (this.closed !== undefined) throw this.closed
    if (signal.aborted) return
    if (this.streams.size >= this.maxOpenStreams) {
      throw new Error(`desktop bridge open stream limit ${String(this.maxOpenStreams)} reached`)
    }
    const id = this.createStreamId()
    if (this.streams.has(id)) throw new Error(`duplicate desktop stream id ${id}`)
    const active: ActiveStream = {
      id, inbox: [], wake: undefined, locallyClosed: false, terminal: false,
    }
    this.streams.set(id, active)
    const onAbort = (): void => { this.closeLocalStream(active) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      try {
        await this.sendFrame({ type: 'stream/open', streamId: id, endpoint, payload })
      } catch (error) {
        active.terminal = true
        this.streams.delete(id)
        throw error
      }
      if (signal.aborted) this.closeLocalStream(active)
      while (true) {
        while (active.inbox.length > 0) {
          const item = active.inbox.shift() as StreamItem
          if (item.kind === 'end') return
          if (item.kind === 'error') throw item.error
          yield item.value
        }
        await new Promise<void>((resolve) => { active.wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      if (!active.terminal) this.closeLocalStream(active)
    }
  }

  /** Permanently stop this transport and reject every owned operation. */
  dispose(): void {
    this.terminate(new Error('desktop API transport is closed'))
  }

  private request(message: ClientRequest, signal: AbortSignal | undefined): Promise<ServerResponse> {
    if (this.closed !== undefined) return Promise.reject(this.closed)
    if (signal?.aborted === true) return Promise.reject(abortError(signal))
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(new Error(`desktop bridge pending request limit ${String(this.maxPendingRequests)} reached`))
    }
    if (this.pending.has(message.rpcId)) return Promise.reject(new Error(`duplicate pending rpcId ${message.rpcId}`))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.pending.get(message.rpcId)
        if (pending === undefined) return
        this.pending.delete(message.rpcId)
        clearTimeout(pending.timer)
        pending.detachAbort()
        reject(abortError(signal as AbortSignal))
      }
      const detachAbort = (): void => { signal?.removeEventListener('abort', onAbort) }
      const timer = setTimeout(() => {
        const pending = this.pending.get(message.rpcId)
        if (pending === undefined) return
        this.pending.delete(message.rpcId)
        pending.detachAbort()
        pending.reject(new Error(`desktop API request ${message.method} timed out`))
      }, unaryResponseTimeoutMs(message.method, this.responseTimeoutMs))
      this.pending.set(message.rpcId, { resolve, reject, detachAbort, timer })
      signal?.addEventListener('abort', onAbort, { once: true })
      void this.sendFrame({ type: 'rpc/message', message }).catch((error: unknown) => {
        const pending = this.pending.get(message.rpcId)
        if (pending === undefined) return
        this.pending.delete(message.rpcId)
        clearTimeout(pending.timer)
        pending.detachAbort()
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  private receive(value: unknown): void {
    if (this.closed !== undefined) return
    const decoder = this.decoder
    const operation = this.inboundTail.then(async () => {
      if (this.closed !== undefined) return
      const frame = await decoder.accept(value)
      if (this.closed !== undefined) return
      if (frame !== undefined) this.acceptFrame(frame)
    })
    this.inboundTail = operation.catch((error: unknown) => {
      this.terminate(error)
    })
  }

  private acceptFrame(frame: VsCodeCarrierFrame): void {
    switch (frame.type) {
      case 'rpc/message':
        if (frame.message.type !== 'server-response') {
          this.terminate(new Error(`${frame.message.type} is not a correlated desktop downlink response`))
          return
        }
        this.settlePending(frame.message.rpcId, frame.message)
        return
      case 'stream/opened':
        return
      case 'stream/frame':
        this.pushStreamValue(frame.streamId, frame.value)
        return
      case 'stream/end':
        this.finishStream(frame.streamId, { kind: 'end' })
        return
      case 'stream/error':
        this.finishStream(frame.streamId, { kind: 'error', error: new Error(frame.message) })
        return
      case 'control/error':
        this.terminate(new Error(`desktop companion ${frame.code}: ${frame.message}`))
        return
      case 'control/hello':
      case 'control/ready':
      case 'control/shutdown':
      case 'control/shutdown-complete':
      case 'stream/open':
      case 'stream/close':
        this.terminate(new Error(`${frame.type} is not accepted from the desktop downlink`))
    }
  }

  private settlePending(rpcId: RpcId, value: ServerResponse): void {
    const pending = this.pending.get(rpcId)
    if (pending === undefined) return
    this.pending.delete(rpcId)
    clearTimeout(pending.timer)
    pending.detachAbort()
    pending.resolve(value)
  }

  private pushStreamValue(id: VsCodeStreamIdType, value: unknown): void {
    const active = this.streams.get(id)
    if (active === undefined || active.terminal) return
    this.enqueue(active, { kind: 'value', value })
  }

  private finishStream(id: VsCodeStreamIdType, item: Extract<StreamItem, { kind: 'end' | 'error' }>): void {
    const active = this.streams.get(id)
    if (active === undefined) return
    active.terminal = true
    this.streams.delete(id)
    this.enqueue(active, item)
  }

  private closeLocalStream(active: ActiveStream): void {
    if (active.locallyClosed || active.terminal) return
    active.locallyClosed = true
    void this.sendFrame({ type: 'stream/close', streamId: active.id }).catch(() => {})
  }

  private enqueue(active: ActiveStream, item: StreamItem): void {
    active.inbox.push(item)
    active.wake?.()
    active.wake = undefined
  }

  private sendFrame(frame: VsCodeCarrierFrame): Promise<void> {
    if (this.closed !== undefined) return Promise.reject(this.closed)
    const operation = this.outboundTail.then(() => sendVsCodeFrame(frame, record => this.port.send(record)))
    this.outboundTail = operation.catch((error: unknown) => { this.terminate(error) })
    return operation
  }

  private terminate(error: unknown): void {
    if (this.closed !== undefined) return
    this.closed = error instanceof Error ? error : new Error(String(error))
    this.unsubscribe()
    this.decoder.dispose()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.detachAbort()
      pending.reject(this.closed)
    }
    this.pending.clear()
    for (const active of this.streams.values()) {
      active.terminal = true
      this.enqueue(active, { kind: 'error', error: this.closed })
    }
    this.streams.clear()
  }
}

/** @deprecated Use {@link ProcessTransport}. */
export const ProcessApiClient = ProcessTransport
