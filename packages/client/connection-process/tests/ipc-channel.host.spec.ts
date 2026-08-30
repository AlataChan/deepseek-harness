import { describe, expect, it, vi } from 'vitest'
import type { VsCodeCarrierFrame, VsCodeWireRecord } from '../src/protocol.ts'
import { ProcessIpcPort, VsCodeIpcChannel, type NodeIpcPort } from '../src/ipc-channel.ts'

class FakePort implements NodeIpcPort {
  connected = true
  readonly sent: unknown[] = []
  readonly callbacks: Array<(error: Error | null) => void> = []
  readonly messageListeners = new Set<(value?: unknown) => void>()
  readonly disconnectListeners = new Set<(value?: unknown) => void>()

  send(value: unknown, callback: (error: Error | null) => void): boolean {
    if (!this.connected) throw new Error('port disconnected')
    this.sent.push(value)
    this.callbacks.push(callback)
    return false
  }

  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    if (event === 'message') this.messageListeners.add(listener)
    else this.disconnectListeners.add(listener)
  }

  off(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    if (event === 'message') this.messageListeners.delete(listener)
    else this.disconnectListeners.delete(listener)
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    for (const listener of this.disconnectListeners) listener()
  }

  emitMessage(value: unknown): void {
    for (const listener of this.messageListeners) listener(value)
  }

  release(error: Error | null = null): void {
    const callback = this.callbacks.shift()
    if (callback === undefined) throw new Error('no pending send callback')
    callback(error)
  }
}

const shutdown: VsCodeCarrierFrame = { type: 'control/shutdown' }

function inline(frame: VsCodeCarrierFrame): VsCodeWireRecord {
  return { type: 'wire/message', encoded: JSON.stringify(frame) }
}

