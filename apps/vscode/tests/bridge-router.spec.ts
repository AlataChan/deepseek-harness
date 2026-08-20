/** Webview allowlist routing, context bounds, and verified bundle caching. */

import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest, type ServerResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  EditorContextId,
  IdeRequestId,
  type WebviewBridgeMessage,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { sendVsCodeFrame } from '@deepseek-ai/dsh-client-connection-vscode/codec'
import {
  BridgeRouter,
  cacheVerifiedBundles,
  validateContextLimits,
  type BridgeRecordPort,
  type BridgeWebviewPort,
} from '../src/bridge-router.ts'
import type { HostRpcRouting } from '../src/host-rpc-interceptor.ts'

class RecordPort implements BridgeRecordPort {
  sent: VsCodeWireRecord[] = []
  private readonly listeners = new Set<(value: unknown) => void>()
  async send(record: VsCodeWireRecord): Promise<void> { this.sent.push(record) }
  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  receive(value: unknown): void { for (const listener of this.listeners) listener(value) }
}

class WebviewPort implements BridgeWebviewPort {
  sent: WebviewBridgeMessage[] = []
  private readonly listeners = new Set<(value: unknown) => void>()
  async postMessage(message: WebviewBridgeMessage): Promise<boolean> { this.sent.push(message); return true }
  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  receive(value: unknown): void { for (const listener of this.listeners) listener(value) }
}

