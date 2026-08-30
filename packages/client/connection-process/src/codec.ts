/** Bounded UTF-8 JSON fragmentation and reassembly for the VS Code carrier. */

import { Binary } from '@deepseek-ai/cosmokit'
import {
  DEFAULT_MAX_LOGICAL_RPC_BYTES,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_WIRE_RECORD_BYTES,
  REASSEMBLY_TIMEOUT_MS,
  WireMessageId,
  vsCodeCarrierFrameSchema,
  vsCodeWireRecordSchema,
  wireMessageIdSchema,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
  type WireMessageId as WireMessageIdType,
} from './protocol.ts'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

/** Caller-overridable limits and deterministic ports for the wire codec. */
export interface WireCodecOptions {
  /** Maximum serialized bytes of one physical record. */
  maxWireRecordBytes?: number
  /** Maximum UTF-8 JSON bytes of control and stream lifecycle frames. */
  maxControlBytes?: number
  /** Maximum UTF-8 JSON bytes of RPC and stream data frames. */
  maxLogicalRpcBytes?: number
  /** Maximum duration of one incomplete fragmented message. */
  reassemblyTimeoutMs?: number
  /** Message-id source; injected by tests and platform ports. */
  createMessageId?: () => WireMessageIdType
  /** SHA-256 implementation; injected where the host owns a different crypto port. */
  sha256?: (bytes: Uint8Array) => Promise<string>
  /** Timer scheduler for deterministic timeout tests. */
  scheduleTimeout?: (callback: () => void, milliseconds: number) => unknown
  /** Timer canceller paired with `scheduleTimeout`. */
  cancelTimeout?: (handle: unknown) => void
  /** Called once when malformed input permanently closes a decoder. */
  onViolation?: (error: Error) => void
}

interface ResolvedWireCodecOptions {
  maxWireRecordBytes: number
  maxControlBytes: number
  maxLogicalRpcBytes: number
  reassemblyTimeoutMs: number
  createMessageId: () => WireMessageIdType
  sha256: (bytes: Uint8Array) => Promise<string>
  scheduleTimeout: (callback: () => void, milliseconds: number) => unknown
  cancelTimeout: (handle: unknown) => void
  onViolation: (error: Error) => void
}

interface Reassembly {
  readonly messageId: WireMessageIdType
  readonly totalBytes: number
  readonly sha256: string
  readonly bytes: Uint8Array
  timer: unknown
  offset: number
  chunks: number
}

/** Protocol violation that makes the current bridge direction unusable. */
export class VsCodeWireError extends Error {}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

async function defaultSha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned)
  return Binary.toHex(digest)
}

function defaultCreateMessageId(): WireMessageIdType {
  return WireMessageId(globalThis.crypto.randomUUID())
}

function defaultScheduleTimeout(callback: () => void, milliseconds: number): unknown {
  return globalThis.setTimeout(callback, milliseconds)
}

function defaultCancelTimeout(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
}

function resolveOptions(options: WireCodecOptions): ResolvedWireCodecOptions {
  return {
    maxWireRecordBytes: positiveInteger(options.maxWireRecordBytes ?? MAX_WIRE_RECORD_BYTES, 'maxWireRecordBytes'),
    maxControlBytes: positiveInteger(options.maxControlBytes ?? MAX_CONTROL_MESSAGE_BYTES, 'maxControlBytes'),
    maxLogicalRpcBytes: positiveInteger(options.maxLogicalRpcBytes ?? DEFAULT_MAX_LOGICAL_RPC_BYTES, 'maxLogicalRpcBytes'),
    reassemblyTimeoutMs: positiveInteger(options.reassemblyTimeoutMs ?? REASSEMBLY_TIMEOUT_MS, 'reassemblyTimeoutMs'),
    createMessageId: options.createMessageId ?? defaultCreateMessageId,
    sha256: options.sha256 ?? defaultSha256,
    scheduleTimeout: options.scheduleTimeout ?? defaultScheduleTimeout,
    cancelTimeout: options.cancelTimeout ?? defaultCancelTimeout,
    onViolation: options.onViolation ?? (() => {}),
  }
}

function jsonByteLength(value: unknown): number {
  let encoded: string | undefined
  try {
    encoded = stringifyJson(value)
  } catch (error) {
    throw new VsCodeWireError(`wire record is not JSON-serializable: ${String(error)}`)
  }
  if (encoded === undefined) throw new VsCodeWireError('wire record is not JSON-serializable')
  return textEncoder.encode(encoded).byteLength
}

