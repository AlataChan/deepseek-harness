import { describe, expect, it } from 'vitest'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  EditorContextId,
  IdeRequestId,
  VSCODE_CARRIER_PROTOCOL_VERSION,
  VsCodeStreamId,
  WireMessageId,
  editorContextIdSchema,
  editorContextSnapshotSchema,
  ideRequestSchema,
  ideResponseSchema,
  vsCodeCarrierFrameSchema,
  vsCodeWireRecordSchema,
  webviewBridgeMessageSchema,
  type EditorContextSnapshot,
  type IdeEvent,
  type IdeRequest,
  type IdeResponse,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '../src/protocol.ts'

const streamId = VsCodeStreamId('stream-1')

function readyFrame(): VsCodeCarrierFrame {
  return {
    type: 'control/ready',
    protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
    runtimeVersion: '0.1.0-rc.5',
    graph: { rev: 'graph-rev', entries: [] },
    bundles: [{
      id: '@fixture/client',
      rev: 'bundle-rev',
      sourcePath: '/workspace/node_modules/@fixture/client/lib/client.js',
      sha256: 'a'.repeat(64),
    }],
    maxLogicalRpcBytes: 4096,
  }
}

describe('VS Code carrier frame schema', () => {
  it('parses every logical frame discriminant', () => {
    const frames: VsCodeCarrierFrame[] = [
      {
        type: 'control/hello',
        protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
        extensionVersion: '0.1.0',
        workspaceRoot: '/workspace',
        locale: 'zh-cn',
      },
      readyFrame(),
      { type: 'control/error', code: 'incompatible-version', message: 'upgrade required' },
      { type: 'control/shutdown' },
      { type: 'control/shutdown-complete' },
      {
        type: 'rpc/message',
        message: {
          type: 'client-request', rpcId: RpcId('rpc-1'), method: 'host.describe', payload: {},
        },
      },
      { type: 'rpc/receipt', rpcId: RpcId('rpc-2'), receipt: { accepted: true } },
      { type: 'stream/open', streamId, stream: 'mux', payload: {} },
      { type: 'stream/open', streamId, stream: 'host', payload: {} },
      { type: 'stream/opened', streamId },
      {
        type: 'stream/frame',
        streamId,
        message: {
          type: 'server-request',
          rpcId: RpcId('frame-1'),
          method: 'host/session-status',
          payload: { type: 'host/session-status', sessionId: 'session-1', running: true },
        },
      },
      { type: 'stream/close', streamId },
      { type: 'stream/end', streamId },
      { type: 'stream/error', streamId, message: 'stream failed' },
    ]

    expect(frames.map(frame => vsCodeCarrierFrameSchema.parse(frame))).toEqual(frames)
  })

  it('uses ApiProxy-owned validation for both stream-open payloads', () => {
    expect(vsCodeCarrierFrameSchema.parse({
      type: 'stream/open',
      streamId,
      stream: 'mux',
      payload: { since: { 'session-1': 7 } },
    })).toMatchObject({ payload: { since: { 'session-1': 7 } } })
    expect(() => vsCodeCarrierFrameSchema.parse({
      type: 'stream/open', streamId, stream: 'mux', payload: { since: { 'session-1': '7' } },
    })).toThrow()
    expect(() => vsCodeCarrierFrameSchema.parse({
      type: 'stream/open', streamId, stream: 'host', payload: { undeclared: true },
    })).toThrow()
  })

  it('rejects malformed nested RPC, graph, bundle, and id fields', () => {
    expect(() => vsCodeCarrierFrameSchema.parse({
      type: 'rpc/message', message: { type: 'client-request', rpcId: 1, method: 'host.describe', payload: {} },
    })).toThrow()
    expect(() => vsCodeCarrierFrameSchema.parse({
      ...readyFrame(), bundles: [{ id: 'x', rev: 'r', sourcePath: '/x', sha256: 'not-a-digest' }],
    })).toThrow()
    expect(() => vsCodeCarrierFrameSchema.parse({
      type: 'stream/end', streamId: '',
    })).toThrow()
    expect(editorContextIdSchema.parse(EditorContextId('context-1'))).toBe('context-1')
    expect(() => editorContextIdSchema.parse('')).toThrow()
  })
})

