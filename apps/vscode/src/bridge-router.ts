/** Validated Webview routing and verified Client bundle cache. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  MAX_IDE_MESSAGE_BYTES,
  MAX_WIRE_RECORD_BYTES,
  IdeRequestId,
  ideResponseSchema,
  vsCodeWireRecordSchema,
  webviewBridgeMessageSchema,
  type ControlReadyFrame,
  type IdeMethodMap,
  type IdeRequest,
  type IdeResponse,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
  type WebviewBridgeMessage,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import {
  sendVsCodeFrame,
  VsCodeWireDecoder,
  type WireCodecOptions,
} from '@deepseek-ai/dsh-client-connection-vscode/codec'
import type { HostRpcRouting } from './host-rpc-interceptor.ts'

const textEncoder = new TextEncoder()
const IDE_ENVELOPE_HEADROOM_BYTES = 64 * 1024
const MAX_DIAGNOSTICS = 1_000
const DEFAULT_MAX_PENDING_IDE_REQUESTS = 32
const DEFAULT_IDE_REQUEST_TIMEOUT_MS = 10_000

/** Stable companion physical-record port across runtime generations. */
export interface BridgeRecordPort {
  /** Send one parsed physical record to the ready companion. */
  send(record: VsCodeWireRecord): Promise<void>
  /** Subscribe to untrusted companion values. */
  subscribe(listener: (value: unknown) => void): () => void
}

/** Narrow Webview messaging port. */
export interface BridgeWebviewPort {
  /** Deliver one validated outer message with VS Code backpressure. */
  postMessage(message: WebviewBridgeMessage): Promise<boolean>
  /** Subscribe to untrusted Webview values. */
  subscribe(listener: (value: unknown) => void): () => void
}

/** Typed extension-owned handlers; missing methods fail the correlated request. */
export type IdeHandlers = Partial<{
  [K in keyof IdeMethodMap]:
  (payload: IdeMethodMap[K]['payload']) => IdeMethodMap[K]['result'] | Promise<IdeMethodMap[K]['result']>
}>

/** Validated explicit-context settings. */
export interface ContextLimits {
  /** Maximum captured selection UTF-8 bytes. */
  maxSelectionBytes: number
  /** Maximum captured file UTF-8 bytes. */
  maxFileBytes: number
  /** Maximum diagnostic records in one capture. */
  maxDiagnostics: number
}

/** Verified bundle-cache result passed to Webview HTML construction. */
export interface CachedClientGraph {
  /** Graph with only cache-backed Webview URLs. */
  graph: ControlReadyFrame['graph']
  /** Sole graph-revision directory granted as a local resource root. */
  resourceRoot: string
}

function serializedBytes(value: unknown): number {
  const serialized: unknown = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new Error('message is not JSON-serializable')
  return textEncoder.encode(serialized).byteLength
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}

/**
 * Validate context settings against the fixed IDE-message capacity.
 * @param limits - user-configurable capture limits.
 * @returns the same accepted values.
 */
