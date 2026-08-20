/** Private Webview ports over the single acquired VS Code API object. */

import { z } from 'zod'
import type { ClientBootGraph, DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import type {
  VsCodeBridgePort,
  VsCodeIdePort,
} from '@deepseek-ai/dsh-client-connection-vscode/client'
import {
  IdeRequestId,
  ideResponseSchema,
  webviewBridgeMessageSchema,
  type IdeEvent,
  type IdeMethodMap,
  type IdeRequest,
  type IdeResponse,
  type WebviewBridgeMessage,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'

/** The narrow object returned by the global `acquireVsCodeApi` bootstrap. */
export interface AcquiredVsCodeApi {
  /** Send one JSON-serializable message to the extension host. */
  postMessage(message: WebviewBridgeMessage): void
  /** Read Webview-local reload state. */
  getState(): unknown
  /** Replace Webview-local reload state. */
  setState(state: unknown): void
}

/** Parsed Webview boot facts. */
export interface WebviewBoot {
  /** Cache-backed Client Plugin graph. */
  graph: ClientBootGraph
  /** VS Code display locale. */
  locale: string
  /** Companion logical RPC capacity. */
  maxLogicalRpcBytes: number
}

const graphSchema = z.object({
  rev: z.string().min(1),
  entries: z.array(z.object({
    id: z.string().min(1),
    url: z.string().min(1),
    rev: z.string().min(1),
    inject: z.array(z.string()).optional(),
    immediately: z.boolean().optional(),
  }).strict()),
}).strict() as unknown as z.ZodType<ClientBootGraph>

const bootSchema = z.object({
  graph: graphSchema,
  locale: z.string().min(1),
  maxLogicalRpcBytes: z.number().int().positive(),
}).strict() as unknown as z.ZodType<WebviewBoot>

/** Read and validate inert bootstrap metadata without evaluating inline code. */
export function readWebviewBoot(document: Document): WebviewBoot {
  const encoded = document.querySelector<HTMLMetaElement>('meta[name="dsh-vscode-boot"]')?.content
  if (encoded === undefined || encoded === '') throw new Error('VS Code Webview boot metadata is missing')
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return bootSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
}

/** One private carrier port; the raw VS Code API object stays in this closure. */
export class WebviewCarrierPort implements VsCodeBridgePort {
  private readonly listeners = new Set<(value: unknown) => void>()
  private tail = Promise.resolve()
  private readonly onWindowMessage = (event: MessageEvent<unknown>): void => {
    let message: WebviewBridgeMessage
    try {
      message = webviewBridgeMessageSchema.parse(event.data)
    } catch {
      this.dispose()
      return
    }
    if (message.type !== 'carrier') return
    for (const listener of this.listeners) listener(message.record)
  }

  /** @param api - the one object acquired by the bootstrap module. */
  constructor(private readonly api: AcquiredVsCodeApi, readonly maxLogicalRpcBytes: number) {
    window.addEventListener('message', this.onWindowMessage)
  }

  /** @inheritdoc */
  send(record: VsCodeWireRecord): Promise<void> {
    const operation = this.tail.then(() => { this.api.postMessage({ type: 'carrier', record }) })
    this.tail = operation
    return operation
  }

  /** @inheritdoc */
  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Release the window listener and subscribers. */
  dispose(): void {
    window.removeEventListener('message', this.onWindowMessage)
    this.listeners.clear()
  }
}

/** Typed IDE method/event port sharing the same private acquired API object. */
export class WebviewIdePort implements VsCodeIdePort {
  private readonly handlers = new Map<keyof IdeMethodMap, (payload: unknown) => unknown>()
  private readonly eventListeners = new Set<(event: IdeEvent) => void>()
  private readonly pending = new Map<string, {
    method: keyof IdeMethodMap
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private closed = false
  private readonly onWindowMessage = (event: MessageEvent<unknown>): void => {
    if (this.closed) return
    let message: WebviewBridgeMessage
    try {
      message = webviewBridgeMessageSchema.parse(event.data)
    } catch (error) {
      this.dispose(error)
      return
    }
    if (message.type === 'ide/request') void this.acceptRequest(message)
    else if (message.type === 'ide/response') this.acceptResponse(message)
    else if (message.type === 'ide/event') {
      for (const listener of this.eventListeners) listener(message)
    }
  }

  /** @param api - the one object acquired by the bootstrap module. */
  constructor(private readonly api: AcquiredVsCodeApi) {
    window.addEventListener('message', this.onWindowMessage)
  }

  /** @inheritdoc */
  request<K extends keyof IdeMethodMap>(
    method: K,
    payload: IdeMethodMap[K]['payload'],
  ): Promise<IdeMethodMap[K]['result']> {
    if (this.closed) return Promise.reject(new Error('VS Code IDE bridge is closed'))
    if (this.pending.size >= 32) return Promise.reject(new Error('VS Code IDE bridge pending request limit reached'))
    const requestId = IdeRequestId(crypto.randomUUID())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`VS Code IDE method ${method} timed out`))
      }, 10_000)
      this.pending.set(requestId, {
        method,
        resolve: (value) => { resolve(value as IdeMethodMap[K]['result']) },
        reject,
        timer,
      })
      this.api.postMessage({ type: 'ide/request', requestId, method, payload })
    })
  }

  /** @inheritdoc */
  handle<K extends keyof IdeMethodMap>(
    method: K,
    handler: (payload: IdeMethodMap[K]['payload']) => IdeMethodMap[K]['result'] | Promise<IdeMethodMap[K]['result']>,
  ): () => void {
    if (this.handlers.has(method)) throw new Error(`VS Code IDE method ${method} already has a Webview handler`)
    const owned = handler as (payload: unknown) => unknown
    this.handlers.set(method, owned)
    return () => { if (this.handlers.get(method) === owned) this.handlers.delete(method) }
  }

  /** @inheritdoc */
  subscribeEvents(listener: (event: IdeEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  /** Release listeners, method handlers, and pending correlations. */
  dispose(reason: unknown = new Error('VS Code IDE bridge is closed')): void {
    if (this.closed) return
    this.closed = true
    window.removeEventListener('message', this.onWindowMessage)
    const error = reason instanceof Error ? reason : new Error(String(reason))
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.handlers.clear()
    this.eventListeners.clear()
  }

  private async acceptRequest(request: IdeRequest): Promise<void> {
    const handler = this.handlers.get(request.method)
    let response: IdeResponse
    if (handler === undefined) {
      response = ideResponseSchema.parse({
        type: 'ide/response', requestId: request.requestId, method: request.method,
        ok: false, error: `Webview IDE method ${request.method} is unavailable`,
      })
    } else {
      try {
        const result = await handler(request.payload)
        response = ideResponseSchema.parse({
          type: 'ide/response', requestId: request.requestId, method: request.method, ok: true, result,
        })
      } catch (error) {
        response = ideResponseSchema.parse({
          type: 'ide/response', requestId: request.requestId, method: request.method,
          ok: false, error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.api.postMessage(response)
  }

  private acceptResponse(response: IdeResponse): void {
    const pending = this.pending.get(response.requestId)
    if (pending === undefined || pending.method !== response.method) {
      this.dispose(new Error(`uncorrelated VS Code IDE response ${response.requestId}`))
      return
    }
    this.pending.delete(response.requestId)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error))
  }
}

/** Build an external classic-script loader restricted to cache URLs in the boot graph. */
export function createVerifiedBundleLoader(graph: ClientBootGraph): (url: string) => Promise<void> {
  const allowed = new Set(graph.entries.map(entry => entry.url))
  return async (url: string): Promise<void> => {
    if (!allowed.has(url)) throw new Error(`VS Code Webview refused undeclared bundle URL ${url}`)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.async = true
      script.src = url
      script.addEventListener('load', () => { script.remove(); resolve() }, { once: true })
      script.addEventListener('error', () => {
        script.remove()
        reject(new Error(`VS Code Webview bundle ${url} failed to load`))
      }, { once: true })
      document.head.append(script)
    })
  }
}

/** Install the validated graph on the existing shell bootstrap slot. */
export function installBootGraph(graph: ClientBootGraph): void {
  ;(globalThis as DshWindow).__DSH_BOOT__ = graph
}