describe('VS Code Node IPC channel', () => {
  it('adapts the process IPC methods without addressing numbered descriptors', () => {
    const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected')
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
    const on = vi.spyOn(process, 'on').mockImplementation(() => process)
    const off = vi.spyOn(process, 'off').mockImplementation(() => process)
    const disconnect = vi.spyOn(process, 'disconnect').mockImplementation(() => {})
    try {
      Object.defineProperty(process, 'connected', { configurable: true, value: true })
      Object.defineProperty(process, 'send', {
        configurable: true,
        value: vi.fn((_value: unknown, callback: (error: Error | null) => void) => {
          callback(null)
          return true
        }),
      })
      const port = new ProcessIpcPort()
      expect(port.connected).toBe(true)
      const callback = vi.fn()
      expect(port.send({ ok: true }, callback)).toBe(true)
      expect(callback).toHaveBeenCalledWith(null)
      const listener = (): void => {}
      port.on('message', listener)
      port.off('message', listener)
      port.disconnect()
      expect(on).toHaveBeenCalledWith('message', listener)
      expect(off).toHaveBeenCalledWith('message', listener)
      expect(disconnect).toHaveBeenCalledOnce()

      Object.defineProperty(process, 'send', { configurable: true, value: undefined })
      expect(() => port.send({}, () => {})).toThrow(/connected Node IPC/)
    } finally {
      on.mockRestore()
      off.mockRestore()
      disconnect.mockRestore()
      if (connectedDescriptor === undefined) delete (process as { connected?: boolean }).connected
      else Object.defineProperty(process, 'connected', connectedDescriptor)
      if (sendDescriptor === undefined) delete (process as { send?: unknown }).send
      else Object.defineProperty(process, 'send', sendDescriptor)
    }
  })

  it('serializes complete logical sends and awaits every IPC callback', async () => {
    const port = new FakePort()
    const channel = new VsCodeIpcChannel({ port, onFrame: () => {} })
    let firstDone = false
    let secondDone = false
    const first = channel.send(shutdown).then(() => { firstDone = true })
    const second = channel.send({ type: 'control/shutdown-complete' }).then(() => { secondDone = true })

    await vi.waitFor(() => { expect(port.sent).toHaveLength(1) })
    expect(firstDone).toBe(false)
    expect(secondDone).toBe(false)
    port.release()
    await vi.waitFor(() => { expect(port.sent).toHaveLength(2) })
    expect(firstDone).toBe(true)
    expect(secondDone).toBe(false)
    port.release()
    await Promise.all([first, second])
    expect(secondDone).toBe(true)
  })

  it('serializes inbound decode and async frame handling', async () => {
    const port = new FakePort()
    const releases: Array<() => void> = []
    const seen: VsCodeCarrierFrame[] = []
    const channel = new VsCodeIpcChannel({
      port,
      onFrame: frame => new Promise<void>((resolve) => {
        seen.push(frame)
        releases.push(resolve)
      }),
    })
    port.emitMessage(inline(shutdown))
    port.emitMessage(inline({ type: 'control/shutdown-complete' }))

    await vi.waitFor(() => { expect(seen).toEqual([shutdown]) })
    releases.shift()?.()
    await vi.waitFor(() => { expect(seen).toHaveLength(2) })
    releases.shift()?.()
    await channel.dispose()
  })

  it('accepts fragmented inbound frames without dispatching partial records', async () => {
    const port = new FakePort()
    const seen: VsCodeCarrierFrame[] = []
    const channel = new VsCodeIpcChannel({
      port,
      maxWireRecordBytes: 220,
      maxControlBytes: 2048,
      onFrame: (frame) => { seen.push(frame) },
    })
    const records: VsCodeWireRecord[] = []
    const message: VsCodeCarrierFrame = { type: 'control/error', code: 'fixture', message: 'x'.repeat(400) }
    const { sendVsCodeFrame } = await import('../src/codec.ts')
    await sendVsCodeFrame(message, (record) => { records.push(record); return Promise.resolve() }, {
      maxWireRecordBytes: 220,
      maxControlBytes: 2048,
    })
    for (const record of records) port.emitMessage(record)
    await vi.waitFor(() => { expect(seen).toEqual([message]) })
    await channel.dispose()
  })

  it('closes on malformed input and reports one failure', async () => {
    const port = new FakePort()
    const failure = vi.fn()
    const channel = new VsCodeIpcChannel({ port, onFrame: () => {}, onFailure: failure })
    port.emitMessage({ type: 'not-a-wire-record' })

    await vi.waitFor(() => { expect(failure).toHaveBeenCalledTimes(1) })
    expect(port.connected).toBe(false)
    await expect(channel.send(shutdown)).rejects.toThrow(/closed/)
    port.emitMessage({ type: 'still-invalid' })
    expect(failure).toHaveBeenCalledTimes(1)
  })

  it('propagates callback and synchronous send failures without admitting later records', async () => {
    const callbackPort = new FakePort()
    const callbackFailure = vi.fn()
    const callbackChannel = new VsCodeIpcChannel({
      port: callbackPort, onFrame: () => {}, onFailure: callbackFailure,
    })
    const sending = callbackChannel.send(shutdown)
    const blocked = callbackChannel.send({ type: 'control/shutdown-complete' })
    await vi.waitFor(() => { expect(callbackPort.sent).toHaveLength(1) })
    callbackPort.release(new Error('callback failed'))
    await expect(sending).rejects.toThrow('callback failed')
    await expect(blocked).rejects.toThrow(/closed/)
    expect(callbackFailure).toHaveBeenCalledTimes(1)

    const throwingPort = new FakePort()
    throwingPort.send = () => { throw new Error('send threw') }
    const throwingChannel = new VsCodeIpcChannel({ port: throwingPort, onFrame: () => {} })
    await expect(throwingChannel.send(shutdown)).rejects.toThrow('send threw')

    const plainPort = new FakePort()
    plainPort.send = () => { throw 'plain send failure' }
    const plainChannel = new VsCodeIpcChannel({ port: plainPort, onFrame: () => {} })
    await expect(plainChannel.send(shutdown)).rejects.toThrow(/plain send failure/)

    const callbackThenThrow = new FakePort()
    callbackThenThrow.send = (_value, callback) => {
      callback(null)
      throw new Error('late synchronous throw')
    }
    const callbackThenThrowChannel = new VsCodeIpcChannel({
      port: callbackThenThrow, onFrame: () => {},
    })
    await expect(callbackThenThrowChannel.send(shutdown)).resolves.toBeUndefined()
    await callbackThenThrowChannel.dispose()
  })

  it('contains throwing observers and non-Error frame-handler failures', async () => {
    const port = new FakePort()
    const failure = vi.fn(() => { throw new Error('observer failure') })
    const channel = new VsCodeIpcChannel({
      port,
      onFrame: () => { throw 'plain handler failure' },
      onFailure: failure,
    })
    port.emitMessage(inline(shutdown))
    await vi.waitFor(() => { expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'plain handler failure' })) })
    expect(port.connected).toBe(false)
    await channel.dispose()

    const remote = new FakePort()
    const remoteChannel = new VsCodeIpcChannel({
      port: remote,
      onFrame: () => {},
      onDisconnect: () => { throw new Error('disconnect observer failure') },
    })
    const listener = [...remote.disconnectListeners][0]!
    expect(() => { remote.disconnect() }).not.toThrow()
    expect(() => { listener() }).not.toThrow()
    await remoteChannel.dispose()
  })

  it('reports remote disconnect and disposal waits for active handlers before disconnecting', async () => {
    const remote = new FakePort()
    const disconnected = vi.fn()
    const remoteChannel = new VsCodeIpcChannel({
      port: remote, onFrame: () => {}, onDisconnect: disconnected,
    })
    remote.disconnect()
    expect(disconnected).toHaveBeenCalledOnce()
    await expect(remoteChannel.send(shutdown)).rejects.toThrow(/closed/)
    await remoteChannel.dispose()

    const pendingPort = new FakePort()
    const pendingChannel = new VsCodeIpcChannel({ port: pendingPort, onFrame: () => {} })
    const pending = pendingChannel.send(shutdown)
    await vi.waitFor(() => { expect(pendingPort.callbacks).toHaveLength(1) })
    pendingPort.disconnect()
    await expect(pending).rejects.toThrow(/disconnected/)
    pendingPort.release()
    await pendingChannel.dispose()

    const localPort = new FakePort()
    const localChannel = new VsCodeIpcChannel({ port: localPort, onFrame: () => {} })
    const localSend = localChannel.send(shutdown)
    await vi.waitFor(() => { expect(localPort.callbacks).toHaveLength(1) })
    const localDisposal = localChannel.dispose()
    await expect(localSend).rejects.toThrow(/disposed/)
    await localDisposal

    const port = new FakePort()
    let release: (() => void) | undefined
    const channel = new VsCodeIpcChannel({
      port,
      onFrame: () => new Promise<void>((resolve) => { release = resolve }),
    })
    port.emitMessage(inline(shutdown))
    const queuedListener = [...port.messageListeners][0]!
    port.emitMessage(inline({ type: 'control/shutdown-complete' }))
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    let disposed = false
    const disposing = channel.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(port.connected).toBe(true)
    release?.()
    await disposing
    expect(port.connected).toBe(false)
    expect(port.messageListeners.size).toBe(0)
    queuedListener(inline(shutdown))
    await channel.dispose()

    const defaultRemote = new FakePort()
    new VsCodeIpcChannel({ port: defaultRemote, onFrame: () => {} })
    defaultRemote.disconnect()
  })
})
