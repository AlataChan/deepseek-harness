import { describe, expect, it, vi } from 'vitest'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  VsCodeStreamId,
  WireMessageId,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '../src/protocol.ts'
import {
  VsCodeWireDecoder,
  sendVsCodeFrame,
  type WireCodecOptions,
} from '../src/codec.ts'

const encoder = new TextEncoder()

const SMALL_LIMITS: WireCodecOptions = {
  maxWireRecordBytes: 220,
  maxControlBytes: 512,
  maxLogicalRpcBytes: 4096,
  reassemblyTimeoutMs: 50,
  createMessageId: () => WireMessageId('message-1'),
}

function largeRpc(size = 800): VsCodeCarrierFrame {
  return {
    type: 'rpc/message',
    message: {
      type: 'client-request',
      rpcId: RpcId('rpc-large'),
      method: 'session.prompt',
      payload: { text: 'x'.repeat(size) },
    },
  }
}

async function encode(
  frame: VsCodeCarrierFrame,
  options: WireCodecOptions = SMALL_LIMITS,
): Promise<VsCodeWireRecord[]> {
  const records: VsCodeWireRecord[] = []
  await sendVsCodeFrame(frame, (record) => {
    records.push(record)
    return Promise.resolve()
  }, options)
  return records
}

async function decode(
  records: readonly VsCodeWireRecord[],
  options: WireCodecOptions = SMALL_LIMITS,
): Promise<VsCodeCarrierFrame | undefined> {
  const decoder = new VsCodeWireDecoder(options)
  let frame: VsCodeCarrierFrame | undefined
  for (const record of records) frame = await decoder.accept(record) ?? frame
  return frame
}

