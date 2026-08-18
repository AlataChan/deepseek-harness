/** Serialized Node IPC adapter for the bounded VS Code wire codec. */

import { sendVsCodeFrame, VsCodeWireDecoder, type WireCodecOptions } from './codec.ts'
import type { VsCodeCarrierFrame, VsCodeWireRecord } from './protocol.ts'

/** Minimal process-like IPC port used by the companion and deterministic tests. */
export interface NodeIpcPort {
  /** Whether the underlying Node IPC channel remains connected. */
  readonly connected: boolean
  /** Queue one physical record and report when Node has handled its bytes. */
  send(value: unknown, callback: (error: Error | null) => void): boolean
  /** Subscribe to one supported port event. */
  on(event: 'message' | 'disconnect', listener: ((value: unknown) => void) | (() => void)): void
  /** Remove one supported port event subscription. */
  off(event: 'message' | 'disconnect', listener: ((value: unknown) => void) | (() => void)): void
  /** Close the underlying Node IPC channel. */
  disconnect(): void
}

/** Construction ports for one direction-paired companion IPC channel. */
export interface IpcChannelOptions extends Omit<WireCodecOptions, 'onViolation'> {
  /** Raw Node IPC port. */
  port: NodeIpcPort
  /** Serialized logical-frame handler. */
  onFrame: (frame: VsCodeCarrierFrame) => void | Promise<void>
  /** One-shot notification for parsing, handling, or sending failure. */
  onFailure?: (error: Error) => void
  /** One-shot notification when the remote endpoint disconnects. */
  onDisconnect?: () => void
}

/** Node process adapter; it never opens or addresses a numbered file descriptor. */
export class ProcessIpcPort implements NodeIpcPort {
  /** @returns whether the process-level IPC channel remains connected. */
  get connected(): boolean {
    return process.connected
  }

  /** @inheritdoc */
  send(value: unknown, callback: (error: Error | null) => void): boolean {
    if (process.send === undefined) throw new Error('vscode companion requires a connected Node IPC channel')
    return process.send(value, callback)
  }

  /** @inheritdoc */
  on(event: 'message' | 'disconnect', listener: ((value: unknown) => void) | (() => void)): void {
    process.on(event, listener as never)
  }

  /** @inheritdoc */
  off(event: 'message' | 'disconnect', listener: ((value: unknown) => void) | (() => void)): void {
    process.off(event, listener as never)
  }

  /** @inheritdoc */
  disconnect(): void {
    process.disconnect()
  }
}

/**
 * Parse inbound records and serialize outbound logical frames over one Node IPC port.
 * The two promise tails prevent fragment interleaving and concurrent frame routing.
 */
export class VsCodeIpcChannel {
  private readonly port: NodeIpcPort
  private readonly decoder: VsCodeWireDecoder
  private readonly onFrame: IpcChannelOptions['onFrame']
  private readonly onFailure: NonNullable<IpcChannelOptions['onFailure']>
  private readonly onDisconnect: NonNullable<IpcChannelOptions['onDisconnect']>
  private inboundTail: Promise<void> = Promise.resolve()
  private outboundTail: Promise<void> = Promise.resolve()
  private readonly pendingSendRejectors = new Set<(error: Error) => void>()
  private disposing: Promise<void> | undefined
  private closed = false

  private readonly handleMessage = (value: unknown): void => {
    if (this.closed) return
    const operation = this.inboundTail.then(async () => {
      if (this.closed) return
      const frame = await this.decoder.accept(value)
      if (frame !== undefined) await this.onFrame(frame)
    })
    this.inboundTail = operation.catch((error: unknown) => { this.fail(error) })
  }

  private readonly handleDisconnect = (): void => {
    if (!this.markClosed()) return
    this.rejectPendingSends(new Error('VS Code IPC port disconnected'))
    try {
      this.onDisconnect()
    } catch {
      // A remote-disconnect observer cannot reopen the already closed port.
    }
  }

  /** @param options - raw port, codec limits, and serialized callbacks. */
  constructor(options: IpcChannelOptions) {
    this.port = options.port
    this.onFrame = options.onFrame
    this.onFailure = options.onFailure ?? (() => {})
    this.onDisconnect = options.onDisconnect ?? (() => {})
    this.decoder = new VsCodeWireDecoder(options)
    this.port.on('message', this.handleMessage)
    this.port.on('disconnect', this.handleDisconnect)
  }

  /**
   * Queue one logical frame after all earlier complete logical sends.
   * @param frame - validated carrier frame.
   * @returns a promise settled after the last physical IPC callback.
   */
  send(frame: VsCodeCarrierFrame): Promise<void> {
    if (this.closed) return Promise.reject(new Error('VS Code IPC channel is closed'))
    const operation = this.outboundTail.then(async () => {
      if (this.closed) throw new Error('VS Code IPC channel is closed')
      await sendVsCodeFrame(frame, record => this.sendRecord(record))
    })
    this.outboundTail = operation.catch((error: unknown) => { this.fail(error) })
    return operation
  }

  /**
   * Stop admission, await active frame handling and sends, then disconnect the port.
   * @returns the shared idempotent disposal promise.
   */
  dispose(): Promise<void> {
    if (this.disposing !== undefined) return this.disposing
    this.markClosed()
    this.rejectPendingSends(new Error('VS Code IPC channel was disposed'))
    this.disposing = Promise.allSettled([this.inboundTail, this.outboundTail]).then(() => {
      this.disconnectPort()
    })
    return this.disposing
  }

  private sendRecord(record: VsCodeWireRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const rejectPending = (error: Error): void => {
        if (settled) return
        settled = true
        this.pendingSendRejectors.delete(rejectPending)
        reject(error)
      }
      this.pendingSendRejectors.add(rejectPending)
      try {
        this.port.send(record, (error) => {
          if (settled) return
          settled = true
          this.pendingSendRejectors.delete(rejectPending)
          if (error === null) resolve()
          else reject(error)
        })
      } catch (error) {
        rejectPending(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private fail(error: unknown): void {
    if (!this.markClosed()) return
    const failure = error instanceof Error ? error : new Error(String(error))
    try {
      this.onFailure(failure)
    } catch {
      // A failure observer cannot replace the channel's original failure.
    }
    this.rejectPendingSends(failure)
    this.disconnectPort()
  }

  private markClosed(): boolean {
    if (this.closed) return false
    this.closed = true
    this.port.off('message', this.handleMessage)
    this.port.off('disconnect', this.handleDisconnect)
    this.decoder.dispose()
    return true
  }

  private disconnectPort(): void {
    if (this.port.connected) this.port.disconnect()
  }

  private rejectPendingSends(error: Error): void {
    for (const reject of [...this.pendingSendRejectors]) reject(error)
  }
}
