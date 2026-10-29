import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TenantIpcClient, TenantIpcServer, IpcNotAdmittedError } from '../src/ipc.ts'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createServiceFixture } from './service-fixture.ts'
import type { SubmitDeliveryRequest } from '../src/ipc.ts'

const deliveryKey = JSON.stringify(['feishu', 'app', 'organization', 'chat', 'sender', 'event'])
function request(overrides: Partial<SubmitDeliveryRequest> = {}): SubmitDeliveryRequest {
  return { id: randomUUID(), type: 'submit_delivery', deliveryKey, requestId: randomUUID(), operatorId: 'operator-a',
    prompt: 'hello', sessionId: null, ...overrides }
}

describe('Tenant runtime real Agent integration', () => {
  it('admits simultaneous retries once and recovers the real completed turn', async () => {
    const f = await createServiceFixture()
    try {
      const input = request()
      const responses = await Promise.all(Array.from({ length: 12 }, () => f.runtime.handleSubmitDelivery({ ...input, id: randomUUID() })))
      expect(new Set(responses.map(result => result.requestId))).toEqual(new Set([input.requestId]))
      await vi.waitFor(async () => {
        const result = await f.runtime.handleGetDelivery({ id: 'get', type: 'get_delivery', deliveryKey })
        expect(result.reconciliation).toMatchObject({ state: 'completed', resultText: 'public final reply' })
      })
      expect(f.adapter.calls).toBe(1)
      const events = [...f.handles.values()][0]?.agent.session.snapshotEvents() ?? []
      expect(events.filter(event => event.type === 'user/message')).toHaveLength(1)
      expect(events.find(event => event.type === 'user/message')?.data.source).toMatchObject({ kind: 'user', rpcId: input.requestId })
      await f.runtime.handleClientDisconnected()
      await expect(f.runtime.handleSubmitDelivery(request())).rejects.toThrow('disconnected')
    } finally { await f.close() }
  })

  it('reports an owned live delivery as admitted before its prompt is readable', async () => {
    const f = await createServiceFixture(true)
    try {
      const input = request()
      const admitted = await f.runtime.handleSubmitDelivery(input)
      const read = vi.spyOn(f.provider, 'readSessionLog').mockResolvedValueOnce({
        id: admitted.sessionId, events: [],
      })
      const result = await f.runtime.handleGetDelivery({ id: 'early-get', type: 'get_delivery', deliveryKey })
      expect(result.reconciliation).toEqual({ state: 'admitted', requestId: input.requestId, sessionId: admitted.sessionId })
      read.mockRestore()
      await f.runtime.handleCancelDelivery({ id: 'cancel-early', type: 'cancel_delivery', deliveryKey })
    } finally { await f.close() }
  })

  it('keeps a receipt-before-inbox crash uncertain and never replays it', async () => {
    const f = await createServiceFixture()
    try {
      const input = request()
      const agent = await f.provider.getOrCreateAgent(JSON.stringify(['feishu', 'app', 'organization', 'chat', 'sender']), f.operatorId, new AbortController().signal)
      await f.receipts.recordAdmitting({ deliveryKey, sessionId: agent.session.id, requestId: input.requestId, operatorId: f.operatorId })
      expect(await f.runtime.handleSubmitDelivery(input)).toMatchObject({ status: 'unknown', requestId: input.requestId })
      expect(f.adapter.calls).toBe(0)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(0)
      await expect(f.runtime.handleSubmitDelivery({ ...input, requestId: randomUUID() })).rejects.toThrow('Conflicting')
    } finally { await f.close() }
  })

  it('rejects unbound operator and arbitrary session selection before model work', async () => {
    const f = await createServiceFixture()
    try {
      await expect(f.runtime.handleSubmitDelivery(request({ operatorId: 'other-tenant' }))).rejects.toThrow('Unauthorized')
      await expect(f.runtime.handleSubmitDelivery(request({ sessionId: 'foreign-session' }))).rejects.toThrow('not bound')
      expect(f.adapter.calls).toBe(0)
      expect(f.receipts.getReceipt(deliveryKey)).toBeUndefined()
    } finally { await f.close() }
  })

  it('enforces active model capacity before publishing another conversation', async () => {
    const f = await createServiceFixture(true)
    try {
      await f.runtime.handleSubmitDelivery(request())
      await vi.waitFor(() => { expect(f.adapter.calls).toBe(1) })
      const secondKey = JSON.stringify(['feishu', 'app', 'organization', 'other-chat', 'sender', 'other-event'])
      await expect(f.runtime.handleSubmitDelivery(request({ deliveryKey: secondKey }))).rejects.toThrow('active delivery limit')
      expect(f.handles.size).toBe(1)
      expect(f.receipts.getReceipt(secondKey)).toBeUndefined()
      await f.runtime.handleCancelDelivery({ id: 'cancel', type: 'cancel_delivery', deliveryKey })
    } finally { await f.close() }
  })

  it('persists terminal cancellation before releasing the Agent lifetime on disconnect', async () => {
    const f = await createServiceFixture(true)
    try {
      const input = request()
      const admitted = await f.runtime.handleSubmitDelivery(input)
      await vi.waitFor(() => { expect(f.adapter.calls).toBe(1) })
      await f.runtime.handleClientDisconnected()
      const log = await f.provider.readSessionLog(SessionId(admitted.sessionId))
      expect(log?.events.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    } finally { await f.close() }
  })

  it('cancels a running model, preserves absent/completed outcomes and refuses raw approval context', async () => {
    const f = await createServiceFixture(true)
    try {
      await f.runtime.handleSubmitDelivery(request())
      await vi.waitFor(() =>{  expect(f.adapter.calls).toBe(1) })
      const result = await f.runtime.handleCancelDelivery({ id: 'cancel', type: 'cancel_delivery', deliveryKey })
      expect(result.status).toBe('cancelled')
      expect((await f.runtime.handleCancelDelivery({ id: 'absent', type: 'cancel_delivery', deliveryKey: 'absent' })).status).toBe('not_found')
      expect((await f.runtime.handleGetApprovalContext({ id: 'approval', type: 'get_approval_context', sessionId: 'foreign', callId: 'secret-call' })).context).toBeNull()
      await f.runtime.handleClientDisconnected()
    } finally { await f.close() }
  })
})


it.skipIf(process.platform === 'win32')('preserves capacity rejection before admission over a real POSIX Unix socket', async () => {
  const f = await createServiceFixture(true)
  const path = join(f.directory, 'tenant.sock')
  const server = new TenantIpcServer(path, f.runtime.config.tenantId, f.runtime)
  const client = new TenantIpcClient(path, 'ingress', f.runtime.config.tenantId)
  await server.listen()
  try {
    await client.connect()
    const first = request()
    await client.submitDelivery(first)
    await vi.waitFor(() => { expect(f.adapter.calls).toBe(1) })
    const second = request({ deliveryKey: JSON.stringify(['feishu', 'app', 'organization', 'other-chat', 'sender', 'second']) })
    await expect(client.submitDelivery(second)).rejects.toBeInstanceOf(IpcNotAdmittedError)
    expect(f.receipts.getReceipt(second.deliveryKey)).toBeUndefined()
    expect(f.handles.size).toBe(1)
    await client.cancelDelivery(first.deliveryKey)
    expect((await client.submitDelivery(second)).status).toBe('admitted')
    await client.cancelDelivery(second.deliveryKey)
    expect(f.handles.size).toBe(2)
  } finally {
    await client.close()
    await server.close()
    await f.close()
  }
})