describe('VS Code wire encoding', () => {
  it('uses production defaults for inline and fragmented messages', async () => {
    const inline: VsCodeWireRecord[] = []
    await sendVsCodeFrame({ type: 'control/shutdown' }, (record) => {
      inline.push(record)
      return Promise.resolve()
    })
    expect(inline).toHaveLength(1)

    const options: WireCodecOptions = {
      maxWireRecordBytes: 220,
      maxControlBytes: 512,
      maxLogicalRpcBytes: 4096,
      reassemblyTimeoutMs: 50,
    }
    const fragmented = await encode(largeRpc(), options)
    await expect(decode(fragmented, options)).resolves.toEqual(largeRpc())
  })

  it('rejects invalid limits, frames, and unrepresentable physical envelopes', async () => {
    for (const [name, options] of [
      ['maxWireRecordBytes', { maxWireRecordBytes: 0 }],
      ['maxControlBytes', { maxControlBytes: Number.NaN }],
      ['maxLogicalRpcBytes', { maxLogicalRpcBytes: -1 }],
      ['reassemblyTimeoutMs', { reassemblyTimeoutMs: Number.MAX_VALUE }],
    ] as const) {
      expect(() => new VsCodeWireDecoder(options)).toThrow(name)
    }

    await expect(sendVsCodeFrame(
      { type: 'control/shutdown', extra: true } as never,
      () => Promise.resolve(),
    )).rejects.toThrow()
    await expect(encode({ type: 'control/shutdown' }, {
      ...SMALL_LIMITS,
      maxWireRecordBytes: 30,
    })).rejects.toThrow(/physical record exceeds/)
  })

  it('sends an inline record when the serialized physical record fits exactly', async () => {
    const frame: VsCodeCarrierFrame = { type: 'control/shutdown' }
    const encoded = JSON.stringify(frame)
    const exactPhysicalBytes = encoder.encode(JSON.stringify({ type: 'wire/message', encoded })).byteLength
    const exactLogicalBytes = encoder.encode(encoded).byteLength
    const records = await encode(frame, {
      ...SMALL_LIMITS,
      maxWireRecordBytes: exactPhysicalBytes,
      maxControlBytes: exactLogicalBytes,
    })

    expect(records).toEqual([{ type: 'wire/message', encoded }])
    await expect(encode(frame, {
      ...SMALL_LIMITS,
      maxWireRecordBytes: exactPhysicalBytes,
      maxControlBytes: exactLogicalBytes - 1,
    })).rejects.toThrow(/logical frame exceeds/)
  })

  it('fragments a large RPC into bounded records and reassembles it in order', async () => {
    const frame = largeRpc()
    const records = await encode(frame)

    expect(records[0]?.type).toBe('wire/chunk-start')
    expect(records.at(-1)?.type).toBe('wire/chunk-end')
    expect(records.length).toBeGreaterThan(3)
    expect(records.every(record => encoder.encode(JSON.stringify(record)).byteLength <= 220)).toBe(true)
    await expect(decode(records)).resolves.toEqual(frame)
  })

  it('awaits each delivery before admitting the next physical record', async () => {
    const releases: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const seen: VsCodeWireRecord[] = []
    let settled = false
    const sending = sendVsCodeFrame(largeRpc(), (record) => {
      seen.push(record)
      active += 1
      maxActive = Math.max(maxActive, active)
      return new Promise<void>((resolve) => {
        releases.push(() => { active -= 1; resolve() })
      })
    }, SMALL_LIMITS).then(() => { settled = true })

    await vi.waitFor(() => { expect(seen).toHaveLength(1) })
    while (!settled) {
      const release = releases.shift()
      if (release === undefined) {
        await Promise.resolve()
        continue
      }
      const before = seen.length
      release()
      await vi.waitFor(() => { expect(settled || seen.length > before).toBe(true) })
    }
    await sending
    expect(seen.length).toBeGreaterThan(3)
    expect(maxActive).toBe(1)
  })

  it('propagates a delivery failure and stops sending later records', async () => {
    const seen: VsCodeWireRecord[] = []
    await expect(sendVsCodeFrame(largeRpc(), (record) => {
      seen.push(record)
      return Promise.reject(new Error('port closed'))
    }, SMALL_LIMITS)).rejects.toThrow('port closed')
    expect(seen).toHaveLength(1)
  })

  it('rejects logical overflow before sending any record', async () => {
    const sent: VsCodeWireRecord[] = []
    await expect(sendVsCodeFrame(largeRpc(), (record) => {
      sent.push(record)
      return Promise.resolve()
    }, { ...SMALL_LIMITS, maxLogicalRpcBytes: 100 })).rejects.toThrow(/logical frame exceeds/)
    expect(sent).toEqual([])
  })
})

