/** VS Code client plugin mounting and ConnectionController reconnect behavior. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { connectionHandleBehavior } from '../../connection/tests/connection-handle.behavior.client.ts'
import { Config, VsCodeApiClient, apply, inject } from '../src/client/index.ts'
import type { VsCodeIdePort } from '../src/client/bridge-port.ts'
import {
  type IdeEvent,
  type IdeMethodMap,
  type VsCodeCarrierFrame,
} from '../src/protocol.ts'
import { BridgeHarness } from './bridge-harness.client.ts'

const DESCRIPTION = {
  version: '0.1.0', cwd: '/workspace', attachedSessions: 0, home: '/home/test', canOpenPath: true,
}

function respondingPort(): BridgeHarness {
  const port = new BridgeHarness()
  port.onFrame = async (frame) => {
    if (frame.type === 'stream/open') {
      await port.receive({ type: 'stream/opened', streamId: frame.streamId })
      return
    }
    if (frame.type === 'stream/close') {
      await port.receive({ type: 'stream/end', streamId: frame.streamId })
      return
    }
    if (frame.type !== 'rpc/message' || frame.message.type !== 'client-request') return
    const request: ClientRequest = frame.message
    await port.receive({
      type: 'rpc/message',
      message: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: DESCRIPTION } },
    })
  }
  return port
}

class IdeHarness implements VsCodeIdePort {
  private readonly listeners = new Set<(event: IdeEvent) => void>()

  request<K extends keyof IdeMethodMap>(
    _method: K,
    _payload: IdeMethodMap[K]['payload'],
  ): Promise<IdeMethodMap[K]['result']> {
    return Promise.reject(new Error('not implemented by the test harness'))
  }

  handle<K extends keyof IdeMethodMap>(
    _method: K,
    _handler: (payload: IdeMethodMap[K]['payload']) => IdeMethodMap[K]['result'] | Promise<IdeMethodMap[K]['result']>,
  ): () => void {
    return () => {}
  }

  subscribeEvents(listener: (event: IdeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(event: IdeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

async function mount(port = respondingPort()): Promise<{
  ctx: Context
  handle: ConnectionHandle
  ide: IdeHarness
  port: BridgeHarness
}> {
  const ctx = new Context()
  const ide = new IdeHarness()
  ctx.reflect.provide('vscodeBridge', port)
  ctx.reflect.provide('vscodeIde', ide)
  await ctx.plugin({ apply, inject, Config }, { responseTimeoutMs: 100 })
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) throw new Error('ctx.connection not provided')
  return { ctx, handle, ide, port }
}

connectionHandleBehavior('VS Code', async () => (await mount()).handle)

describe('VS Code client apply', () => {
  it('provides the VS Code API, loopback trust, and generic RPC handle', async () => {
    const { ctx, handle } = await mount()
    expect(handle.api).toBeInstanceOf(VsCodeApiClient)
    expect(handle.isLoopback).toBe(true)
    expect(handle.rpc).toBe((handle.api as VsCodeApiClient).rpc)
    await ctx.fiber.dispose()
    await expect(handle.api.host.describe({})).rejects.toThrow(/closed/)
  })

  it('reconnects both streams with fresh ids after a runtime generation restarts', async () => {
    const { ctx, handle, ide, port } = await mount()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const states: string[] = []
    const loop = handle.start({ onStateChange: (state) => { states.push(state) } }, {
      backoffBaseMs: 5, backoffFactor: 1, backoffMaxMs: 5, streamOpenTimeoutMs: 100,
    })
    try {
      await vi.waitFor(() => {
        expect(port.sent.filter(frame => frame.type === 'stream/open')).toHaveLength(2)
        expect(states).toEqual(['connected'])
      })
      ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'restarting' } })
      await vi.waitFor(() => { expect(states).toContain('reconnecting') })
      expect(port.sent.filter(frame => frame.type === 'stream/open')).toHaveLength(2)
      ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
      await vi.waitFor(() => {
        expect(port.sent.filter(frame => frame.type === 'stream/open')).toHaveLength(4)
        expect(states).toEqual(['connected', 'reconnecting', 'connected'])
      })
      const ids = port.sent
        .filter((frame): frame is Extract<VsCodeCarrierFrame, { type: 'stream/open' }> => frame.type === 'stream/open')
        .map(frame => frame.streamId)
      expect(new Set(ids)).toHaveProperty('size', 4)
    } finally {
      loop.stop()
      warn.mockRestore()
      await ctx.fiber.dispose()
    }
  })

  it('rejects unary work locally while a replacement runtime is not ready', async () => {
    const { ctx, handle, ide, port } = await mount()
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'failed' } })
    await expect(handle.api.host.describe({})).rejects.toThrow(/runtime generation failed/i)
    expect(port.sent).toHaveLength(0)
    ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
    await expect(handle.api.host.describe({})).resolves.toMatchObject({ result: { ok: true, value: DESCRIPTION } })
    await ctx.fiber.dispose()
  })

  it('fails loud when the shell did not provide the private bridge service', () => {
    expect(() => { apply(new Context(), { responseTimeoutMs: 100 }) }).toThrow(/vscodeBridge/)
  })

  it('fails loud when the shell did not provide the private IDE event service', () => {
    const ctx = new Context()
    ctx.reflect.provide('vscodeBridge', respondingPort())
    expect(() => { apply(ctx, { responseTimeoutMs: 100 }) }).toThrow(/vscodeIde/)
  })

  it('rejects a mismatched response id during mounted operation', async () => {
    const port = new BridgeHarness()
    port.onFrame = async (frame) => {
      if (frame.type !== 'rpc/message' || frame.message.type !== 'client-request') return
      await port.receive({
        type: 'rpc/message',
        message: {
          type: 'server-response', rpcId: RpcId('wrong-id'), result: { ok: true, value: DESCRIPTION },
        },
      })
    }
    const { ctx, handle } = await mount(port)
    await expect(handle.api.host.describe({})).rejects.toThrow(/uncorrelated/)
    await ctx.fiber.dispose()
  })
})