export function validateContextLimits(limits: ContextLimits): ContextLimits {
  const payloadLimit = MAX_IDE_MESSAGE_BYTES - IDE_ENVELOPE_HEADROOM_BYTES
  const maxSelectionBytes = positiveSafeInteger(limits.maxSelectionBytes, 'maxSelectionBytes')
  const maxFileBytes = positiveSafeInteger(limits.maxFileBytes, 'maxFileBytes')
  const maxDiagnostics = positiveSafeInteger(limits.maxDiagnostics, 'maxDiagnostics')
  if (maxSelectionBytes > payloadLimit) {
    throw new RangeError(`selection limit cannot fit the fixed ${String(MAX_IDE_MESSAGE_BYTES)}-byte IDE message`)
  }
  if (maxFileBytes > payloadLimit) {
    throw new RangeError(`file limit cannot fit the fixed ${String(MAX_IDE_MESSAGE_BYTES)}-byte IDE message`)
  }
  if (maxDiagnostics > MAX_DIAGNOSTICS) {
    throw new RangeError(`diagnostics limit cannot exceed ${String(MAX_DIAGNOSTICS)}`)
  }
  return { maxSelectionBytes, maxFileBytes, maxDiagnostics }
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Verify and copy one ready graph into an extension-owned revision directory.
 * Nothing becomes Webview-readable until every announced source passes.
 * @param frame - parsed companion ready frame.
 * @param cacheRoot - extension global-storage bundle root.
 * @param toWebviewUri - conversion applied only to verified destinations.
 * @returns cache resource root and graph with cache-only URLs.
 */
export async function cacheVerifiedBundles(
  frame: ControlReadyFrame,
  cacheRoot: string,
  toWebviewUri: (path: string) => string,
): Promise<CachedClientGraph> {
  if (frame.graph.entries.length !== frame.bundles.length) {
    throw new Error('VS Code bundle locations do not match the ready graph entry count')
  }
  const locations = new Map<string, (typeof frame.bundles)[number]>()
  for (const location of frame.bundles) {
    if (locations.has(location.id)) throw new Error(`duplicate VS Code bundle location for ${location.id}`)
    locations.set(location.id, location)
  }
  const verified: { destination: string; bytes: Uint8Array }[] = []
  const resourceRoot = join(cacheRoot, sha256(frame.graph.rev))
  const entries = [] as ControlReadyFrame['graph']['entries']
  for (const [index, entry] of frame.graph.entries.entries()) {
    const location = locations.get(entry.id)
    if (location === undefined || location.rev !== entry.rev) {
      throw new Error(`VS Code bundle ${entry.id}@${entry.rev} has no exact announced location`)
    }
    if (!isAbsolute(location.sourcePath)) throw new Error(`VS Code bundle source path is not absolute: ${location.sourcePath}`)
    const bytes = await readFile(location.sourcePath)
    if (sha256(bytes) !== location.sha256) throw new Error(`VS Code bundle hash mismatch for ${entry.id}`)
    const destination = join(resourceRoot, `${String(index)}-${sha256(entry.id).slice(0, 16)}.js`)
    verified.push({ destination, bytes })
    entries.push({ ...entry, url: toWebviewUri(destination) })
  }
  await mkdir(resourceRoot, { recursive: true, mode: 0o700 })
  for (const item of verified) {
    const temporary = `${item.destination}.${randomUUID()}.tmp`
    await writeFile(temporary, item.bytes, { mode: 0o600 })
    await rename(temporary, item.destination)
  }
  return { resourceRoot, graph: { rev: frame.graph.rev, entries } }
}

/** Validated two-way carrier relay plus exact IDE method dispatch. */
export class BridgeRouter {
  private readonly runtime: BridgeRecordPort
  private readonly webview: BridgeWebviewPort
  private readonly handlers: IdeHandlers
  private readonly onViolation: (error: Error) => void
  private readonly maxPending: number
  private readonly hostRpc: HostRpcRouting | undefined
  private readonly codecOptions: WireCodecOptions
  private readonly webviewDecoder: VsCodeWireDecoder | undefined
  private readonly runtimeDecoder: VsCodeWireDecoder | undefined
  private readonly lifecycle = new AbortController()
  private readonly pending = new Set<string>()
  private readonly webviewRequests = new Map<string, {
    method: keyof IdeMethodMap
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private readonly disposers: (() => void)[]
  private webviewTail = Promise.resolve()
  private runtimeTail = Promise.resolve()
  private downlinkTail = Promise.resolve()
  private closed = false

  /** @param options - stable runtime port, one Webview, typed handlers, and limits. */
  constructor(options: {
    runtime: BridgeRecordPort
    webview: BridgeWebviewPort
    ideHandlers?: IdeHandlers
    hostRpc?: HostRpcRouting
    maxLogicalRpcBytes?: number
    onViolation?: (error: Error) => void
    maxPendingIdeRequests?: number
  }) {
    this.runtime = options.runtime
    this.webview = options.webview
    this.handlers = options.ideHandlers ?? {}
    this.hostRpc = options.hostRpc
    this.codecOptions = options.maxLogicalRpcBytes === undefined
      ? {}
      : { maxLogicalRpcBytes: positiveSafeInteger(options.maxLogicalRpcBytes, 'maxLogicalRpcBytes') }
    this.webviewDecoder = this.hostRpc === undefined ? undefined : new VsCodeWireDecoder(this.codecOptions)
    this.runtimeDecoder = this.hostRpc === undefined ? undefined : new VsCodeWireDecoder(this.codecOptions)
    this.onViolation = options.onViolation ?? (() => {})
    this.maxPending = positiveSafeInteger(
      options.maxPendingIdeRequests ?? DEFAULT_MAX_PENDING_IDE_REQUESTS,
      'maxPendingIdeRequests',
    )
    this.disposers = [
      this.runtime.subscribe((value) => { this.receiveRuntime(value) }),
      this.webview.subscribe((value) => { this.receiveWebview(value) }),
    ]
  }

  /** Send one typed extension-initiated IDE event. */
  sendEvent(message: Extract<WebviewBridgeMessage, { type: 'ide/event' }>): Promise<void> {
    const parsed = webviewBridgeMessageSchema.parse(message)
    return this.enqueueWebview(parsed)
  }

  /**
   * Call one typed method implemented inside the retained Webview.
   * @param method - declared method name.
   * @param payload - exact method payload.
   * @returns exact correlated method result.
   */
  requestWebview<K extends keyof IdeMethodMap>(
    method: K,
    payload: IdeMethodMap[K]['payload'],
  ): Promise<IdeMethodMap[K]['result']> {
    if (this.closed) return Promise.reject(new Error('VS Code bridge router is closed'))
    if (this.webviewRequests.size >= this.maxPending) {
      return Promise.reject(new Error(`pending Webview request limit ${String(this.maxPending)} reached`))
    }
    const requestId = IdeRequestId(randomUUID())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.webviewRequests.delete(requestId)
        reject(new Error(`Webview IDE method ${method} timed out`))
      }, DEFAULT_IDE_REQUEST_TIMEOUT_MS)
      this.webviewRequests.set(requestId, {
        method,
        resolve: (value) => { resolve(value as IdeMethodMap[K]['result']) },
        reject,
        timer,
      })
      void this.enqueueWebview({ type: 'ide/request', requestId, method, payload })
        .catch((error: unknown) => {
          clearTimeout(timer)
          this.webviewRequests.delete(requestId)
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
  }

  /** Permanently stop routing and ignore late asynchronous completions. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.lifecycle.abort()
    for (const dispose of this.disposers.splice(0)) dispose()
    this.webviewDecoder?.dispose()
    this.runtimeDecoder?.dispose()
    this.hostRpc?.dispose()
    this.pending.clear()
    for (const request of this.webviewRequests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('VS Code bridge router is closed'))
    }
    this.webviewRequests.clear()
  }

  private receiveRuntime(value: unknown): void {
    if (this.closed) return
    try {
      const record = vsCodeWireRecordSchema.parse(value)
      if (serializedBytes(record) > MAX_WIRE_RECORD_BYTES) throw new Error('companion physical record exceeds the fixed limit')
      if (this.hostRpc === undefined) {
        void this.enqueueWebview({ type: 'carrier', record })
        return
      }
      const operation = this.downlinkTail.then(() => this.routeRuntimeRecord(record))
      this.downlinkTail = operation.catch((error: unknown) => { this.violate(error) })
    } catch (error) {
      this.violate(error)
    }
  }

  private receiveWebview(value: unknown): void {
    if (this.closed) return
    let message: WebviewBridgeMessage
    try {
      if (serializedBytes(value) > MAX_IDE_MESSAGE_BYTES) throw new Error('Webview message exceeds the fixed IDE-message limit')
      message = webviewBridgeMessageSchema.parse(value)
    } catch (error) {
      this.violate(error)
      return
    }
    if (message.type === 'carrier') {
      if (serializedBytes(message.record) > MAX_WIRE_RECORD_BYTES) {
        this.violate(new Error('Webview physical record exceeds the fixed limit'))
        return
      }
      const operation = this.runtimeTail.then(() => this.hostRpc === undefined
        ? this.runtime.send(message.record)
        : this.routeWebviewRecord(message.record))
      this.runtimeTail = operation.catch((error: unknown) => { this.violate(error) })
      return
    }
    if (message.type === 'ide/response') {
      this.acceptWebviewResponse(message)
      return
    }
    if (message.type !== 'ide/request') {
      this.violate(new Error(`${message.type} is not accepted from the Webview`))
      return
    }
    void this.dispatchIde(message)
  }

  private acceptWebviewResponse(response: IdeResponse): void {
    const pending = this.webviewRequests.get(response.requestId)
    if (pending === undefined || pending.method !== response.method) {
      this.violate(new Error(`uncorrelated Webview IDE response ${response.requestId} for ${response.method}`))
      return
    }
    this.webviewRequests.delete(response.requestId)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error))
  }

  private async dispatchIde(request: IdeRequest): Promise<void> {
    if (this.pending.size >= this.maxPending) {
      await this.sendFailure(request, `pending IDE request limit ${String(this.maxPending)} reached`)
      return
    }
    if (this.pending.has(request.requestId)) {
      this.violate(new Error(`duplicate IDE request id ${request.requestId}`))
      return
    }
    this.pending.add(request.requestId)
    try {
      const table = this.handlers as Record<string, ((payload: unknown) => unknown) | undefined>
      const handler = table[request.method]
      if (handler === undefined) {
        await this.sendFailure(request, `IDE method ${request.method} is unavailable`)
        return
      }
      const result = await handler(request.payload)
      const response = ideResponseSchema.parse({
        type: 'ide/response', requestId: request.requestId, method: request.method, ok: true, result,
      })
      await this.enqueueWebview(response)
    } catch (error) {
      await this.sendFailure(request, error instanceof Error ? error.message : String(error))
    } finally {
      this.pending.delete(request.requestId)
    }
  }

  private sendFailure(request: IdeRequest, error: string): Promise<void> {
    const response = ideResponseSchema.parse({
      type: 'ide/response', requestId: request.requestId, method: request.method, ok: false, error,
    })
    return this.enqueueWebview(response)
  }

  private async routeWebviewRecord(record: VsCodeWireRecord): Promise<void> {
    const decoder = this.webviewDecoder
    const hostRpc = this.hostRpc
    if (decoder === undefined || hostRpc === undefined) throw new Error('Host RPC routing is unavailable')
    const frame = await decoder.accept(record)
    if (frame === undefined) return
    if (frame.type === 'rpc/message' && frame.message.type === 'client-request') {
      const response = await hostRpc.interceptRequest(frame.message, this.lifecycle.signal)
      if (response !== undefined) {
        await this.sendCarrierFrame({ type: 'rpc/message', message: response })
        return
      }
    }
    if (record.type === 'wire/message') {
      await this.runtime.send(record)
      return
    }
    await sendVsCodeFrame(frame, item => this.runtime.send(item), this.codecOptions)
  }

  private async routeRuntimeRecord(record: VsCodeWireRecord): Promise<void> {
    const decoder = this.runtimeDecoder
    const hostRpc = this.hostRpc
    if (decoder === undefined || hostRpc === undefined) throw new Error('Host RPC routing is unavailable')
    const frame = await decoder.accept(record)
    if (frame === undefined) return
    if (frame.type === 'rpc/message' && frame.message.type === 'server-response') {
      const response = hostRpc.interceptResponse(frame.message)
      if (response !== frame.message) {
        await this.sendCarrierFrame({ type: 'rpc/message', message: response })
        return
      }
    }
    if (record.type === 'wire/message') {
      await this.enqueueWebview({ type: 'carrier', record })
      return
    }
    await this.sendCarrierFrame(frame)
  }

  private sendCarrierFrame(frame: VsCodeCarrierFrame): Promise<void> {
    return sendVsCodeFrame(
      frame,
      record => this.enqueueWebview({ type: 'carrier', record }),
      this.codecOptions,
    )
  }

  private enqueueWebview(message: WebviewBridgeMessage): Promise<void> {
    const operation = this.webviewTail.then(async () => {
      if (this.closed) return
      if (serializedBytes(message) > MAX_IDE_MESSAGE_BYTES) {
        throw new Error('extension message exceeds the fixed IDE-message limit')
      }
      if (!await this.webview.postMessage(message)) throw new Error('VS Code Webview rejected a bridge message')
    })
    this.webviewTail = operation.catch((error: unknown) => { this.violate(error) })
    return operation
  }

  private violate(reason: unknown): void {
    if (this.closed) return
    const error = reason instanceof Error ? reason : new Error(String(reason))
    try {
      this.onViolation(error)
    } finally {
      this.dispose()
    }
  }
}
