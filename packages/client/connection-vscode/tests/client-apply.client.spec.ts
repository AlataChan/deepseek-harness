/** VS Code client plugin mounting and ConnectionController reconnect behavior. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { connectionHandleBehavior } from '../../connection/tests/connection-handle.behavior.client.ts'
import { Config, VsCodeApiClient, apply, inject } from '../src/client/index.ts'
import { type VsCodeCarrierFrame } from '../src/protocol.ts'
import { BridgeHarness } from './bridge-harness.client.ts'

const DESCRIPTION = {
  version: '0.1.0', cwd: '/workspace', attachedSessions: 0, canOpenPath: true,
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

async function mount(port = respondingPort()): Promise<{ ctx: Context; handle: ConnectionHandle; port: BridgeHarness }> {
  const ctx = new Context()
  ctx.reflect.provide('vscodeBridge', port)
  await ctx.plugin({ apply, inject, Config }, { responseTimeoutMs: 100 })
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) throw new Error('ctx.connection not provided')
  return { ctx, handle, port }
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

  it('reconnects both streams with fresh ids after a downlink generation ends', async () => {
    const { ctx, handle, port } = await mount()
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
      const first = port.sent.filter(
        (frame): frame is Extract<VsCodeCarrierFrame, { type: 'stream/open' }> => frame.type === 'stream/open',
      )
      await port.receive({ type: 'stream/end', streamId: first[0]!.streamId })
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

  it('fails loud when the shell did not provide the private bridge service', () => {
    expect(() => { apply(new Context(), { responseTimeoutMs: 100 }) }).toThrow(/vscodeBridge/)
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