describe('VS Code wire-record schema', () => {
  it('parses every physical record discriminant', () => {
    const messageId = WireMessageId('message-1')
    const records: VsCodeWireRecord[] = [
      { type: 'wire/message', encoded: '{"type":"control/shutdown"}' },
      { type: 'wire/chunk-start', messageId, totalBytes: 12, sha256: 'b'.repeat(64) },
      { type: 'wire/chunk', messageId, index: 0, data: 'e30=' },
      { type: 'wire/chunk-end', messageId, chunks: 1 },
    ]

    expect(records.map(record => vsCodeWireRecordSchema.parse(record))).toEqual(records)
  })

  it('rejects invalid counts, digests, ids, and unknown record types', () => {
    expect(() => vsCodeWireRecordSchema.parse({
      type: 'wire/chunk-start', messageId: 'm', totalBytes: -1, sha256: 'a'.repeat(64),
    })).toThrow()
    expect(() => vsCodeWireRecordSchema.parse({
      type: 'wire/chunk', messageId: '', index: 0, data: '',
    })).toThrow()
    expect(() => vsCodeWireRecordSchema.parse({
      type: 'wire/chunk-end', messageId: 'm', chunks: 0,
    })).toThrow()
    expect(() => vsCodeWireRecordSchema.parse({ type: 'wire/other' })).toThrow()
  })
})

describe('VS Code Webview IDE schema', () => {
  const requestId = IdeRequestId('ide-1')
  const snapshot: EditorContextSnapshot = {
    id: EditorContextId('context-1'),
    kind: 'selection',
    uri: 'file:///workspace/src/index.ts',
    workspacePath: 'src/index.ts',
    languageId: 'typescript',
    version: 4,
    range: { startLine: 1, startColumn: 2, endLine: 3, endColumn: 4 },
    text: 'const value = 1',
    capturedAt: 42,
  }

  it('parses every allowlisted request and its exact successful response', () => {
    const requests: IdeRequest[] = [
      { type: 'ide/request', requestId, method: 'webview.getTurnState', payload: {} },
      { type: 'ide/request', requestId, method: 'webview.newSession', payload: {} },
      { type: 'ide/request', requestId, method: 'workspace.getSelectedRoot', payload: {} },
      { type: 'ide/request', requestId, method: 'editor.captureSelection', payload: {} },
      { type: 'ide/request', requestId, method: 'editor.captureFile', payload: {} },
      { type: 'ide/request', requestId, method: 'editor.captureDiagnostics', payload: {} },
      { type: 'ide/request', requestId, method: 'runtime.restart', payload: {} },
      { type: 'ide/request', requestId, method: 'logs.show', payload: {} },
    ]
    const responses: IdeResponse[] = [
      { type: 'ide/response', requestId, method: 'webview.getTurnState', ok: true, result: { running: true } },
      { type: 'ide/response', requestId, method: 'webview.newSession', ok: true, result: {} },
      {
        type: 'ide/response', requestId, method: 'workspace.getSelectedRoot', ok: true,
        result: { workspaceRoot: '/workspace' },
      },
      { type: 'ide/response', requestId, method: 'editor.captureSelection', ok: true, result: snapshot },
      { type: 'ide/response', requestId, method: 'editor.captureFile', ok: true, result: null },
      { type: 'ide/response', requestId, method: 'editor.captureDiagnostics', ok: true, result: snapshot },
      { type: 'ide/response', requestId, method: 'runtime.restart', ok: true, result: { accepted: true } },
      { type: 'ide/response', requestId, method: 'logs.show', ok: true, result: {} },
    ]
    expect(requests.map(request => ideRequestSchema.parse(request))).toEqual(requests)
    expect(responses.map(response => ideResponseSchema.parse(response))).toEqual(responses)
    expect(editorContextSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })

  it('parses failures and every extension-initiated event', () => {
    const failure: IdeResponse = {
      type: 'ide/response', requestId, method: 'editor.captureFile', ok: false, error: 'no editor',
    }
    const events: IdeEvent[] = [
      { type: 'ide/event', event: 'runtime.state', payload: { state: 'failed', message: 'stopped' } },
      { type: 'ide/event', event: 'workspace.selected', payload: { workspaceRoot: '/workspace' } },
      { type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot } },
    ]
    expect(ideResponseSchema.parse(failure)).toEqual(failure)
    expect(events.map(event => webviewBridgeMessageSchema.parse(event))).toEqual(events)
    expect(webviewBridgeMessageSchema.parse({
      type: 'carrier', record: { type: 'wire/message', encoded: '{}' },
    })).toMatchObject({ type: 'carrier' })
  })

  it('rejects undeclared methods, mismatched results, mutable snapshot fields, and unknown outer messages', () => {
    expect(() => ideRequestSchema.parse({
      type: 'ide/request', requestId, method: 'vscode.executeCommand', payload: { command: 'closeWindow' },
    })).toThrow()
    expect(() => ideResponseSchema.parse({
      type: 'ide/response', requestId, method: 'webview.getTurnState', ok: true, result: {},
    })).toThrow()
    expect(() => editorContextSnapshotSchema.parse({ ...snapshot, range: { startLine: -1 } })).toThrow()
    expect(() => webviewBridgeMessageSchema.parse({ type: 'command', command: 'closeWindow' })).toThrow()
  })
})
