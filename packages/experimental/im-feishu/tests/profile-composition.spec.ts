import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply as runtimePlugin } from '../src/runtime-plugin.ts'
import { apply as ingressPlugin } from '../src/ingress-plugin.ts'
import { ImWriterLease } from '../src/writer-lease.ts'
import type { IncomingImMessage } from '../src/types.ts'
import type { IngressService, ImReplySender } from '../src/ingress.ts'
import type { TenantRuntimeService } from '../src/runtime-service.ts'
import { TenantIpcClient } from '../src/ipc.ts'
import { encodeOperatorBindingKey, type IngressDeliveryRecord } from '../src/storage.ts'

/** Mock LLM adapter supporting controllable blocking for cancellation tests. */
class ControlledLlmAdapter extends LlmAdapter {
  calls = 0
  block = false

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    if (this.block && !options.signal?.aborted) {
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => {
          resolve()
        }, { once: true })
      })
      options.signal?.throwIfAborted()
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'public final reply' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'public final reply' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Tracking reply sender that records outbox messages delivered to the external channel. */
class CapturingReplySender implements ImReplySender {
  replies: Array<{ deliveryKey: string; outboxReplyText: string | null }> = []

  async sendReply(record: IngressDeliveryRecord): Promise<{ readonly messageId: string }> {
    this.replies.push({ deliveryKey: record.deliveryKey, outboxReplyText: record.outboxReplyText })
    return { messageId: `ext_msg_${randomUUID()}` }
  }
}

/** Test environment composing real runtime and ingress plugins over Unix domain socket. */
interface CompositionHarness {
  baseDir: string
  runtimeDir: string
  ingressDir: string
  socketPath: string
  runtimeCtx: Context
  ingressCtx: Context
  adapter: ControlledLlmAdapter
  sender: CapturingReplySender
  runtimeService: TenantRuntimeService
  ingressService: IngressService
  teardown: () => Promise<void>
}

