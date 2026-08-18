/** Deterministic physical-record bridge used by VS Code client tests. */

import { sendVsCodeFrame, VsCodeWireDecoder } from '../src/codec.ts'
import type { VsCodeBridgePort } from '../src/client/bridge-port.ts'
import type { VsCodeCarrierFrame, VsCodeWireRecord } from '../src/protocol.ts'

/** In-memory Webview port that exposes decoded outbound frames to a scripted Host. */
export class BridgeHarness implements VsCodeBridgePort {
  readonly sent: VsCodeCarrierFrame[] = []
  onFrame: ((frame: VsCodeCarrierFrame) => void | Promise<void>) | undefined
  sendFailure: unknown = undefined
  private readonly listeners = new Set<(value: unknown) => void>()
  private readonly outbound: VsCodeWireDecoder

  /** @param maxLogicalRpcBytes - carrier capacity exposed to the client. */
  constructor(readonly maxLogicalRpcBytes = 4096) {
    this.outbound = new VsCodeWireDecoder({ maxLogicalRpcBytes })
  }

  /** Decode one Webview record and pass a complete frame to the script. */
  async send(record: VsCodeWireRecord): Promise<void> {
    if (this.sendFailure !== undefined) throw this.sendFailure
    const frame = await this.outbound.accept(record)
    if (frame === undefined) return
    this.sent.push(frame)
    await this.onFrame?.(frame)
  }

  /** Register one raw-record listener. */
  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Encode and deliver one logical Host frame. */
  async receive(frame: VsCodeCarrierFrame): Promise<void> {
    await sendVsCodeFrame(frame, async (record) => {
      for (const listener of [...this.listeners]) listener(record)
    }, { maxLogicalRpcBytes: this.maxLogicalRpcBytes })
  }

  /** Deliver one raw untrusted value without encoding it first. */
  emitRaw(value: unknown): void {
    for (const listener of [...this.listeners]) listener(value)
  }
}
