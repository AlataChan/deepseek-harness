/** Unary deadlines on the desktop/VS Code process carrier. */

import { afterEach, describe, expect, it, vi } from 'vitest'
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