describe('VS Code wire reassembly failures', () => {
  it('decodes inline frames and rejects inline interruption and malformed JSON', async () => {
    const inline = await encode({ type: 'control/shutdown' })
    await expect(decode(inline)).resolves.toEqual({ type: 'control/shutdown' })

    const fragmented = await encode(largeRpc())
    const decoder = new VsCodeWireDecoder(SMALL_LIMITS)
    await decoder.accept(fragmented[0])
    await expect(decoder.accept(inline[0])).rejects.toThrow(/already in flight/)

    await expect(new VsCodeWireDecoder(SMALL_LIMITS).accept({
      type: 'wire/message', encoded: 'not-json',
    })).rejects.toThrow(/not JSON/)
    await expect(new VsCodeWireDecoder(SMALL_LIMITS).accept({
      type: 'wire/message', encoded: JSON.stringify({ type: 'unknown' }),
    })).rejects.toThrow()
  })

  it('rejects non-serializable and schema-invalid physical records', async () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    await expect(new VsCodeWireDecoder(SMALL_LIMITS).accept(circular)).rejects.toThrow(/not JSON-serializable/)
    await expect(new VsCodeWireDecoder(SMALL_LIMITS).accept(undefined)).rejects.toThrow(/not JSON-serializable/)
    await expect(new VsCodeWireDecoder(SMALL_LIMITS).accept({
      toJSON: () => { throw 'plain failure' },
    })).rejects.toThrow(/plain failure/)
    await expect(new VsCodeWireDecoder(SMALL_LIMITS).accept({ type: 'wire/chunk' })).rejects.toThrow()
  })

  it('rejects digest and declared-length mismatches', async () => {
    const records = await encode(largeRpc())
    const digestMismatch = records.map((record, index) => index === 0 && record.type === 'wire/chunk-start'
      ? { ...record, sha256: '0'.repeat(64) }
      : record)
    await expect(decode(digestMismatch)).rejects.toThrow(/digest mismatch/)

    const lengthMismatch = records.map((record, index) => index === 0 && record.type === 'wire/chunk-start'
      ? { ...record, totalBytes: record.totalBytes + 1 }
      : record)
    await expect(decode(lengthMismatch)).rejects.toThrow(/length mismatch/)
  })

  it('rejects duplicate, out-of-order, interleaved, and incomplete chunks', async () => {
    const records = await encode(largeRpc())
    const start = records[0]!
    const firstChunk = records[1]!
    const end = records.at(-1)!
    if (start.type !== 'wire/chunk-start' || firstChunk.type !== 'wire/chunk' || end.type !== 'wire/chunk-end') {
      throw new Error('expected fragmented fixture')
    }

    await expect(decode([start, firstChunk, firstChunk])).rejects.toThrow(/chunk index/)
    await expect(decode([start, { ...firstChunk, index: 1 }])).rejects.toThrow(/chunk index/)
    await expect(decode([start, { ...start, messageId: WireMessageId('message-2') }])).rejects.toThrow(/already in flight/)
    await expect(decode([start, firstChunk, { ...end, chunks: 1 }])).rejects.toThrow(/length mismatch|chunk count/)
    await expect(decode([start, firstChunk, { ...end, chunks: 2 }])).rejects.toThrow(/chunk count mismatch/)
    await expect(decode([{ ...firstChunk, messageId: WireMessageId('missing') }])).rejects.toThrow(/no message in flight/)
    await expect(decode([start, { ...firstChunk, messageId: WireMessageId('different') }]))
      .rejects.toThrow(/message id does not match/)
  })

  it('rejects non-canonical base64, excess fragment bytes, and invalid UTF-8', async () => {
    const start: VsCodeWireRecord = {
      type: 'wire/chunk-start', messageId: WireMessageId('manual'), totalBytes: 1, sha256: 'a'.repeat(64),
    }
    await expect(decode([start, {
      type: 'wire/chunk', messageId: start.messageId, index: 0, data: 'AB==',
    }], { ...SMALL_LIMITS, sha256: async () => 'a'.repeat(64) })).rejects.toThrow(/canonical base64/)
    await expect(decode([start, {
      type: 'wire/chunk', messageId: start.messageId, index: 0, data: 'AAAA',
    }], { ...SMALL_LIMITS, sha256: async () => 'a'.repeat(64) })).rejects.toThrow(/exceeds declared/)

    await expect(decode([start, {
      type: 'wire/chunk', messageId: start.messageId, index: 0, data: '/w==',
    }, {
      type: 'wire/chunk-end', messageId: start.messageId, chunks: 1,
    }], { ...SMALL_LIMITS, sha256: async () => 'a'.repeat(64) })).rejects.toThrow(/not valid UTF-8/)
  })

  it('rejects physical overflow and reserves memory for at most one bounded message', async () => {
    const violation = vi.fn()
    const decoder = new VsCodeWireDecoder({ ...SMALL_LIMITS, onViolation: violation })
    await expect(decoder.accept({ type: 'wire/message', encoded: 'x'.repeat(500) })).rejects.toThrow(/physical record exceeds/)
    expect(violation).toHaveBeenCalledTimes(1)
    await expect(decoder.accept({ type: 'wire/message', encoded: '{}' })).rejects.toThrow(/decoder is closed/)

    const bounded = new VsCodeWireDecoder(SMALL_LIMITS)
    await expect(bounded.accept({
      type: 'wire/chunk-start',
      messageId: WireMessageId('too-large'),
      totalBytes: 4097,
      sha256: 'a'.repeat(64),
    })).rejects.toThrow(/logical frame exceeds/)
  })

  it('applies the smaller control limit after a fragmented message is decoded', async () => {
    const frame: VsCodeCarrierFrame = {
      type: 'control/error', code: 'fixture', message: 'x'.repeat(600),
    }
    const records = await encode(frame, { ...SMALL_LIMITS, maxControlBytes: 2048 })
    await expect(decode(records, SMALL_LIMITS)).rejects.toThrow(/logical frame exceeds/)
  })

  it('closes a partial reassembly on timeout and cancels the timer on disposal', async () => {
    let timeout: (() => void) | undefined
    const cancelled: unknown[] = []
    const violation = vi.fn()
    const decoder = new VsCodeWireDecoder({
      ...SMALL_LIMITS,
      onViolation: violation,
      scheduleTimeout: (callback) => { timeout = callback; return 'timer' },
      cancelTimeout: (handle) => { cancelled.push(handle) },
    })
    const records = await encode(largeRpc())
    await decoder.accept(records[0])
    expect(timeout).toBeTypeOf('function')
    timeout?.()
    expect((violation.mock.calls[0]?.[0] as Error).message).toMatch(/timed out/)
    await expect(decoder.accept(records[1])).rejects.toThrow(/decoder is closed/)

    const disposable = new VsCodeWireDecoder({
      ...SMALL_LIMITS,
      scheduleTimeout: () => 'timer-2',
      cancelTimeout: (handle) => { cancelled.push(handle) },
    })
    await disposable.accept(records[0])
    disposable.dispose()
    disposable.dispose()
    expect(cancelled).toEqual(['timer', 'timer-2'])

    const fresh = new VsCodeWireDecoder(SMALL_LIMITS)
    fresh.dispose()
    fresh.dispose()
  })

  it('keeps protocol failure deterministic when the close callback throws or fires late', async () => {
    let lateTimeout: (() => void) | undefined
    const decoder = new VsCodeWireDecoder({
      ...SMALL_LIMITS,
      scheduleTimeout: (callback) => { lateTimeout = callback; return 'late' },
      cancelTimeout: () => {},
      onViolation: () => { throw new Error('callback failure') },
    })
    const records = await encode(largeRpc())
    await decoder.accept(records[0])
    await expect(decoder.accept({ type: 'invalid' })).rejects.toThrow()
    expect(() => lateTimeout?.()).not.toThrow()

    const fragmented = await encode(largeRpc())
    await expect(decode(fragmented, {
      ...SMALL_LIMITS,
      sha256: async () => { throw 'hash port failure' },
    })).rejects.toThrow(/hash port failure/)
  })
})

describe('stream frame logical capacity', () => {
  it('uses the RPC limit for downlink stream frames and the control limit for stream open', async () => {
    const streamFrame: VsCodeCarrierFrame = {
      type: 'stream/frame',
      streamId: VsCodeStreamId('stream-1'),
      message: {
        type: 'server-request',
        rpcId: RpcId('frame-1'),
        method: 'session/projection',
        payload: { type: 'session/projection', value: 'x'.repeat(600) },
      },
    }
    const records = await encode(streamFrame)
    expect(records.length).toBeGreaterThan(1)

    const open: VsCodeCarrierFrame = {
      type: 'stream/open', streamId: VsCodeStreamId('stream-1'), stream: 'host', payload: {},
    }
    const bytes = encoder.encode(JSON.stringify(open)).byteLength
    await expect(encode(open, { ...SMALL_LIMITS, maxControlBytes: bytes - 1 }))
      .rejects.toThrow(/logical frame exceeds/)
  })
})