async function createCompositionHarness(options: { block?: boolean } = {}): Promise<CompositionHarness> {
  const rawBase = await mkdtemp(join(tmpdir(), 'dsh-profile-comp-'))
  const baseDir = await realpath(rawBase)
  await chmod(baseDir, 0o700)

  const runtimeDir = join(baseDir, 'runtime')
  const ingressDir = join(baseDir, 'ingress')
  const workspaceDir = join(baseDir, 'workspace')
  const socketPath = join(baseDir, 'tenant.sock')

  await mkdir(runtimeDir, { recursive: true })
  await chmod(runtimeDir, 0o700)
  await mkdir(ingressDir, { recursive: true })
  await chmod(ingressDir, 0o700)
  await mkdir(workspaceDir, { recursive: true })
  await chmod(workspaceDir, 0o700)

  const runtimeCtx = new Context()
  const ingressCtx = new Context()
  const adapter = new ControlledLlmAdapter()
  adapter.block = options.block ?? false
  const sender = new CapturingReplySender()

  let isTornDown = false
  const teardown = async () => {
    if (isTornDown) return
    isTornDown = true
    await ingressCtx.fiber.dispose().catch(() => {})
    await runtimeCtx.fiber.dispose().catch(() => {})
    await rm(baseDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    // 1. Setup Runtime Context
    await mountAgentLoopTestDependencies(runtimeCtx, { tools: { mode: 'native' } })
    await runtimeCtx.plugin(JsonlSessionPersistence, {
      root: join(runtimeDir, 'sessions'),
      compression: 'none',
    })
    await runtimeCtx.plugin(AgentLoop, { agents: [] })
    await runtimeCtx.plugin(Storage)
    runtimeCtx.llm.registerAdapter(['fixture'], adapter)

    await runtimePlugin(runtimeCtx, {
      tenantId: 'tenant-primary',
      operatorIds: ['operator-primary'],
      stateDirectory: runtimeDir,
      cwd: workspaceDir,
      socketPath,
      shutdownTimeoutMs: 5000,
      maxActiveDeliveries: 1,
      useSystemdStdio: false,
      modelSelection: {
        provider: 'fixture',
        model: 'fixture',
      },
    })

    // 2. Setup Ingress Context
    ingressCtx.provide('appExit', () => {})
    ingressCtx.provide('appReady', { onReady: (cb) => { cb(); return () => {} } })
    await ingressCtx.plugin(Storage)
    await ingressPlugin(
      ingressCtx,
      {
        stateDirectory: ingressDir,
        tenants: {
          'tenant-primary': {
            socketPath,
          },
        },
        operatorBindings: [
          {
            bindingKey: encodeOperatorBindingKey('feishu', 'feishu-app', 'feishu-org', 'feishu-chat', 'feishu-user'),
            provider: 'feishu',
            appId: 'feishu-app',
            tenantId: 'feishu-org',
            chatId: 'feishu-chat',
            senderId: 'feishu-user',
            operatorId: 'operator-primary',
            targetTenantId: 'tenant-primary',
            authorizedAt: new Date().toISOString(),
            revokedAt: null,
          },
        ],
        dispatchIntervalMs: 50,
        maxPendingAdmissions: 32,
      },
      {
        replySender: sender,
        clientFactory: (targetTenantId, endpoint) =>
          new TenantIpcClient({
            socketPath: endpoint.socketPath,
            ingressId: 'ingress-main',
            targetTenantId,
          }),
      },
    )

    const runtimeService = runtimeCtx.imRuntime
    const ingressService = ingressCtx.imIngress

    return {
      baseDir,
      runtimeDir,
      ingressDir,
      socketPath,
      runtimeCtx,
      ingressCtx,
      adapter,
      sender,
      runtimeService,
      ingressService,
      teardown,
    }
  } catch (error) {
    await teardown()
    throw error
  }
}

function makeIncomingMessage(overrides: Partial<IncomingImMessage> = {}): IncomingImMessage {
  return {
    provider: 'feishu',
    appId: 'feishu-app',
    tenantId: 'feishu-org',
    chatId: 'feishu-chat',
    senderId: 'feishu-user',
    eventId: `ev_${randomUUID()}`,
    messageId: `msg_${randomUUID()}`,
    createTime: Date.now(),
    chatType: 'p2p',
    text: 'Hello assistant',
    ...overrides,
  }
}

describe('Profile composition end-to-end integration', () => {
  it('executes keyless prompt to completion and writes outbox reply', async () => {
    const harness = await createCompositionHarness()
    try {
      const msg = makeIncomingMessage()
      const admission = await harness.ingressService.handleIncomingMessage(msg)
      expect(admission.duplicate).toBe(false)
      expect(admission.deliveryKey).toBeDefined()

      await vi.waitFor(
        () => {
          expect(harness.sender.replies.length).toBe(1)
        },
        { timeout: 5000, interval: 50 },
      )

      expect(harness.sender.replies[0]?.deliveryKey).toBe(admission.deliveryKey)
      expect(harness.sender.replies[0]?.outboxReplyText).toBe('public final reply')
      expect(harness.adapter.calls).toBe(1)
    } finally {
      await harness.teardown()
    }
  })

  it('admits duplicate retries idempotently without duplicate model calls', async () => {
    const harness = await createCompositionHarness()
    try {
      const msg = makeIncomingMessage()
      const first = await harness.ingressService.handleIncomingMessage(msg)
      const retry = await harness.ingressService.handleIncomingMessage(msg)

      expect(first.requestId).toBe(retry.requestId)
      expect(retry.duplicate).toBe(true)

      await vi.waitFor(
        () => {
          expect(harness.sender.replies.length).toBe(1)
        },
        { timeout: 5000, interval: 50 },
      )

      expect(harness.adapter.calls).toBe(1)
    } finally {
      await harness.teardown()
    }
  })

  it('persists and resumes existing conversation across consecutive turns', async () => {
    const harness = await createCompositionHarness()
    try {
      // First turn
      const msg1 = makeIncomingMessage({ text: 'Turn 1 prompt' })
      const adm1 = await harness.ingressService.handleIncomingMessage(msg1)
      await vi.waitFor(
        () => {
          expect(harness.sender.replies.length).toBe(1)
        },
        { timeout: 5000, interval: 50 },
      )
      expect(harness.adapter.calls).toBe(1)

      // Second turn in same conversation
      const msg2 = makeIncomingMessage({ text: 'Turn 2 follow-up' })
      const adm2 = await harness.ingressService.handleIncomingMessage(msg2)
      expect(adm2.deliveryKey).not.toBe(adm1.deliveryKey)

      await vi.waitFor(
        () => {
          expect(harness.sender.replies.length).toBe(2)
        },
        { timeout: 5000, interval: 50 },
      )
      expect(harness.adapter.calls).toBe(2)
    } finally {
      await harness.teardown()
    }
  })

  it('cancels a running model turn and records cancellation status', async () => {
    const harness = await createCompositionHarness({ block: true })
    try {
      const msg = makeIncomingMessage({ text: 'Slow turn to cancel' })
      const adm = await harness.ingressService.handleIncomingMessage(msg)

      // Wait until model starts running
      await vi.waitFor(
        () => {
          expect(harness.adapter.calls).toBe(1)
        },
        { timeout: 5000, interval: 50 },
      )

      // Cancel the delivery
      const cancelResult = await harness.runtimeService.handleCancelDelivery({
        id: randomUUID(),
        type: 'cancel_delivery',
        deliveryKey: adm.deliveryKey,
      })

      expect(cancelResult.status).toBe('cancelled')
    } finally {
      await harness.teardown()
    }
  })

  it('refuses a second writer on the active tenant runtime state directory', async () => {
    const harness = await createCompositionHarness()
    try {
      // Attempting to acquire lease on the already-locked runtime directory must fail
      await expect(ImWriterLease.acquire(harness.runtimeDir)).rejects.toThrow(/(Exclusive lease|flock failed)/)
    } finally {
      await harness.teardown()
    }
  })

  it('releases writer lease upon clean context disposal', async () => {
    const harness = await createCompositionHarness()
    const targetDir = harness.runtimeDir
    try {
      // Clean context disposal without deleting base directory yet
      await harness.ingressCtx.fiber.dispose()
      await harness.runtimeCtx.fiber.dispose()

      // Once disposed, acquiring lease on targetDir must succeed
      const lease = await ImWriterLease.acquire(targetDir)
      expect(lease).toBeInstanceOf(ImWriterLease)
      await lease.release()
    } finally {
      await harness.teardown()
    }
  })
})
