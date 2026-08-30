/**
 * Newline-delimited JSON adapter for {@link NodeIpcPort}.
 * @module @deepseek-ai/dsh-client-connection-process
 */

import type { Readable, Writable } from 'node:stream'
import { MAX_WIRE_RECORD_BYTES } from './protocol.ts'
import type { NodeIpcPort } from './ipc-channel.ts'

/** Byte streams that carry one JSON record per line. */
export interface StdioLinePortStreams {
  /** Inbound bytes; records are split on a newline. */
  readonly input: Readable
  /** Outbound bytes; `send` writes one JSON line. */
  readonly output: Writable
}

/**
 * Process-stdio port: one physical record is one JSON line, capped at {@link MAX_WIRE_RECORD_BYTES}.
 */
export class StdioLinePort implements NodeIpcPort {
  private readonly input: Readable
  private readonly output: Writable
  private readonly messageListeners = new Set<(value: unknown) => void>()
  private readonly disconnectListeners = new Set<() => void>()
  private readonly messageWrappers = new Map<unknown, (value: unknown) => void>()
  private readonly disconnectWrappers = new Map<unknown, () => void>()
  private readonly pendingMessages: unknown[] = []
  private buffer = ''
  private live = true

  /**
   * Bind one pair of streams as a {@link NodeIpcPort}.
   * @param streams - inbound and outbound byte streams.
   */
  constructor(streams: StdioLinePortStreams) {
    this.input = streams.input
    this.output = streams.output
    this.input.on('data', this.handleData)
    this.input.on('end', this.disconnect)
    this.input.on('close', this.disconnect)
  }

  /** @returns whether the port still accepts records. */
  get connected(): boolean {
    return this.live
  }

  /**
   * Serialize one record as a single JSON line.
   * @param value - physical record to write.
   * @param callback - Node-style completion after drain or failure.
   * @returns whether the underlying stream accepted the write immediately.
   */
  send(value: unknown, callback: (error: Error | null) => void): boolean {
    if (!this.live) {
      callback(new Error('stdio line port is disconnected'))
      return false
    }
    let record: string
    try {
      record = JSON.stringify(value)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.fail(failure)
      callback(failure)
      return false
    }
    // The limit bounds the RECORD, not the record plus this port's framing
    // newline. Measuring the framed line rejects a record of exactly the limit,
    // which the codec deliberately emits: `maxRawChunkBytes` sizes a chunk to
    // fill the budget exactly, so every such chunk would close the port.
    const recordBytes = Buffer.byteLength(record, 'utf8')
    if (recordBytes > MAX_WIRE_RECORD_BYTES) {
      const error = new Error(
        `outbound stdio record exceeds the physical record limit (${String(recordBytes)} > ${String(MAX_WIRE_RECORD_BYTES)} bytes)`,
      )
      this.fail(error)
      callback(error)
      return false
    }
    return this.output.write(`${record}\n`, (error) => {
      callback(error ?? null)
    })
  }

  /** @inheritdoc */
  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    if (event === 'message') {
      const onMessage = (value: unknown): void => { listener(value) }
      this.messageListeners.add(onMessage)
      this.messageWrappers.set(listener, onMessage)
      if (this.pendingMessages.length > 0) {
        const queued = this.pendingMessages.splice(0)
        for (const value of queued) onMessage(value)
      }
      return
    }
    const onDisconnect = (): void => { listener() }
    this.disconnectListeners.add(onDisconnect)
    this.disconnectWrappers.set(listener, onDisconnect)
  }

  /** @inheritdoc */
  off(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    if (event === 'message') {
      const wrapped = this.messageWrappers.get(listener)
      this.messageWrappers.delete(listener)
      if (wrapped !== undefined) this.messageListeners.delete(wrapped)
      return
    }
    const wrapped = this.disconnectWrappers.get(listener)
    this.disconnectWrappers.delete(listener)
    if (wrapped !== undefined) this.disconnectListeners.delete(wrapped)
  }

  /** Close the port and notify disconnect listeners once. */
  disconnect = (): void => {
    this.fail()
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const bufferedBytes = Buffer.byteLength(this.buffer, 'utf8')
    if (bufferedBytes > MAX_WIRE_RECORD_BYTES && !this.buffer.includes('\n')) {
      this.fail(new Error(
        `inbound stdio line exceeds the physical record limit (${String(bufferedBytes)} > ${String(MAX_WIRE_RECORD_BYTES)} bytes, no newline)`,
      ))
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const lineBytes = Buffer.byteLength(line, 'utf8')
      if (lineBytes > MAX_WIRE_RECORD_BYTES) {
        this.fail(new Error(
          `inbound stdio record exceeds the physical record limit (${String(lineBytes)} > ${String(MAX_WIRE_RECORD_BYTES)} bytes)`,
        ))
        return
      }
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        this.fail(new Error('stdio line is not JSON'))
        return
      }
      if (this.messageListeners.size === 0) this.pendingMessages.push(value)
      else {
        for (const listener of this.messageListeners) {
          listener(value)
          if (!this.live) return
        }
      }
      newline = this.buffer.indexOf('\n')
    }
  }

  private fail(error?: Error): void {
    if (!this.live) return
    this.live = false
    this.buffer = ''
    // Reported rather than discarded: a listener only learns that the port
    // closed, so an unrecorded reason leaves a peer-visible broken pipe as the
    // sole evidence of a malformed or oversized record. `claimProcessStdio`
    // already reserves stderr as this process's diagnostic channel.
    if (error !== undefined) {
      process.stderr.write(`stdio line port closed: ${error.message}\n`)
    }
    this.input.off('data', this.handleData)
    this.input.off('end', this.disconnect)
    this.input.off('close', this.disconnect)
    for (const listener of this.disconnectListeners) listener()
  }
}
