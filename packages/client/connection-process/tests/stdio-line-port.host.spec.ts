import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { MAX_WIRE_RECORD_BYTES } from '../src/protocol.ts'
import { StdioLinePort } from '../src/stdio-line-port.ts'

function port() {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks: string[] = []
  output.on('data', (chunk: Buffer) => { chunks.push(chunk.toString('utf8')) })
  return { input, output, chunks, subject: new StdioLinePort({ input, output }) }
}

describe('StdioLinePort', () => {
  it('implements NodeIpcPort and reassembles a record split across chunks', async () => {
    const { input, subject } = port()
    const received: unknown[] = []
    subject.on('message', (value) => { received.push(value) })
    input.write('{"type":"control/hello"')
    input.write('}\n')
    await vi.waitFor(() => {
      expect(received).toEqual([{ type: 'control/hello' }])
    })
  })

  it('writes one record per line through send', async () => {
    const { chunks, subject } = port()
    await new Promise<void>((resolve, reject) => {
      subject.send({ type: 'control/hello' }, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })
    expect(chunks.join('')).toBe('{"type":"control/hello"}\n')
  })

  it('disconnects on a non-JSON line', async () => {
    const { input, subject } = port()
    const disconnected = vi.fn()
    subject.on('disconnect', disconnected)
    input.write('not json\n')
    await vi.waitFor(() => {
      expect(disconnected).toHaveBeenCalled()
    })
    expect(subject.connected).toBe(false)
  })

  it('delivers a record that arrived before a message listener attached', async () => {
    const { input, subject } = port()
    input.write('{"type":"control/hello"}\n')
    const received: unknown[] = []
    subject.on('message', (value) => { received.push(value) })
    await vi.waitFor(() => {
      expect(received).toEqual([{ type: 'control/hello' }])
    })
  })

  it('stops later listeners after a message handler disconnects', () => {
    const { input, subject } = port()
    const later = vi.fn()
    subject.on('message', () => { subject.disconnect() })
    subject.on('message', later)
    input.write('{"type":"control/hello"}\n')
    expect(later).not.toHaveBeenCalled()
    expect(subject.connected).toBe(false)
  })

  it('removes registered listeners', () => {
    const { input, subject } = port()
    const onMessage = vi.fn()
    const onDisconnect = vi.fn()
    subject.on('message', onMessage)
    subject.on('disconnect', onDisconnect)
    subject.off('message', onMessage)
    subject.off('disconnect', onDisconnect)
    subject.off('message', onMessage)
    subject.off('disconnect', onDisconnect)
    input.write('{"type":"control/hello"}\n')
    subject.disconnect()
    expect(onMessage).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('rejects send after disconnect', async () => {
    const { subject } = port()
    subject.disconnect()
    subject.disconnect()
    await expect(new Promise<void>((resolve, reject) => {
      const accepted = subject.send({ type: 'control/hello' }, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
      expect(accepted).toBe(false)
    })).rejects.toThrow(/disconnected/u)
  })

  it('disconnects when send cannot serialize the record', async () => {
    const { subject } = port()
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    await expect(new Promise<void>((resolve, reject) => {
      subject.send(cyclic, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })).rejects.toThrow()
    expect(subject.connected).toBe(false)
  })

  it('disconnects when send serializes a thrown non-Error', async () => {
    const { subject } = port()
    await expect(new Promise<void>((resolve, reject) => {
      subject.send({ toJSON() { throw 'nope' } }, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })).rejects.toThrow(/nope/u)
    expect(subject.connected).toBe(false)
  })

  it('disconnects when send exceeds the physical record limit', async () => {
    const { subject } = port()
    await expect(new Promise<void>((resolve, reject) => {
      subject.send({ blob: 'a'.repeat(MAX_WIRE_RECORD_BYTES) }, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })).rejects.toThrow(/physical record limit/u)
    expect(subject.connected).toBe(false)
  })

  it('sends a record of exactly the physical record limit', async () => {
    const { chunks, subject } = port()
    // The codec fills the budget exactly (`maxRawChunkBytes`), so the framing
    // newline must not count against it: measuring the framed line rejected
    // every full-size chunk and closed the carrier mid-session.
    const overhead = Buffer.byteLength(JSON.stringify({ blob: '' }), 'utf8')
    const blob = 'a'.repeat(MAX_WIRE_RECORD_BYTES - overhead)
    const record = { blob }
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBe(MAX_WIRE_RECORD_BYTES)

    await new Promise<void>((resolve, reject) => {
      subject.send(record, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })
    expect(subject.connected).toBe(true)
    expect(chunks.join('')).toBe(`${JSON.stringify(record)}\n`)
  })

  it('reports a sink write failure through send', async () => {
    const input = new PassThrough()
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('sink failed'))
      },
    })
    output.on('error', () => {
      // The send callback is the product path; Node also emits stream 'error'.
    })
    const subject = new StdioLinePort({ input, output })
    await expect(new Promise<void>((resolve, reject) => {
      subject.send({ type: 'control/hello' }, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })).rejects.toThrow(/sink failed/u)
  })

  it('reassembles a utf8 string chunk', async () => {
    const input = new PassThrough({ encoding: 'utf8' })
    const output = new PassThrough()
    const subject = new StdioLinePort({ input, output })
    const received: unknown[] = []
    subject.on('message', (value) => { received.push(value) })
    input.write('{"type":"control/hello"}\n')
    await vi.waitFor(() => {
      expect(received).toEqual([{ type: 'control/hello' }])
    })
  })

  it('disconnects when a line arrives without a newline above the limit', async () => {
    const { input, subject } = port()
    const disconnected = vi.fn()
    subject.on('disconnect', disconnected)
    input.write('a'.repeat(MAX_WIRE_RECORD_BYTES + 1))
    await vi.waitFor(() => {
      expect(disconnected).toHaveBeenCalled()
    })
    expect(subject.connected).toBe(false)
  })

  it('disconnects on a line above the physical record limit', async () => {
    const { input, subject } = port()
    const disconnected = vi.fn()
    subject.on('disconnect', disconnected)
    input.write(`${'a'.repeat(300 * 1024)}\n`)
    await vi.waitFor(() => {
      expect(disconnected).toHaveBeenCalled()
    })
  })
})