describe('VS Code bridge router', () => {
  it('intercepts logical Host RPC while forwarding every unowned carrier record unchanged', async () => {
    const runtime = new RecordPort()
    const webview = new WebviewPort()
    const descriptions = new Set<string>()
    const disposeHostRpc = vi.fn()
    const hostRpc: HostRpcRouting = {
      interceptRequest: vi.fn(async (request: ClientRequest): Promise<ServerResponse | undefined> => {
        if (request.method === 'host.describe') descriptions.add(request.rpcId)
        if (request.method !== 'host.openPath') return undefined
        return {
          type: 'server-response', rpcId: request.rpcId,
          result: { ok: true, value: { opened: true } },
        }
      }),
      interceptResponse: vi.fn((response: ServerResponse): ServerResponse => {
        if (!descriptions.delete(response.rpcId) || !response.result.ok) return response
        return {
          ...response,
          result: { ok: true, value: { ...(response.result.value as object), canOpenPath: true } },
        }
      }),
      dispose: disposeHostRpc,
    }
    const router = new BridgeRouter({ runtime, webview, hostRpc })
    const record = (message: ClientRequest | ServerResponse): VsCodeWireRecord => ({
      type: 'wire/message', encoded: JSON.stringify({ type: 'rpc/message', message }),
    })

    const ordinary: ClientRequest = {
      type: 'client-request', rpcId: RpcId('ordinary'), method: 'session.list', payload: { marker: true },
    }
    const ordinaryRecord = record(ordinary)
    webview.receive({ type: 'carrier', record: ordinaryRecord })
    await vi.waitFor(() => { expect(runtime.sent).toEqual([ordinaryRecord]) })

    const fragmented: ClientRequest = {
      type: 'client-request', rpcId: RpcId('fragmented'), method: 'session.list',
      payload: { marker: 'x'.repeat(500) },
    }
    await sendVsCodeFrame(
      { type: 'rpc/message', message: fragmented },
      async (item) => { webview.receive({ type: 'carrier', record: item }) },
      { maxWireRecordBytes: 180, maxLogicalRpcBytes: 4096 },
    )
    await vi.waitFor(() => { expect(runtime.sent).toHaveLength(2) })
    expect(runtime.sent[1]).toMatchObject({ type: 'wire/message' })
    if (runtime.sent[1]?.type !== 'wire/message') throw new Error('expected re-encoded logical frame')
    expect(JSON.parse(runtime.sent[1].encoded)).toEqual({ type: 'rpc/message', message: fragmented })

    const open: ClientRequest = {
      type: 'client-request', rpcId: RpcId('open'), method: 'host.openPath', payload: { path: '/workspace/a.ts' },
    }
    webview.receive({ type: 'carrier', record: record(open) })
    await vi.waitFor(() => {
      expect(webview.sent.some((message) => {
        if (message.type !== 'carrier' || message.record.type !== 'wire/message') return false
        return message.record.encoded.includes('"rpcId":"open"')
      })).toBe(true)
    })
    expect(runtime.sent).toHaveLength(2)

    const describe: ClientRequest = {
      type: 'client-request', rpcId: RpcId('describe'), method: 'host.describe', payload: {},
    }
    const describeRecord = record(describe)
    webview.receive({ type: 'carrier', record: describeRecord })
    await vi.waitFor(() => { expect(runtime.sent.at(-1)).toEqual(describeRecord) })
    await sendVsCodeFrame({
      type: 'rpc/message',
      message: {
        type: 'server-response', rpcId: RpcId('describe'),
        result: {
          ok: true,
          value: {
            version: '1', cwd: '/workspace', attachedSessions: 0, home: '/home/test',
            canOpenPath: false, padding: 'x'.repeat(500),
          },
        },
      },
    }, async (item) => { runtime.receive(item) }, { maxWireRecordBytes: 180, maxLogicalRpcBytes: 4096 })
    await vi.waitFor(() => {
      expect(webview.sent.some((message) => {
        if (message.type !== 'carrier' || message.record.type !== 'wire/message') return false
        return message.record.encoded.includes('"canOpenPath":true')
      })).toBe(true)
    })
    router.dispose()
    expect(disposeHostRpc).toHaveBeenCalledOnce()
  })

  it('relays parsed carrier records and dispatches only declared IDE methods', async () => {
    const runtime = new RecordPort()
    const webview = new WebviewPort()
    const violations: Error[] = []
    const getTurnState = vi.fn(async () => ({ running: true }))
    const router = new BridgeRouter({
      runtime,
      webview,
      ideHandlers: { 'webview.getTurnState': getTurnState },
      onViolation: (error) => { violations.push(error) },
    })
    const record: VsCodeWireRecord = { type: 'wire/message', encoded: '{}' }
    webview.receive({ type: 'carrier', record })
    await vi.waitFor(() => { expect(runtime.sent).toEqual([record]) })
    runtime.receive(record)
    await vi.waitFor(() => { expect(webview.sent).toContainEqual({ type: 'carrier', record }) })

    webview.receive({
      type: 'ide/request',
      requestId: IdeRequestId('turn-1'),
      method: 'webview.getTurnState',
      payload: {},
    })
    await vi.waitFor(() => {
      expect(webview.sent).toContainEqual({
        type: 'ide/response', requestId: 'turn-1', method: 'webview.getTurnState',
        ok: true, result: { running: true },
      })
    })
    expect(getTurnState).toHaveBeenCalledOnce()

    webview.receive({
      type: 'ide/request', requestId: 'bad', method: 'vscode.executeCommand', payload: { command: 'workbench.action.closeWindow' },
    })
    await vi.waitFor(() => { expect(violations).toHaveLength(1) })
    expect(getTurnState).toHaveBeenCalledOnce()
    router.dispose()
  })

  it('rejects context settings that cannot fit one fixed-cap IDE message', () => {
    expect(validateContextLimits({ maxSelectionBytes: 128_000, maxFileBytes: 512_000, maxDiagnostics: 200 }))
      .toEqual({ maxSelectionBytes: 128_000, maxFileBytes: 512_000, maxDiagnostics: 200 })
    expect(() => validateContextLimits({
      maxSelectionBytes: 1024 * 1024,
      maxFileBytes: 512_000,
      maxDiagnostics: 200,
    })).toThrow(/selection.*IDE message/i)
    expect(() => validateContextLimits({
      maxSelectionBytes: 128_000,
      maxFileBytes: 512_000,
      maxDiagnostics: 100_000,
    })).toThrow(/diagnostics/i)
  })

  it('correlates extension-initiated requests implemented by the Webview', async () => {
    const runtime = new RecordPort()
    const webview = new WebviewPort()
    const router = new BridgeRouter({ runtime, webview })
    const result = router.requestWebview('webview.getTurnState', {})
    await vi.waitFor(() => {
      expect(webview.sent).toHaveLength(1)
      expect(webview.sent[0]).toMatchObject({ type: 'ide/request', method: 'webview.getTurnState' })
    })
    const request = webview.sent[0]
    if (request?.type !== 'ide/request') throw new Error('expected an IDE request')
    webview.receive({
      type: 'ide/response', requestId: request.requestId, method: request.method,
      ok: true, result: { running: false },
    })
    await expect(result).resolves.toEqual({ running: false })
    router.dispose()
  })

  it('rejects extension-initiated IDE messages above the fixed outer limit', async () => {
    const runtime = new RecordPort()
    const webview = new WebviewPort()
    const violations: Error[] = []
    const router = new BridgeRouter({ runtime, webview, onViolation: (error) => { violations.push(error) } })
    await expect(router.sendEvent({
      type: 'ide/event',
      event: 'editor.contextCaptured',
      payload: {
        snapshot: {
          id: EditorContextId('oversized'),
          kind: 'file',
          uri: 'file:///workspace/large.txt',
          text: 'x'.repeat(1024 * 1024),
          capturedAt: 1,
        },
      },
    })).rejects.toThrow(/IDE-message limit/i)
    expect(webview.sent).toHaveLength(0)
    expect(violations).toHaveLength(1)
  })

  it('copies only bundle bytes whose id, revision, and SHA-256 match the ready graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-vscode-bundles-'))
    const sourcePath = join(root, 'source.js')
    const bytes = 'globalThis.bundleLoaded = true\n'
    writeFileSync(sourcePath, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const frame = {
      type: 'control/ready' as const,
      protocolVersion: 1,
      runtimeVersion: '0.1.0',
      graph: { rev: 'graph-rev', entries: [{ id: 'plugin', rev: 'bundle-rev', url: '/plugins/plugin' }] },
      bundles: [{ id: 'plugin', rev: 'bundle-rev', sourcePath, sha256 }],
      maxLogicalRpcBytes: 4096,
    }
    const cached = await cacheVerifiedBundles(frame, join(root, 'cache'), path => `webview:${path}`)
    expect(cached.graph.entries[0]?.url).toMatch(/^webview:/)
    expect(cached.resourceRoot).toContain('cache')

    await expect(cacheVerifiedBundles({
      ...frame,
      bundles: [{ ...frame.bundles[0]!, sha256: '0'.repeat(64) }],
    }, join(root, 'bad-cache'), path => path)).rejects.toThrow(/hash/i)
  })
})