function stringifyJson(value: unknown): string | undefined {
  return JSON.stringify(value)
}

function logicalLimit(frame: VsCodeCarrierFrame, options: ResolvedWireCodecOptions): number {
  return frame.type === 'rpc/message' || frame.type === 'stream/frame'
    ? options.maxLogicalRpcBytes
    : options.maxControlBytes
}

function assertWithin(value: number, limit: number, subject: string): void {
  if (value > limit) {
    throw new VsCodeWireError(`${subject} exceeds ${String(limit)} bytes (received ${String(value)})`)
  }
}

function assertPhysicalRecord(record: VsCodeWireRecord, options: ResolvedWireCodecOptions): void {
  assertWithin(jsonByteLength(record), options.maxWireRecordBytes, 'physical record')
}

function maxRawChunkBytes(
  messageId: WireMessageIdType,
  index: number,
  options: ResolvedWireCodecOptions,
): number {
  const empty: VsCodeWireRecord = { type: 'wire/chunk', messageId, index, data: 'AAAA' }
  const baseBytes = jsonByteLength(empty) - 4
  const base64Characters = options.maxWireRecordBytes - baseBytes
  const rawBytes = Math.floor(base64Characters / 4) * 3
  /* v8 ignore next 3 -- a validated start record is always larger than its later chunk headers. */
  if (rawBytes <= 0) {
    throw new VsCodeWireError('maxWireRecordBytes cannot fit a chunk record')
  }
  return rawBytes
}

/**
 * Encode and deliver one logical frame with sequential physical-record backpressure.
 * @param frame - typed carrier frame to serialize exactly once as UTF-8 JSON.
 * @param send - physical port delivery; each promise settles before the next call.
 * @param options - limits and deterministic codec ports.
 */
export async function sendVsCodeFrame(
  frame: VsCodeCarrierFrame,
  send: (record: VsCodeWireRecord) => Promise<void>,
  options: WireCodecOptions = {},
): Promise<void> {
  const resolved = resolveOptions(options)
  const parsed = vsCodeCarrierFrameSchema.parse(frame)
  const encoded = JSON.stringify(parsed)
  const bytes = textEncoder.encode(encoded)
  assertWithin(bytes.byteLength, logicalLimit(parsed, resolved), 'logical frame')

  const inline: VsCodeWireRecord = { type: 'wire/message', encoded }
  if (jsonByteLength(inline) <= resolved.maxWireRecordBytes) {
    await send(inline)
    return
  }

  const messageId = wireMessageIdSchema.parse(resolved.createMessageId())
  const start: VsCodeWireRecord = {
    type: 'wire/chunk-start',
    messageId,
    totalBytes: bytes.byteLength,
    sha256: await resolved.sha256(bytes),
  }
  assertPhysicalRecord(start, resolved)
  await send(start)

  let offset = 0
  let index = 0
  while (offset < bytes.byteLength) {
    const size = Math.min(bytes.byteLength - offset, maxRawChunkBytes(messageId, index, resolved))
    const data = Binary.toBase64(bytes.subarray(offset, offset + size))
    const chunk: VsCodeWireRecord = { type: 'wire/chunk', messageId, index, data }
    assertPhysicalRecord(chunk, resolved)
    await send(chunk)
    offset += size
    index += 1
  }
  const end: VsCodeWireRecord = { type: 'wire/chunk-end', messageId, chunks: index }
  assertPhysicalRecord(end, resolved)
  await send(end)
}

/** Stateful one-direction decoder; one fragmented logical message may exist at a time. */
export class VsCodeWireDecoder {
  private readonly options: ResolvedWireCodecOptions
  private reassembly: Reassembly | undefined
  private closed = false

  /** @param options - limits, timer/hash ports, and the bridge-close callback. */
  constructor(options: WireCodecOptions = {}) {
    this.options = resolveOptions(options)
  }

  /**
   * Parse one untrusted physical value and return a complete logical frame when available.
   * @param value - unknown value received from Node IPC or Webview messaging.
   * @returns a frame for an inline or completed fragmented record; otherwise undefined.
   */
  async accept(value: unknown): Promise<VsCodeCarrierFrame | undefined> {
    if (this.closed) throw new VsCodeWireError('decoder is closed')
    try {
      assertWithin(jsonByteLength(value), this.options.maxWireRecordBytes, 'physical record')
      const record = vsCodeWireRecordSchema.parse(value)
      return await this.acceptRecord(record)
    } catch (error) {
      throw this.closeWithViolation(error)
    }
  }

