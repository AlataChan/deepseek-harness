/** Narrow physical-record port supplied by the trusted VS Code Webview shell. */

import type { VsCodeWireRecord } from '../protocol.ts'

/** Browser-side carrier port; the raw VS Code API remains owned by the shell. */
export interface VsCodeBridgePort {
  /** Logical RPC capacity announced by the companion handshake. */
  readonly maxLogicalRpcBytes: number
  /** Deliver one validated physical record through the extension host. */
  send(record: VsCodeWireRecord): Promise<void>
  /** Subscribe to untrusted physical records arriving from the extension host. */
  subscribe(listener: (value: unknown) => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Private VS Code Webview bridge installed by the shell before Client Plugin boot. */
    vscodeBridge: VsCodeBridgePort
  }
}
