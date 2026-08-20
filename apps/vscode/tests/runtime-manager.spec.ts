/** Companion handshake, restart, and bounded shutdown lifecycle. */

import { describe, expect, it, vi } from 'vitest'
import {
  sendVsCodeFrame,
  VsCodeWireDecoder,
} from '@deepseek-ai/dsh-client-connection-vscode/codec'
import {
  VSCODE_CARRIER_PROTOCOL_VERSION,
  VsCodeStreamId,
  type ControlReadyFrame,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import {
  RuntimeManager,
  type RuntimeChild,
  type RuntimeManagerState,
} from '../src/runtime-manager.ts'

const runtime = {
  nodePath: '/real/node',
  companionEntry: '/runtime/lib/vscode-companion.js',
  packageRoot: '/runtime',
  runtimeVersion: '0.1.0',
  discoveryPath: '/bin/dsh',
}

const ready = (protocolVersion = VSCODE_CARRIER_PROTOCOL_VERSION): ControlReadyFrame => ({
  type: 'control/ready',
  protocolVersion,
  runtimeVersion: '0.1.0',
  graph: { rev: 'empty', entries: [] },
  bundles: [],
  maxLogicalRpcBytes: 4096,
})

class ChildHarness implements RuntimeChild {
  connected = true
  killed = 0
  readonly sent: VsCodeCarrierFrame[] = []
  private readonly decoder = new VsCodeWireDecoder({ maxLogicalRpcBytes: 4096 })
  private readonly messages = new Set<(value: unknown) => void>()
  private readonly exits = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()

  constructor(private readonly respond: (frame: VsCodeCarrierFrame, child: ChildHarness) => void) {}

  async send(record: VsCodeWireRecord): Promise<void> {
    const frame = await this.decoder.accept(record)
    if (frame === undefined) return
    this.sent.push(frame)
    this.respond(frame, this)
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.messages.add(listener)
    return () => { this.messages.delete(listener) }
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exits.add(listener)
    return () => { this.exits.delete(listener) }
  }

  async emit(frame: VsCodeCarrierFrame): Promise<void> {
    await sendVsCodeFrame(frame, async (record) => {
      for (const listener of this.messages) listener(record)
    }, { maxLogicalRpcBytes: 4096 })
  }

  exit(code = 1): void {
    this.connected = false
    for (const listener of this.exits) listener(code, null)
  }

  forceKill(): void {
    this.killed++
    this.exit(-1)
  }

  dispose(): void {
    this.connected = false
    this.decoder.dispose()
    this.messages.clear()
    this.exits.clear()
  }
}

function readyChild(overrides: { protocol?: number; shutdown?: boolean } = {}): ChildHarness {
  return new ChildHarness((frame, child) => {
    if (frame.type === 'control/hello') void child.emit(ready(overrides.protocol))
    if (frame.type === 'control/shutdown' && overrides.shutdown !== false) {
      void child.emit({ type: 'control/shutdown-complete' }).then(() => { child.exit(0) })
    }
  })
}

describe('VS Code runtime manager', () => {
  it('is lazy until start and publishes a verified ready handshake', async () => {
    const resolveRuntime = vi.fn(async () => runtime)
    const launchChild = vi.fn(() => readyChild())
    const manager = new RuntimeManager({ resolveRuntime, launchChild, extensionVersion: '0.1.0' })
    expect(resolveRuntime).not.toHaveBeenCalled()
    await expect(manager.start({ workspaceRoot: '/workspace', locale: 'zh-cn' })).resolves
      .toMatchObject({ protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION, runtimeVersion: '0.1.0' })
    expect(manager.state).toBe('ready')
    expect(launchChild).toHaveBeenCalledWith(runtime, '/workspace')
    await manager.stop()
  })

  it('surfaces handshake mismatch and home-busy without entering ready state', async () => {
    const mismatch = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => readyChild({ protocol: 99 }),
      extensionVersion: '0.1.0',
    })
    await expect(mismatch.start({ workspaceRoot: '/workspace', locale: 'en' }))
      .rejects.toThrow(/protocol/i)
    expect(mismatch.state).toBe('failed')

    const busy = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => new ChildHarness((frame, child) => {
        if (frame.type === 'control/hello') {
          void child.emit({ type: 'control/error', code: 'home-busy', message: 'another owner' })
        }
      }),
      extensionVersion: '0.1.0',
    })
    await expect(busy.start({ workspaceRoot: '/workspace', locale: 'en' }))
      .rejects.toThrow(/home-busy.*another owner/i)
    expect(busy.state).toBe('failed')
    expect(busy.failureMessage).toMatch(/home-busy.*another owner/i)
  })

  it('forwards records queued immediately behind the ready handshake', async () => {
    const child = new ChildHarness((frame, owned) => {
      if (frame.type === 'control/hello') {
        void owned.emit(ready())
        void owned.emit({ type: 'stream/opened', streamId: VsCodeStreamId('immediate-stream') })
      }
      if (frame.type === 'control/shutdown') {
        void owned.emit({ type: 'control/shutdown-complete' }).then(() => { owned.exit(0) })
      }
    })
    const manager = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => child,
      extensionVersion: '0.1.0',
    })
    const records: unknown[] = []
    manager.subscribe((value) => { records.push(value) })
    await manager.start({ workspaceRoot: '/workspace', locale: 'en' })
    await vi.waitFor(() => { expect(records.length).toBeGreaterThan(0) })
    const decoder = new VsCodeWireDecoder({ maxLogicalRpcBytes: 4096 })
    let forwarded: VsCodeCarrierFrame | undefined
    for (const record of records) forwarded = await decoder.accept(record)
    expect(forwarded).toEqual({ type: 'stream/opened', streamId: 'immediate-stream' })
    decoder.dispose()
    await manager.stop()
  })

  it('uses graceful shutdown acknowledgement and forces a child after the deadline', async () => {
    const gracefulChild = readyChild()
    const graceful = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => gracefulChild,
      extensionVersion: '0.1.0',
      shutdownTimeoutMs: 30,
    })
    await graceful.start({ workspaceRoot: '/workspace', locale: 'en' })
    await graceful.stop()
    expect(gracefulChild.sent.some(frame => frame.type === 'control/shutdown')).toBe(true)
    expect(gracefulChild.killed).toBe(0)

    const stuckChild = readyChild({ shutdown: false })
    const stuck = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => stuckChild,
      extensionVersion: '0.1.0',
      shutdownTimeoutMs: 10,
    })
    await stuck.start({ workspaceRoot: '/workspace', locale: 'en' })
    await stuck.stop()
    expect(stuckChild.killed).toBe(1)
    expect(stuck.state).toBe('idle')
  })

  it('forces a connected child when the graceful shutdown frame cannot be sent', async () => {
    const child = readyChild()
    const manager = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => child,
      extensionVersion: '0.1.0',
      shutdownTimeoutMs: 10,
    })
    await manager.start({ workspaceRoot: '/workspace', locale: 'en' })
    vi.spyOn(child, 'send').mockRejectedValue(new Error('IPC send failed'))
    await expect(manager.stop()).resolves.toBeUndefined()
    expect(child.killed).toBe(1)
    expect(manager.state).toBe('idle')
  })

  it('bounds automatic restarts after unexpected exits', async () => {
    const children: ChildHarness[] = []
    const states: RuntimeManagerState[] = []
    const manager = new RuntimeManager({
      resolveRuntime: async () => runtime,
      launchChild: () => {
        const child = readyChild()
        children.push(child)
        return child
      },
      extensionVersion: '0.1.0',
      restartAttempts: 1,
    })
    manager.subscribeState((state) => { states.push(state) })
    await manager.start({ workspaceRoot: '/workspace', locale: 'en' })
    children[0]?.exit()
    await vi.waitFor(() => { expect(children).toHaveLength(2) })
    await vi.waitFor(() => { expect(manager.state).toBe('ready') })
    children[1]?.exit()
    await vi.waitFor(() => { expect(manager.state).toBe('failed') })
    expect(children).toHaveLength(2)
    expect(states).toContain('restarting')
  })
})