  /** Release a partial reassembly without reporting a protocol violation. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.clearReassembly()
  }

  private async acceptRecord(record: VsCodeWireRecord): Promise<VsCodeCarrierFrame | undefined> {
    switch (record.type) {
      case 'wire/message': {
        if (this.reassembly !== undefined) throw new VsCodeWireError('fragmented message already in flight')
        return this.decodeLogical(record.encoded)
      }
      case 'wire/chunk-start': {
        if (this.reassembly !== undefined) throw new VsCodeWireError('fragmented message already in flight')
        const maximum = Math.max(this.options.maxControlBytes, this.options.maxLogicalRpcBytes)
        assertWithin(record.totalBytes, maximum, 'logical frame')
        const reassembly: Reassembly = {
          messageId: record.messageId,
          totalBytes: record.totalBytes,
          sha256: record.sha256,
          bytes: new Uint8Array(record.totalBytes),
          timer: undefined,
          offset: 0,
          chunks: 0,
        }
        reassembly.timer = this.options.scheduleTimeout(() => {
          this.closeWithViolation(new VsCodeWireError('fragment reassembly timed out'))
        }, this.options.reassemblyTimeoutMs)
        this.reassembly = reassembly
        return undefined
      }
      case 'wire/chunk': {
        const state = this.requireReassembly(record.messageId)
        if (record.index !== state.chunks) {
          throw new VsCodeWireError(`unexpected chunk index ${String(record.index)}; expected ${String(state.chunks)}`)
        }
        const decoded = new Uint8Array(Binary.fromBase64(record.data))
        if (Binary.toBase64(decoded) !== record.data) throw new VsCodeWireError('chunk data is not canonical base64')
        if (state.offset + decoded.byteLength > state.totalBytes) {
          throw new VsCodeWireError('fragment length exceeds declared logical length')
        }
        state.bytes.set(decoded, state.offset)
        state.offset += decoded.byteLength
        state.chunks += 1
        return undefined
      }
      case 'wire/chunk-end': {
        const state = this.requireReassembly(record.messageId)
        if (record.chunks !== state.chunks) {
          throw new VsCodeWireError(`chunk count mismatch: received ${String(state.chunks)}, declared ${String(record.chunks)}`)
        }
        if (state.offset !== state.totalBytes) {
          throw new VsCodeWireError(`fragment length mismatch: received ${String(state.offset)}, declared ${String(state.totalBytes)}`)
        }
        this.options.cancelTimeout(state.timer)
        this.reassembly = undefined
        const digest = await this.options.sha256(state.bytes)
        if (digest !== state.sha256) throw new VsCodeWireError('fragment digest mismatch')
        let encoded: string
        try {
          encoded = textDecoder.decode(state.bytes)
        } catch (error) {
          throw new VsCodeWireError(`fragmented message is not valid UTF-8: ${String(error)}`)
        }
        return this.decodeLogical(encoded)
      }
    }
  }

  private decodeLogical(encoded: string): VsCodeCarrierFrame {
    let value: unknown
    try {
      value = JSON.parse(encoded)
    } catch (error) {
      throw new VsCodeWireError(`logical frame is not JSON: ${String(error)}`)
    }
    const frame = vsCodeCarrierFrameSchema.parse(value)
    assertWithin(textEncoder.encode(encoded).byteLength, logicalLimit(frame, this.options), 'logical frame')
    return frame
  }

  private requireReassembly(messageId: WireMessageIdType): Reassembly {
    const state = this.reassembly
    if (state === undefined) throw new VsCodeWireError('fragment record has no message in flight')
    if (state.messageId !== messageId) throw new VsCodeWireError('fragment message id does not match the message in flight')
    return state
  }

  private clearReassembly(): void {
    if (this.reassembly === undefined) return
    this.options.cancelTimeout(this.reassembly.timer)
    this.reassembly = undefined
  }

  private closeWithViolation(error: unknown): Error {
    const violation = error instanceof Error ? error : new VsCodeWireError(String(error))
    if (this.closed) return violation
    this.closed = true
    this.clearReassembly()
    try {
      this.options.onViolation(violation)
    } catch {
      // The caller's close callback cannot make codec failure nondeterministic.
    }
    return violation
  }
}
