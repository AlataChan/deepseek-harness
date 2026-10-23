/** Unary deadlines on the desktop/VS Code process carrier. */

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD,
  ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS,
  ASK_KNOWLEDGE_FINISH_INGEST_METHOD,
  ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS,
  DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS,
  ProcessTransport,
  unaryResponseTimeoutMs,
  type ProcessBridgePort,
} from '../src/client/api-client.ts'

afterEach(() => {
  vi.useRealTimers()
})

function silentPort(): ProcessBridgePort {
  return {
    maxLogicalRpcBytes: 64_000,
    send: async () => {},
    subscribe: () => () => {},
  }
}

function requestBody(method: string, rpcId: string): string {
  return JSON.stringify({
    type: 'client-request',
    rpcId,
    method,
    payload: {},
  })
}

function asError(value: Promise<Response>): Promise<Error> {
  return value.then(
    () => {
      throw new Error('expected the unary to time out')
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  )
}

it('keeps unary correlation alive across graph snapshots owned by the surface', async () => {
  let receive: (value: unknown) => void = () => { throw new Error('missing receiver') }
  const transport = new ProcessTransport({
    ...silentPort(),
    subscribe(listener) { receive = listener; return () => {} },
  })
  onTestFinished(() => { transport.dispose() })
  const response = transport.fetch('/api', { body: requestBody('session/list', 'graph-rpc') })
  for (const rev of ['graph-1', 'graph-2']) receive({
    type: 'wire/message', encoded: JSON.stringify({
      type: 'control/ready', protocolVersion: 2, runtimeVersion: '1.0.0',
      graph: { rev, entries: [], batches: [], release: { version: '1.0.0' } },
      bundles: [], maxLogicalRpcBytes: 64000,
    }),
  })
  receive({ type: 'wire/message', encoded: JSON.stringify({
    type: 'rpc/message', message: { type: 'server-response', rpcId: 'graph-rpc', result: { ok: true, value: [] } },
  }) })
  expect(await (await response).json()).toMatchObject({ result: { ok: true, value: [] } })
})

it('continues rejecting a Host hello on the downlink', async () => {
  let receive: (value: unknown) => void = () => { throw new Error('missing receiver') }
  const transport = new ProcessTransport({
    ...silentPort(), subscribe(listener) { receive = listener; return () => {} },
  })
  onTestFinished(() => { transport.dispose() })
  const response = transport.fetch('/api', { body: requestBody('session/list', 'bad-control') })
  receive({ type: 'wire/message', encoded: JSON.stringify({
    type: 'control/hello', protocolVersion: 2, extensionVersion: '1.0.0', workspaceRoot: '/tmp/work', locale: 'en',
  }) })
  await expect(response).rejects.toThrow('control/hello is not accepted from the desktop downlink')
})

describe('unaryResponseTimeoutMs', () => {
  it('keeps the default 30s unary except finish ingest and finish extract', () => {
    expect(DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS).toBe(30_000)
    expect(unaryResponseTimeoutMs('session/listAskKnowledgeLibraries', 30_000)).toBe(30_000)
    expect(unaryResponseTimeoutMs(ASK_KNOWLEDGE_FINISH_INGEST_METHOD, 30_000))
      .toBe(ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS)
    expect(ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000)
    expect(unaryResponseTimeoutMs(ASK_KNOWLEDGE_FINISH_INGEST_METHOD, 600_000)).toBe(600_000)
    expect(unaryResponseTimeoutMs(ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD, 30_000))
      .toBe(ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS)
    expect(ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS).toBe(90_000)
    expect(unaryResponseTimeoutMs(ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD, 600_000)).toBe(600_000)
  })
})

describe('ProcessTransport finishAskKnowledgeIngest deadline', () => {
  it('does not time out finishAskKnowledgeIngest at the default 30s unary', async () => {
    vi.useFakeTimers()
    const transport = new ProcessTransport(silentPort())
    const short = asError(transport.fetch('http://dsh.internal/api/x', {
      method: 'POST',
      body: requestBody('session/listAskKnowledgeLibraries', 'rpc-short'),
    }))
    const finish = asError(transport.fetch('http://dsh.internal/api/x', {
      method: 'POST',
      body: requestBody(ASK_KNOWLEDGE_FINISH_INGEST_METHOD, 'rpc-finish'),
    }))
    const finishState = { done: false }
    void finish.finally(() => { finishState.done = true })

    await vi.advanceTimersByTimeAsync(DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS)
    expect((await short).message).toBe('desktop API request session/listAskKnowledgeLibraries timed out')
    expect(finishState.done).toBe(false)

    await vi.advanceTimersByTimeAsync(ASK_KNOWLEDGE_FINISH_INGEST_TIMEOUT_MS - DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS)
    expect(finishState.done).toBe(true)
    expect((await finish).message).toBe(
      `desktop API request ${ASK_KNOWLEDGE_FINISH_INGEST_METHOD} timed out`,
    )
    transport.dispose()
  })
})

describe('ProcessTransport finishAskKnowledgeExtract deadline', () => {
  it('does not time out finishAskKnowledgeExtract at the default 30s unary', async () => {
    vi.useFakeTimers()
    const transport = new ProcessTransport(silentPort())
    const finish = asError(transport.fetch('http://dsh.internal/api/x', {
      method: 'POST',
      body: requestBody(ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD, 'rpc-extract'),
    }))
    const finishState = { done: false }
    void finish.finally(() => { finishState.done = true })

    await vi.advanceTimersByTimeAsync(DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS)
    expect(finishState.done).toBe(false)

    await vi.advanceTimersByTimeAsync(
      ASK_KNOWLEDGE_FINISH_EXTRACT_TIMEOUT_MS - DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS,
    )
    expect(finishState.done).toBe(true)
    expect((await finish).message).toBe(
      `desktop API request ${ASK_KNOWLEDGE_FINISH_EXTRACT_METHOD} timed out`,
    )
    transport.dispose()
  })
})
