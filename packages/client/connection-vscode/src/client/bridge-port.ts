/** Narrow physical-record port supplied by the trusted VS Code Webview shell. */

import type {
  IdeEvent,
  IdeMethodMap,
  VsCodeWireRecord,
} from '../protocol.ts'

/** Browser-side carrier port; the raw VS Code API remains owned by the shell. */
export interface VsCodeBridgePort {
  /** Logical RPC capacity announced by the companion handshake. */
  readonly maxLogicalRpcBytes: number
  /** Deliver one validated physical record through the extension host. */
  send(record: VsCodeWireRecord): Promise<void>
  /** Subscribe to untrusted physical records arriving from the extension host. */
  subscribe(listener: (value: unknown) => void): () => void
}

/** Typed editor-method and event port supplied beside the carrier. */
export interface VsCodeIdePort {
  /**
   * Call one extension-owned IDE method.
   * @param method - declared method name.
   * @param payload - exact method payload.
   * @returns exact correlated result.
   */
  request<K extends keyof IdeMethodMap>(
    method: K,
    payload: IdeMethodMap[K]['payload'],
  ): Promise<IdeMethodMap[K]['result']>
  /**
   * Register one Webview-owned method handler.
   * @param method - declared method name.
   * @param handler - exact payload/result handler.
   * @returns disposer for this exact handler.
   */
  handle<K extends keyof IdeMethodMap>(
    method: K,
    handler: (payload: IdeMethodMap[K]['payload']) => IdeMethodMap[K]['result'] | Promise<IdeMethodMap[K]['result']>,
  ): () => void
  /** Subscribe to parsed extension-initiated IDE events. */
  subscribeEvents(listener: (event: IdeEvent) => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Private VS Code Webview bridge installed by the shell before Client Plugin boot. */
    vscodeBridge: VsCodeBridgePort
    /** Typed VS Code editor-method port; it exposes no arbitrary command execution. */
    vscodeIde: VsCodeIdePort
  }
}
