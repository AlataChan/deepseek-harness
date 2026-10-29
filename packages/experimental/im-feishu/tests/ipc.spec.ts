import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer } from 'node:net'
import { z } from 'zod'
import { PassThrough, Writable } from 'node:stream'
import { once } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import {
  IPC_PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  NdjsonLineBuffer,
  TenantIpcSession,
  TenantIpcServer,
  TenantIpcClient,
  ipcClientMessageSchema,
  type SubmitDeliveryRequest, type GetDeliveryRequest, type CancelDeliveryRequest, type GetApprovalContextRequest,
  type TenantRuntimeIpcHandler,
  type SubmitDeliveryResponse,
  type GetDeliveryResponse,
  type CancelDeliveryResponse,
  type GetApprovalContextResponse,
} from '../src/ipc.ts'
import { mintImSessionRequestId } from '../src/source.ts'

function parseWire(value: unknown): Record<string, unknown> {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : z.string().parse(value)
  return z.record(z.string(), z.unknown()).parse(JSON.parse(text.trim()))
}

describe.skipIf(process.platform === 'win32')('POSIX Unix Domain Socket IPC & Systemd Stream Session', () => {
  it('completes identity handshake and executes prompt delivery, status, and cancel operations', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-test-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async (req: SubmitDeliveryRequest) => {
        const res: SubmitDeliveryResponse = {
          id: req.id,
          type: 'submit_delivery_ack',
          deliveryKey: req.deliveryKey,
          sessionId: req.sessionId ?? 'session_auto_1',
          requestId: req.requestId,
          status: 'completed',
          resultText: `Execution finished for prompt: ${req.prompt}`,
          error: null,
        }
        return res
      }),
      handleGetDelivery: vi.fn().mockImplementation(async (req: GetDeliveryRequest) => {
        const res: GetDeliveryResponse = {
          id: req.id,
          type: 'get_delivery_ack',
          deliveryKey: req.deliveryKey,
          reconciliation: {
            state: 'completed',
            requestId: 'req_123',
            sessionId: 'session_auto_1',
            resultText: 'Cached result',
          },
        }
        return res
      }),
      handleCancelDelivery: vi.fn().mockImplementation(async (req: CancelDeliveryRequest) => {
        const res: CancelDeliveryResponse = {
          id: req.id,
          type: 'cancel_delivery_ack',
          deliveryKey: req.deliveryKey,
          status: 'cancelled',
        }
        return res
      }),
      handleGetApprovalContext: vi.fn().mockImplementation(async (req: GetApprovalContextRequest) => {
        const res: GetApprovalContextResponse = {
          id: req.id,
          type: 'get_approval_context_ack',
          sessionId: req.sessionId,
          context: null,
        }
        return res
      }),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'feishu_ingress_1', 'tenant_gamma')

    try {
      // 1. Handshake
      const initAck = await client.connect()
      expect(initAck.type).toBe('init_ack')
      expect(initAck.protocolVersion).toBe(IPC_PROTOCOL_VERSION)
      expect(initAck.tenantId).toBe('tenant_gamma')
      expect(initAck.status).toBe('ready')

      // 2. Ping / Pong
      const pong = await client.ping()
      expect(pong.type).toBe('pong')

      // 3. Submit Delivery
      const requestId = mintImSessionRequestId()
      const submitRes = await client.submitDelivery({
        deliveryKey: 'delivery_key_alpha',
        requestId,
        operatorId: 'operator_alice',
        prompt: 'Check deploy status',
        sessionId: null,
      })
      expect(submitRes.status).toBe('completed')
      expect(submitRes.deliveryKey).toBe('delivery_key_alpha')
      expect(submitRes.resultText).toContain('Check deploy status')

      // 4. Get Delivery
      const getRes = await client.getDelivery('delivery_key_alpha')
      expect(getRes.reconciliation.state).toBe('completed')

      // 5. Cancel Delivery
      const cancelRes = await client.cancelDelivery('delivery_key_alpha')
      expect(cancelRes.status).toBe('cancelled')

      // 6. Get Approval Context (Phase 2 returns null, never raw arguments)
      const approvalRes = await client.getApprovalContext('session_auto_1', 'call_test_1')
      expect(approvalRes.context).toBeNull()

      await client.close()
      await server.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('supports truthful unknown and cancelled outcomes in submit delivery response', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-truthful-'))
    const socketPath = join(tempDir, 'tenant.sock')

    let callCount = 0
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async (req: SubmitDeliveryRequest) => {
        callCount++
        if (callCount === 1) {
          return {
            id: req.id,
            type: 'submit_delivery_ack',
            deliveryKey: req.deliveryKey,
            sessionId: 'session_1',
            requestId: req.requestId,
            status: 'cancelled',
          }
        }
        return {
          id: req.id,
          type: 'submit_delivery_ack',
          deliveryKey: req.deliveryKey,
          sessionId: 'session_1',
          requestId: req.requestId,
          status: 'unknown',
          error: 'Session ended in uncertain state',
        }
      }),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'feishu_ingress_1', 'tenant_gamma')

    try {
      await client.connect()

      const res1 = await client.submitDelivery({
        deliveryKey: 'key_cancel',
        requestId: mintImSessionRequestId(),
        operatorId: 'op_1',
        prompt: 'test cancel',
        sessionId: null,
      })
      expect(res1.status).toBe('cancelled')

      const res2 = await client.submitDelivery({
        deliveryKey: 'key_unknown',
        requestId: mintImSessionRequestId(),
        operatorId: 'op_1',
        prompt: 'test unknown',
        sessionId: null,
      })
      expect(res2.status).toBe('unknown')
      expect(res2.error).toContain('uncertain state')

      await client.close()
      await server.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects handshake when protocol version mismatches', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-ver-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    try {
      await new Promise<void>((resolve, reject) => {
        const sock = createConnection(socketPath)
        sock.once('connect', () => {
          sock.write(
            JSON.stringify({
              id: 'req_bad_ver',
              type: 'init',
              protocolVersion: 999,
              ingressId: 'ingress_1',
              targetTenantId: 'tenant_gamma',
            }) + '\n',
          )
        })

        sock.on('data', (data) => {
          const resp = parseWire(data)
          expect(resp.type).toBe('error')
          expect(resp.code).toBe('ERR_PROTOCOL_MISMATCH')
          sock.destroy()
          resolve()
        })
        sock.once('error', reject)
      })

      await server.close()
    } finally {
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects handshake when target tenant ID mismatches', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-tenant-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'feishu_ingress_1', 'tenant_WRONG')

    try {
      await expect(client.connect()).rejects.toThrow(/ERR_TENANT_MISMATCH/)
      await server.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects handshake when workspace ID mismatches', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-ws-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(
      {
        socketPath,
        expectedTenantId: 'tenant_gamma',
        expectedWorkspaceId: 'ws_prod',
      },
      'tenant_gamma',
      mockHandler,
    )
    await server.listen()

    const client = new TenantIpcClient({
      socketPath,
      ingressId: 'feishu_ingress_1',
      targetTenantId: 'tenant_gamma',
      workspaceId: 'ws_dev', // Mismatched workspace
    })

    try {
      await expect(client.connect()).rejects.toThrow(/ERR_WORKSPACE_MISMATCH/)
      await server.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('second-writer refusal: rejects second concurrent connection and preserves active client', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-concur-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client1 = new TenantIpcClient(socketPath, 'feishu_ingress_1', 'tenant_gamma')
    const client2 = new TenantIpcClient(socketPath, 'feishu_ingress_2', 'tenant_gamma')

    try {
      await client1.connect()
      const pong1 = await client1.ping()
      expect(pong1.type).toBe('pong')

      // Client 2 connects concurrently to same tenant socket -> rejected with ERR_SECOND_WRITER_REFUSED
      await expect(client2.connect()).rejects.toThrow(/ERR_SECOND_WRITER_REFUSED/)

      // Client 1 remains connected and healthy
      const pong2 = await client1.ping()
      expect(pong2.type).toBe('pong')

      await client1.close()
      await client2.close()
      await server.close()
    } finally {
      await client1.close()
      await client2.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('second-writer refusal during drain: retains writer ownership until drainage completes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-drain-race-'))
    const socketPath = join(tempDir, 'tenant.sock')

    let releaseDrain: () => void = () => {}
    const drainBlockedPromise = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
      handleClientDisconnected: vi.fn().mockImplementation(async () => {
        await drainBlockedPromise
      }),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client1 = new TenantIpcClient(socketPath, 'ingress_1', 'tenant_gamma')
    const client2 = new TenantIpcClient(socketPath, 'ingress_2', 'tenant_gamma')

    try {
      await client1.connect()
      // Disconnect client 1 to trigger drain
      const closeClient1 = client1.close()

      // Allow event loop to process client 1 disconnect and enter drain hook
      await new Promise(resolve => setTimeout(resolve, 50))

      // Attempt to connect client 2 while client 1 is draining -> must be refused!
      await expect(client2.connect()).rejects.toThrow(/ERR_SECOND_WRITER_REFUSED/)

      // Release drain
      releaseDrain()
      await closeClient1

      // After drainage settles, client 2 can now connect!
      await new Promise(resolve => setTimeout(resolve, 50))
      const ack2 = await client2.connect()
      expect(ack2.status).toBe('ready')

      await client2.close()
      await server.close()
    } finally {
      releaseDrain()
      await client1.close()
      await client2.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses another writer after failed drainage and reports the failure on close', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-drain-err-'))
    const socketPath = join(tempDir, 'tenant.sock')

    let disconnectedCalled = false
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
      handleClientDisconnected: vi.fn().mockImplementation(async () => {
        disconnectedCalled = true
        throw new Error('Explosive drain hook error should be contained')
      }),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'feishu_ingress_1', 'tenant_gamma')
    await client.connect()

    await client.close()

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(disconnectedCalled).toBe(true)

    const replacement = new TenantIpcClient(socketPath, 'replacement', 'tenant_gamma')
    await expect(replacement.connect()).rejects.toThrow(/already connected or draining/)
    await replacement.close()
    await expect(server.close()).rejects.toThrow('Explosive drain hook error')
    await rm(tempDir, { recursive: true, force: true })
  })

  it('framing: counts raw UTF-8 bytes before trim and rejects whitespace-padded oversized frame', () => {
    const decoder = new NdjsonLineBuffer(MAX_FRAME_BYTES)
    const padded = Buffer.from(' '.repeat(MAX_FRAME_BYTES) + '{}\n')
    expect(() => decoder.push(padded)).toThrow(/exceeded maximum limit/)
  })

  it('framing: rejects oversized CJK multibyte payload', () => {
    const decoder = new NdjsonLineBuffer(MAX_FRAME_BYTES)
    const oversized = JSON.stringify({ text: '汉'.repeat(Math.floor(MAX_FRAME_BYTES / 2)) }) + '\n'
    expect(() => decoder.push(oversized)).toThrow(/exceeded maximum limit/)
  })

  it('framing: rejects residual buffer overflow after valid frame prefix', () => {
    const decoder = new NdjsonLineBuffer(MAX_FRAME_BYTES)
    const validAndResidual = '{}\n' + 'x'.repeat(MAX_FRAME_BYTES + 1)
    expect(() => decoder.push(validAndResidual)).toThrow(/Residual buffer size exceeded maximum limit/)
  })

  it('framing: preserves split UTF-8 multibyte characters across chunk boundaries', () => {
    const packet = Buffer.from('{"text":"汉"}\n')
    const mid = packet.indexOf(Buffer.from('汉')) + 1
    const decoder = new NdjsonLineBuffer(MAX_FRAME_BYTES)

    const chunk1 = packet.subarray(0, mid)
    const chunk2 = packet.subarray(mid)

    const res1 = decoder.push(chunk1)
    expect(res1).toHaveLength(0)

    const res2 = decoder.push(chunk2) as Array<{ text: string }>
    expect(res2).toHaveLength(1)
    expect(res2[0]?.text).toBe('汉')
  })

  it('readable stream EOF closes session even when autoDestroy is false', async () => {
    const input = new PassThrough({ autoDestroy: false })
    const output = new PassThrough()
    output.resume()

    let closedCount = 0
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const session = new TenantIpcSession(
      input,
      output,
      'tenant_stream',
      mockHandler,
      () => {
        closedCount++
      },
    )

    // Handshake
    input.write(
      JSON.stringify({
        id: 'init_1',
        type: 'init',
        protocolVersion: 1,
        ingressId: 'ingress_stream',
        targetTenantId: 'tenant_stream',
      }) + '\n',
    )

    // Send EOF
    input.end()
    await setImmediate()

    expect(closedCount).toBe(1)
    await session.close()
    input.destroy()
    output.destroy()
  })

  it('wire boundary: rejects malformed payload and unknown fields with strict Zod schema', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-wire-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const handlerCalls: unknown[] = []
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async (r: SubmitDeliveryRequest) => {
        handlerCalls.push(r)
        return {
          id: r.id,
          type: 'submit_delivery_ack',
          deliveryKey: r.deliveryKey,
          sessionId: 's1',
          requestId: r.requestId,
          status: 'admitted',
        }
      }),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    try {
      const socket = createConnection(socketPath)
      await once(socket, 'connect')

      // Handshake
      socket.write(
        JSON.stringify({
          id: 'init_req',
          type: 'init',
          protocolVersion: 1,
          ingressId: 'ingress_1',
          targetTenantId: 'tenant_gamma',
        }) + '\n',
      )
      const initData: unknown = (await once(socket, 'data'))[0]
      const initAck = parseWire(initData)
      expect(initAck.type).toBe('init_ack')

      // 1. Send malformed prompt (number instead of string)
      socket.write(
        JSON.stringify({
          id: 'malformed_1',
          type: 'submit_delivery',
          prompt: 12345,
        }) + '\n',
      )
      const errData1: unknown = (await once(socket, 'data'))[0]
      const errResp1 = parseWire(errData1)
      expect(errResp1.type).toBe('error')
      expect(errResp1.code).toBe('ERR_MALFORMED_FRAME')

      // 2. Send unknown fields (.strict() rejection)
      socket.write(
        JSON.stringify({
          id: 'malformed_2',
          type: 'submit_delivery',
          deliveryKey: 'k1',
          requestId: 'r1',
          operatorId: 'op1',
          prompt: 'hello',
          sessionId: null,
          unauthorizedExtraField: 'attack_payload',
        }) + '\n',
      )
      const errData2: unknown = (await once(socket, 'data'))[0]
      const errResp2 = parseWire(errData2)
      expect(errResp2.type).toBe('error')
      expect(errResp2.code).toBe('ERR_MALFORMED_FRAME')

      // Handler must never have been called with malformed payloads
      expect(handlerCalls).toHaveLength(0)

      socket.destroy()
      await server.close()
    } finally {
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it.each([
    { label: 'protocol', ack: { protocolVersion: 99, tenantId: 'tenant_gamma', workspaceId: 'workspace-a' } },
    { label: 'tenant', ack: { protocolVersion: 1, tenantId: 'foreign-tenant', workspaceId: 'workspace-a' } },
    { label: 'workspace', ack: { protocolVersion: 1, tenantId: 'tenant_gamma', workspaceId: 'foreign-workspace' } },
    { label: 'missing workspace', ack: { protocolVersion: 1, tenantId: 'tenant_gamma' } },
  ])('rejects an untrusted $label handshake acknowledgement', async ({ ack }) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-ipc-identity-'))
    const socketPath = join(directory, 'tenant.sock')
    const server = createServer((socket) => {
      const frames = new NdjsonLineBuffer(MAX_FRAME_BYTES)
      socket.on('data', (chunk: Buffer) => {
        for (const raw of frames.push(chunk)) {
          const message = ipcClientMessageSchema.parse(raw)
          if (message.type === 'init') socket.write(JSON.stringify({ id: message.id, type: 'init_ack', status: 'ready', ...ack }) + '\n')
        }
      })
    })
    await new Promise<void>((resolve) => { server.listen(socketPath, resolve) })
    const client = new TenantIpcClient({ socketPath, ingressId: 'ingress', targetTenantId: 'tenant_gamma', workspaceId: 'workspace-a' })
    try {
      await expect(client.connect()).rejects.toThrow(/identity|protocol|tenant|workspace/i)
    } finally {
      await client.close()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('correlation: client rejects when server returns unexpected response type', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-correl-'))
    const socketPath = join(tempDir, 'tenant.sock')
    const server = createServer((socket) => {
      const frames = new NdjsonLineBuffer(MAX_FRAME_BYTES)
      socket.on('data', (chunk: Buffer) => {
        for (const raw of frames.push(chunk)) {
          const message = ipcClientMessageSchema.parse(raw)
          if (message.type === 'init') {
            socket.write(JSON.stringify({ id: message.id, type: 'init_ack', protocolVersion: 1,
              tenantId: 'tenant_gamma', status: 'ready' }) + '\n')
          } else if (message.type === 'submit_delivery') {
            socket.write(JSON.stringify({ id: message.id, type: 'cancel_delivery_ack',
              deliveryKey: message.deliveryKey, status: 'cancelled' }) + '\n')
          }
        }
      })
    })
    await new Promise<void>((resolve) => { server.listen(socketPath, resolve) })
    const client = new TenantIpcClient(socketPath, 'ingress', 'tenant_gamma')
    try {
      await client.connect()
      await expect(client.submitDelivery({ deliveryKey: 'key', requestId: mintImSessionRequestId(), operatorId: 'operator',
        prompt: 'correlation', sessionId: null })).rejects.toThrow(/Correlation mismatch/)
    } finally {
      await client.close()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('client enforces max pending requests limit', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-pending-'))
    const socketPath = join(tempDir, 'tenant.sock')

    // Handler that hangs to simulate backlog
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(() => new Promise(() => {})),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(
      {
        socketPath,
        expectedTenantId: 'tenant_gamma',
        shutdownTimeoutMs: 50,
      },
      'tenant_gamma',
      mockHandler,
    )
    await server.listen()

    const client = new TenantIpcClient({
      socketPath,
      ingressId: 'ingress_1',
      targetTenantId: 'tenant_gamma',
      maxPendingRequests: 2, // Low cap
      requestTimeoutMs: 5000,
    })

    try {
      await client.connect()

      // Submit 2 in-flight requests (fills limit)
      const p1 = client.submitDelivery({
        deliveryKey: 'k1',
        requestId: mintImSessionRequestId(),
        operatorId: 'op1',
        prompt: '1',
        sessionId: null,
      }).catch(() => {})
      const p2 = client.submitDelivery({
        deliveryKey: 'k2',
        requestId: mintImSessionRequestId(),
        operatorId: 'op1',
        prompt: '2',
        sessionId: null,
      }).catch(() => {})

      // 3rd request exceeds limit -> rejected immediately
      await expect(
        client.submitDelivery({
          deliveryKey: 'k3',
          requestId: mintImSessionRequestId(),
          operatorId: 'op1',
          prompt: '3',
          sessionId: null,
        }),
      ).rejects.toThrow(/maximum pending requests limit \(2\) reached/)

      await client.close()
      await p1
      await p2
      await server.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('server enforces max active operations limit', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-active-ops-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async (r: SubmitDeliveryRequest) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return {
          id: r.id,
          type: 'submit_delivery_ack',
          deliveryKey: r.deliveryKey,
          sessionId: 's1',
          requestId: r.requestId,
          status: 'completed',
        }
      }),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(
      {
        socketPath,
        expectedTenantId: 'tenant_gamma',
        maxActiveOperations: 1, // Only 1 concurrent operation allowed
      },
      'tenant_gamma',
      mockHandler,
    )
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'ingress_1', 'tenant_gamma')
    try {
      await client.connect()

      const p1 = client.submitDelivery({
        deliveryKey: 'k1',
        requestId: mintImSessionRequestId(),
        operatorId: 'op1',
        prompt: '1',
        sessionId: null,
      })

      // Concurrent operation should be rejected with ERR_CONCURRENCY_LIMIT
      const p2 = client.submitDelivery({
        deliveryKey: 'k2',
        requestId: mintImSessionRequestId(),
        operatorId: 'op1',
        prompt: '2',
        sessionId: null,
      })

      const [res1, res2] = await Promise.allSettled([p1, p2])
      expect(res1.status).toBe('fulfilled')
      expect(res2.status).toBe('rejected')
      if (res2.status === 'rejected') {
        expect(z.instanceof(Error).parse(res2.reason).message).toContain('ERR_CONCURRENCY_LIMIT')
      }

      await client.close()
      await server.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('client request timeout rejects when server does not respond within deadline', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-timeout-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const release = Promise.withResolvers<undefined>()
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async () => {
        await release.promise
        throw new Error('Request cancelled during cleanup')
      }),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(
      {
        socketPath,
        expectedTenantId: 'tenant_gamma',
        shutdownTimeoutMs: 50,
      },
      'tenant_gamma',
      mockHandler,
    )
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'ingress_1', 'tenant_gamma')
    try {
      await client.connect()

      await expect(
        client.submitDelivery(
          {
            deliveryKey: 'k_timeout',
            requestId: mintImSessionRequestId(),
            operatorId: 'op1',
            prompt: 'time out please',
            sessionId: null,
          },
          100, // 100ms timeout
        ),
      ).rejects.toThrow(/timed out after 100ms/)

      release.resolve(undefined)
      await client.close()
      await server.close()
    } finally {
      release.resolve(undefined)
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('security: client rejects connection if socket path is a symbolic link', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-symlink-'))
    const realSocketPath = join(tempDir, 'real.sock')
    const symlinkPath = join(tempDir, 'symlink.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(realSocketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    await symlink(realSocketPath, symlinkPath)

    const client = new TenantIpcClient(symlinkPath, 'ingress_1', 'tenant_gamma')
    try {
      await expect(client.connect()).rejects.toThrow(/is a symbolic link; symlinks are rejected for security/)
    } finally {
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('security: client rejects connection if path is not a socket', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-regular-'))
    const regularFilePath = join(tempDir, 'regular.txt')
    await writeFile(regularFilePath, 'not a socket')

    const client = new TenantIpcClient(regularFilePath, 'ingress_1', 'tenant_gamma')
    try {
      await expect(client.connect()).rejects.toThrow(/is not a Unix domain socket/)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('security: client rejects connection if socket UID does not match trusted UID', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-uid-'))
    const socketPath = join(tempDir, 'tenant.sock')

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client = new TenantIpcClient({
      socketPath,
      ingressId: 'ingress_1',
      targetTenantId: 'tenant_gamma',
      trustedUid: 999999, // Untrusted UID
    })

    try {
      await expect(client.connect()).rejects.toThrow(/does not match expected trusted UID 999999/)
    } finally {
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('systemd Accept=yes pattern: TenantIpcSession operates over connected stream pairs', async () => {
    // Emulates systemd socket activation passing stdin/stdout streams
    const clientToSession = new PassThrough()
    const sessionToClient = new PassThrough()

    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async (r: SubmitDeliveryRequest) => ({
        id: r.id,
        type: 'submit_delivery_ack',
        deliveryKey: r.deliveryKey,
        sessionId: 's_systemd',
        requestId: r.requestId,
        status: 'completed',
        resultText: 'Handled via inherited systemd stream',
      })),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    let sessionClosed = false
    const session = new TenantIpcSession(
      clientToSession,
      sessionToClient,
      'tenant_systemd',
      mockHandler,
      () => {
        sessionClosed = true
      },
    )

    // Send init handshake
    clientToSession.write(
      JSON.stringify({
        id: 'init_s',
        type: 'init',
        protocolVersion: 1,
        ingressId: 'ingress_systemd',
        targetTenantId: 'tenant_systemd',
      }) + '\n',
    )

    const initAckBuf: unknown = (await once(sessionToClient, 'data'))[0]
    const initAck = parseWire(initAckBuf)
    expect(initAck.type).toBe('init_ack')
    expect(initAck.tenantId).toBe('tenant_systemd')

    // Submit delivery over stream
    clientToSession.write(
      JSON.stringify({
        id: 'sub_s',
        type: 'submit_delivery',
        deliveryKey: 'dk_stream',
        requestId: 'req_stream',
        operatorId: 'op_stream',
        prompt: 'Systemd prompt',
        sessionId: null,
      }) + '\n',
    )

    const replyBuf: unknown = (await once(sessionToClient, 'data'))[0]
    const reply = parseWire(replyBuf)
    expect(reply.type).toBe('submit_delivery_ack')
    expect(reply.resultText).toContain('Handled via inherited systemd stream')

    await session.close()
    expect(sessionClosed).toBe(true)
    clientToSession.destroy()
    sessionToClient.destroy()
  })

  it('async teardown: awaits in-flight handler quiescence during shutdown before release', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-ipc-quiesce-'))
    const socketPath = join(tempDir, 'tenant.sock')

    let handlerFinished = false
    const mockHandler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn().mockImplementation(async (r: SubmitDeliveryRequest) => {
        await new Promise(resolve => setTimeout(resolve, 80))
        handlerFinished = true
        return {
          id: r.id,
          type: 'submit_delivery_ack',
          deliveryKey: r.deliveryKey,
          sessionId: 's1',
          requestId: r.requestId,
          status: 'completed',
        }
      }),
      handleGetDelivery: vi.fn(),
      handleCancelDelivery: vi.fn(),
      handleGetApprovalContext: vi.fn(),
    }

    const server = new TenantIpcServer(socketPath, 'tenant_gamma', mockHandler)
    await server.listen()

    const client = new TenantIpcClient(socketPath, 'ingress_1', 'tenant_gamma')
    try {
      await client.connect()

      // Start async handler
      const submitPromise = client.submitDelivery({
        deliveryKey: 'k_quiesce',
        requestId: mintImSessionRequestId(),
        operatorId: 'op1',
        prompt: 'long task',
        sessionId: null,
      })

      // Immediately close server while handler is running
      await new Promise(resolve => setTimeout(resolve, 20))
      await server.close()

      // Handler must have finished during server quiescence shutdown
      expect(handlerFinished).toBe(true)

      await submitPromise.catch(() => {})
      await client.close()
    } finally {
      await client.close()
      await server.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})


describe('Tenant IPC shutdown failures', () => {
  it('observes an immediate cancellation failure while a request is still running', async () => {
    const input = new PassThrough({ autoDestroy: false })
    const output = new PassThrough()
    output.resume()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const handler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(), handleCancelDelivery: vi.fn(), handleGetApprovalContext: vi.fn(),
      handleGetDelivery: async (request) => {
        started.resolve(undefined)
        await release.promise
        return { id: request.id, type: 'get_delivery_ack', deliveryKey: request.deliveryKey, reconciliation: { state: 'not_found' } }
      },
    }
    const session = new TenantIpcSession(input, output, { expectedTenantId: 'tenant', shutdownTimeoutMs: 100 }, handler,
      async () => { throw new Error('Cancellation failed') })
    input.write(JSON.stringify({ id: 'init', type: 'init', protocolVersion: 1, ingressId: 'ingress', targetTenantId: 'tenant' }) + '\n')
    input.write(JSON.stringify({ id: 'get', type: 'get_delivery', deliveryKey: 'key' }) + '\n')
    await started.promise
    try {
      await expect(session.close()).rejects.toThrow('Cancellation failed')
      await expect(session.done).rejects.toThrow('Cancellation failed')
      input.emit('error', new Error('Late transport error'))
    } finally {
      release.resolve(undefined)
      input.destroy()
      output.destroy()
    }
  })

  it('rejects shutdown when cancellation never settles', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const release = Promise.withResolvers<undefined>()
    const handler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(), handleGetDelivery: vi.fn(), handleCancelDelivery: vi.fn(), handleGetApprovalContext: vi.fn(),
    }
    const session = new TenantIpcSession(input, output, { expectedTenantId: 'tenant', shutdownTimeoutMs: 20 }, handler,
      async () => { await release.promise })
    try {
      await expect(session.close()).rejects.toThrow('did not reach quiescence')
    } finally {
      release.resolve(undefined)
      input.destroy()
      output.destroy()
    }
  })
})


describe('Tenant IPC output pressure', () => {
  it('settles failed output drainage and bounds queued bytes before closing', async () => {
    const input = new PassThrough()
    const output = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) { /* Deliberately blocked peer. */ } })
    const handler: TenantRuntimeIpcHandler = {
      handleSubmitDelivery: vi.fn(), handleGetDelivery: vi.fn(), handleCancelDelivery: vi.fn(), handleGetApprovalContext: vi.fn(),
    }
    const session = new TenantIpcSession(input, output, { expectedTenantId: 'tenant',
      operationTimeoutMs: 20, shutdownTimeoutMs: 100, maxBufferedBytes: 512 }, handler)
    try {
      input.write(JSON.stringify({ id: 'init', type: 'init', protocolVersion: 1, ingressId: 'ingress', targetTenantId: 'tenant' }) + '\n')
      await session.done
      expect(output.writableLength).toBeLessThanOrEqual(512)
      expect(output.listenerCount('drain')).toBe(0)
      await session.close()
    } finally { input.destroy(); output.destroy() }
  })
})

it('drains an IPC input that ended before the runtime finished mounting', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  const ended = once(input, 'end')
  input.resume()
  input.end()
  await ended
  const disconnected = vi.fn(() => Promise.resolve())
  const unused = (): Promise<never> => Promise.reject(new Error('Unused operation'))
  const session = new TenantIpcSession(input, output, { expectedTenantId: 'tenant', shutdownTimeoutMs: 100 }, {
    handleSubmitDelivery: unused, handleGetDelivery: unused,
    handleCancelDelivery: unused, handleGetApprovalContext: unused,
  }, disconnected)
  try {
    await vi.waitFor(() => { expect(disconnected).toHaveBeenCalledOnce() }, { timeout: 200 })
    await session.done
  } finally { await session.close() }
})
