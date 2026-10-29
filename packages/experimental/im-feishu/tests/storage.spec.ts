import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import {
  INGRESS_DOMAIN_NAME,
  operatorBindingSchema,
  ingressDeliverySchema,
  ingressDomainSpec,
  tenantReceiptDomainSpec,
  encodeOperatorBindingKey,
  IngressStorage,
  TenantReceiptStorage,
  reconcileDelivery,
  type OperatorBindingRecord,
} from '../src/storage.ts'
import {
  encodeDeliveryKey,
  mintImSessionRequestId,
  createImPromptSource,
} from '../src/source.ts'
import {
  parseFeishuAppId,
  parseFeishuChatId,
  parseFeishuEventId,
  parseFeishuSenderId,
  parseFeishuTenantId,
} from '../src/types.ts'

/**
 * Boot a Cordis test harness with SQLite backend and domain facility pointing to a file path.
 */
async function createStorageHarness(dbPath: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const sqlite = new SqliteStorageBackend({ path: dbPath, journalMode: 'wal' })
  ctx.storage.backend.register('sqlite', sqlite)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  ctx.storage.mount('domain', facility)
  return { ctx, facility, sqlite }
}

describe('Feishu IM Storage & Crash Reconciliation', () => {
  it('persists and reopens ingress and tenant receipt domains across clean process restarts', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    const dbPath = join(tempDir, 'dsh-test.db')

    const deliveryKey = encodeDeliveryKey({
      provider: 'feishu',
      appId: parseFeishuAppId('cli_app_1'),
      tenantId: parseFeishuTenantId('tenant_org_1'),
      chatId: parseFeishuChatId('oc_chat_1'),
      senderId: parseFeishuSenderId('ou_sender_1'),
      eventId: parseFeishuEventId('evt_msg_1001'),
    })

    const bindingKey = encodeOperatorBindingKey('feishu', 'cli_app_1', 'tenant_org_1', 'oc_chat_1', 'ou_sender_1')
    const operatorBinding: OperatorBindingRecord = {
      bindingKey,
      operatorId: 'op_user_alice',
      targetTenantId: 'tenant_worker_1',
      provider: 'feishu',
      appId: 'cli_app_1',
      tenantId: 'tenant_org_1',
      chatId: 'oc_chat_1',
      senderId: 'ou_sender_1',
      authorizedAt: new Date().toISOString(),
      revokedAt: null,
    }

    let recordedRequestId: string

    // 1. Initial write in Context A
    {
      const { ctx, facility, sqlite } = await createStorageHarness(dbPath)
      try {
        const ingressDomain = await facility.open(ingressDomainSpec)
        const receiptDomain = await facility.open(tenantReceiptDomainSpec)

        const ingressStorage = new IngressStorage(ingressDomain)
        const receiptStorage = new TenantReceiptStorage(receiptDomain)

        await ingressStorage.putBinding(operatorBinding)

        const delivery = await ingressStorage.recordDeliveryReceived({
          deliveryKey,
          operatorId: 'op_user_alice',
          targetTenantId: 'tenant_worker_1',
          prompt: 'Please check production alerts',
        })
        recordedRequestId = delivery.requestId

        await receiptStorage.recordAdmitting({
          deliveryKey,
          sessionId: 'session_prod_alpha',
          requestId: delivery.requestId,
          operatorId: 'op_user_alice',
        })

        // Prepare durable outbox reply and simulate an in-flight send attempt that lost confirmation
        const prep = await ingressStorage.prepareOutboxReply(deliveryKey, 'All services operational.', '2026-10-24T18:00:00Z')
        const att = await ingressStorage.recordOutboxAttempt(deliveryKey, prep.outboxVersion)
        await ingressStorage.recordOutboxFailure(deliveryKey, prep.outboxVersion, att.outboxAttempts, 'Gateway timeout waiting for ACK', true)

        await ingressStorage.close()
        await receiptStorage.close()
      } finally {
        await ctx.fiber.dispose()
        await sqlite.close()
      }
    }

    // 2. Reopen fresh Context B with the same SQLite file
    {
      const { ctx, facility, sqlite } = await createStorageHarness(dbPath)
      try {
        const ingressDomain = await facility.open(ingressDomainSpec)
        const receiptDomain = await facility.open(tenantReceiptDomainSpec)

        const ingressStorage = new IngressStorage(ingressDomain)
        const receiptStorage = new TenantReceiptStorage(receiptDomain)

        // Verify operator binding persisted
        const restoredBinding = ingressStorage.getBinding(bindingKey)
        expect(restoredBinding).toBeDefined()
        expect(restoredBinding?.operatorId).toBe('op_user_alice')
        expect(restoredBinding?.revokedAt).toBeNull()

        // Verify active binding lookup
        const active = ingressStorage.findActiveBinding('feishu', 'cli_app_1', 'tenant_org_1', 'oc_chat_1', 'ou_sender_1')
        expect(active).toBeDefined()
        expect(active?.operatorId).toBe('op_user_alice')

        // Verify delivery persisted with exact requestId
        const restoredDelivery = ingressStorage.getDelivery(deliveryKey)
        expect(restoredDelivery).toBeDefined()
        expect(restoredDelivery?.requestId).toBe(recordedRequestId)
        expect(restoredDelivery?.prompt).toBe('Please check production alerts')
        expect(restoredDelivery?.status).toBe('received')

        // Verify durable outbox tracking fields persisted (R3)
        expect(restoredDelivery?.outboxStatus).toBe('unknown')
        expect(restoredDelivery?.outboxReplyText).toBe('All services operational.')
        expect(restoredDelivery?.outboxVersion).toBe(2)
        expect(restoredDelivery?.outboxAttempts).toBe(1)
        expect(restoredDelivery?.outboxDeadline).toBe('2026-10-24T18:00:00Z')
        expect(restoredDelivery?.outboxError).toContain('Gateway timeout')

        // Verify receipt persisted with exact fields
        const restoredReceipt = receiptStorage.getReceipt(deliveryKey)
        expect(restoredReceipt).toBeDefined()
        expect(restoredReceipt?.sessionId).toBe('session_prod_alpha')
        expect(restoredReceipt?.requestId).toBe(recordedRequestId)
        expect(restoredReceipt?.status).toBe('admitting')

        await ingressStorage.close()
        await receiptStorage.close()
      } finally {
        await ctx.fiber.dispose()
        await sqlite.close()
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  })

  it('R1 concurrency: serializes concurrent duplicate delivery without minting differing IDs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-r1-test-'))
    const dbPath = join(tempDir, 'dsh-r1.db')
    const { ctx, facility, sqlite } = await createStorageHarness(dbPath)

    try {
      const ingressDomain = await facility.open(ingressDomainSpec)
      const ingressStorage = new IngressStorage(ingressDomain)

      const input = {
        deliveryKey: 'delivery_concurrent_key_1',
        operatorId: 'op_carol',
        targetTenantId: 'tenant_gamma',
        prompt: 'Trigger build pipeline',
      }

      // Concurrently dispatch two duplicate delivery receptions
      const [first, second] = await Promise.all([
        ingressStorage.recordDeliveryReceived(input),
        ingressStorage.recordDeliveryReceived(input),
      ])

      expect(first.requestId).toBe(second.requestId)
      expect(first.deliveryKey).toBe(input.deliveryKey)

      const stored = ingressStorage.getDelivery(input.deliveryKey)
      expect(stored?.requestId).toBe(first.requestId)
      expect(stored?.retryCount).toBe(1)

      await ingressStorage.close()
    } finally {
      await ctx.fiber.dispose()
      await sqlite.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('R2 identity: duplicate keys reject operator/tenant/session/request conflicts', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-r2-test-'))
    const dbPath = join(tempDir, 'dsh-r2.db')
    const { ctx, facility, sqlite } = await createStorageHarness(dbPath)

    try {
      const ingressDomain = await facility.open(ingressDomainSpec)
      const receiptDomain = await facility.open(tenantReceiptDomainSpec)
      const ingressStorage = new IngressStorage(ingressDomain)
      const receiptStorage = new TenantReceiptStorage(receiptDomain)

      const deliveryKey = 'delivery_conflict_key_1'

      // 1. Ingress conflict: same deliveryKey but different operatorId
      await ingressStorage.recordDeliveryReceived({
        deliveryKey,
        operatorId: 'op_legit',
        targetTenantId: 'tenant_alpha',
        prompt: 'Check logs',
      })

      await expect(
        ingressStorage.recordDeliveryReceived({
          deliveryKey,
          operatorId: 'op_attacker',
          targetTenantId: 'tenant_alpha',
          prompt: 'Check logs',
        }),
      ).rejects.toThrow(/Conflicting delivery identity/)

      // 2. Tenant receipt conflict: same deliveryKey but different sessionId
      const reqId = mintImSessionRequestId()
      await receiptStorage.recordAdmitting({
        deliveryKey,
        sessionId: 'session_original',
        requestId: reqId,
        operatorId: 'op_legit',
      })

      await expect(
        receiptStorage.recordAdmitting({
          deliveryKey,
          sessionId: 'session_rogue',
          requestId: reqId,
          operatorId: 'op_legit',
        }),
      ).rejects.toThrow(/Conflicting receipt identity/)

      await ingressStorage.close()
      await receiptStorage.close()
    } finally {
      await ctx.fiber.dispose()
      await sqlite.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('guards outbox version, attempt counters, and refuses auto-retry on unknown status', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-outbox-guards-test-'))
    const dbPath = join(tempDir, 'dsh-outbox-guards.db')
    const { ctx, facility, sqlite } = await createStorageHarness(dbPath)

    try {
      const ingressDomain = await facility.open(ingressDomainSpec)
      const ingressStorage = new IngressStorage(ingressDomain)

      const deliveryKey = 'delivery_outbox_guard_1'
      await ingressStorage.recordDeliveryReceived({
        deliveryKey,
        operatorId: 'op_dan',
        targetTenantId: 'tenant_delta',
        prompt: 'Generate monthly report',
      })

      // 1. Prepare version 2 reply
      const prep = await ingressStorage.prepareOutboxReply(deliveryKey, 'Report ready: https://...', '2026-10-24T20:00:00Z')
      expect(prep.outboxVersion).toBe(2)

      // 2. Reject attempt with stale version 1
      await expect(
        ingressStorage.recordOutboxAttempt(deliveryKey, 1),
      ).rejects.toThrow(/Outbox version mismatch/)

      // 3. Valid attempt with version 2
      const att = await ingressStorage.recordOutboxAttempt(deliveryKey, 2)
      expect(att.outboxAttempts).toBe(1)
      expect(att.outboxStatus).toBe('in_flight')

      // 4. Second send while already in_flight is REJECTED
      await expect(
        ingressStorage.recordOutboxAttempt(deliveryKey, 2),
      ).rejects.toThrow(/Cannot start outbox attempt while an attempt is already in flight/)

      // 5. Stale ACK with wrong attempt counter is rejected
      await expect(
        ingressStorage.recordOutboxSuccess(deliveryKey, 2, 99, 'msg_stale_ack'),
      ).rejects.toThrow(/Outbox ACK transition rejected/)

      // 6. Fail attempt with indeterminate transport outcome -> 'unknown'
      const failed = await ingressStorage.recordOutboxFailure(deliveryKey, 2, 1, 'Socket hang up', true)
      expect(failed.outboxStatus).toBe('unknown')

      // 7. Automatic retry is REFUSED when outboxStatus is unknown
      await expect(
        ingressStorage.recordOutboxAttempt(deliveryKey, 2),
      ).rejects.toThrow(/Cannot automatically retry outbox in unknown status/)

      // 8. Preparing reply is REFUSED when outboxStatus is unknown
      await expect(
        ingressStorage.prepareOutboxReply(deliveryKey, 'Cannot bypass unknown'),
      ).rejects.toThrow(/Cannot prepare outbox reply while outbox status is unknown/)

      await ingressStorage.close()
    } finally {
      await ctx.fiber.dispose()
      await sqlite.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('fails loud with version-mismatch when attempting to open incompatible schema version', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-version-test-'))
    const dbPath = join(tempDir, 'dsh-version.db')

    // Write version 1 with normal spec
    {
      const { ctx, facility, sqlite } = await createStorageHarness(dbPath)
      try {
        const ingressDomain = await facility.open(ingressDomainSpec)
        await ingressDomain.close()
      } finally {
        await ctx.fiber.dispose()
        await sqlite.close()
      }
    }

    // Try opening same unit with incompatible version 99
    {
      const { ctx, facility, sqlite } = await createStorageHarness(dbPath)
      try {
        const incompatibleSpec = defineDomain({
          name: INGRESS_DOMAIN_NAME,
          version: 99,
          tables: {
            operators: domainTable(operatorBindingSchema),
            deliveries: domainTable(ingressDeliverySchema),
          },
        })

        await expect(facility.open(incompatibleSpec)).rejects.toMatchObject({
          code: 'version-mismatch',
        })
      } finally {
        await ctx.fiber.dispose()
        await sqlite.close()
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  })

  it('enforces single-open per domain name in DomainFacility', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-concurrency-test-'))
    const dbPath = join(tempDir, 'dsh-concurrency.db')
    const { ctx, facility, sqlite } = await createStorageHarness(dbPath)

    try {
      const first = await facility.open(ingressDomainSpec)
      await expect(facility.open(ingressDomainSpec)).rejects.toMatchObject({
        code: 'already-open',
      })
      await first.close()
    } finally {
      await ctx.fiber.dispose()
      await sqlite.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  describe('R4 Crash reconciliation against session log', () => {
    it('returns not_found when receipt is absent', () => {
      const result = reconcileDelivery(undefined, { id: 'session_1', events: [] })
      expect(result.state).toBe('not_found')
    })

    it('returns session_mismatch when querying against an unrelated session instance', () => {
      const requestId = mintImSessionRequestId()
      const receipt = {
        deliveryKey: 'key_1',
        sessionId: 'session_alpha',
        requestId,
        operatorId: 'op_1',
        status: 'admitted' as const,
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:01.000Z',
        resultText: null,
        error: null,
      }

      const result = reconcileDelivery(receipt, {
        id: 'session_different',
        events: [],
      })
      expect(result.state).toBe('session_mismatch')
      if (result.state === 'session_mismatch') {
        expect(result.receiptSessionId).toBe('session_alpha')
        expect(result.queriedSessionId).toBe('session_different')
      }
    })

    it('identifies admitted turn when user/message with source.kind=user and matching rpcId is logged', () => {
      const requestId = mintImSessionRequestId()
      const receipt = {
        deliveryKey: 'key_1',
        sessionId: 'session_alpha',
        requestId,
        operatorId: 'op_1',
        status: 'admitted' as const,
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:01.000Z',
        resultText: null,
        error: null,
      }

      const promptSource = createImPromptSource(requestId)
      const sessionEvents: SessionEvent[] = [
        {
          type: 'user/message',
          seq: 0 as SessionSeq,
          time: 1,
          surfaceOp: 'append',
          data: {
            id: brandString<MessageId>('msg_reconcile_1'),
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            source: promptSource,
          },
        },
      ]

      const session = { id: 'session_alpha', events: sessionEvents }
      const result = reconcileDelivery(receipt, session)
      expect(result.state).toBe('admitted')
      if (result.state === 'admitted') {
        expect(result.requestId).toBe(requestId)
        expect(result.sessionId).toBe('session_alpha')
      }
    })

    it('identifies completed turn with correlated turn/end and assistant resultText even if receipt crashed during admitting', () => {
      const requestId = mintImSessionRequestId()
      const receipt = {
        deliveryKey: 'key_crashed_after_turn',
        sessionId: 'session_alpha',
        requestId,
        operatorId: 'op_1',
        status: 'admitting' as const, // Process crashed after turn completed before receipt marked completed
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        resultText: null,
        error: null,
      }

      const promptSource = createImPromptSource(requestId)
      const sessionEvents: SessionEvent[] = [
        {
          type: 'user/message',
          seq: 0 as SessionSeq,
          time: 1,
          surfaceOp: 'append',
          data: {
            id: brandString<MessageId>('msg_reconcile_1'),
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            source: promptSource,
          },
        },
        {
          type: 'assistant/message',
          seq: 1 as SessionSeq,
          time: 2,
          surfaceOp: 'append',
          data: {
            turn: 1,
            step: 1,
            stream: [],
            message: {
              id: brandString<MessageId>('msg_asst_1'),
              role: 'assistant',
              source: { kind: 'model', provider: 'mock', model: 'mock' },
              content: [{ type: 'text', text: 'Build succeeded in 42s' }],
            },
          },
        },
        {
          type: 'turn/end',
          seq: 2 as SessionSeq,
          time: 3,
          data: {
            turn: 1,
            reason: { kind: 'completed' },
          },
        },
      ]

      const session = { id: 'session_alpha', events: sessionEvents }
      const result = reconcileDelivery(receipt, session)
      expect(result.state).toBe('completed')
      if (result.state === 'completed') {
        expect(result.resultText).toBe('Build succeeded in 42s')
        expect(result.requestId).toBe(requestId)
      }
    })

    it('maps actual turn/end reasons correctly: aborted to cancelled, error/blocked/max-tokens to failed, and interrupted/forked to unknown', () => {
      const requestId = mintImSessionRequestId()
      const promptSource = createImPromptSource(requestId)
      const baseReceipt = {
        deliveryKey: 'key_turn_reasons',
        sessionId: 'session_alpha',
        requestId,
        operatorId: 'op_1',
        status: 'admitted' as const,
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:01.000Z',
        resultText: null,
        error: null,
      }

      function createSessionWithReason(reason: SessionEvent<'turn/end'>['data']['reason']) {
        const events: SessionEvent[] = [
          {
            type: 'user/message',
            seq: 0 as SessionSeq,
            time: 1,
            surfaceOp: 'append',
            data: {
              id: brandString<MessageId>('msg_1'),
              role: 'user',
              content: [{ type: 'text', text: 'hello' }],
              source: promptSource,
            },
          },
          {
            type: 'turn/end',
            seq: 1 as SessionSeq,
            time: 2,
            data: { turn: 1, reason },
          },
        ]
        return { id: 'session_alpha', events: events }
      }

      // 1. aborted -> cancelled
      const abortedRes = reconcileDelivery(baseReceipt, createSessionWithReason({ kind: 'aborted', reason: { kind: 'user' } }))
      expect(abortedRes.state).toBe('cancelled')

      // 2. error -> failed
      const errorRes = reconcileDelivery(baseReceipt, createSessionWithReason({ kind: 'error', error: { code: 'UNKNOWN', message: 'model crashed' } }))
      expect(errorRes.state).toBe('failed')
      if (errorRes.state === 'failed') expect(errorRes.error).toBe('model crashed')

      // 3. blocked -> failed
      const blockedRes = reconcileDelivery(baseReceipt, createSessionWithReason({ kind: 'blocked' }))
      expect(blockedRes.state).toBe('failed')

      // 4. max-tokens -> failed
      const maxTokensRes = reconcileDelivery(baseReceipt, createSessionWithReason({ kind: 'max-tokens' }))
      expect(maxTokensRes.state).toBe('failed')

      // 5. interrupted (crash orphan) -> unknown
      const interruptedRes = reconcileDelivery(baseReceipt, createSessionWithReason({ kind: 'interrupted' }))
      expect(interruptedRes.state).toBe('unknown')

      // 6. forked -> unknown
      const forkedRes = reconcileDelivery(baseReceipt, createSessionWithReason({ kind: 'forked' }))
      expect(forkedRes.state).toBe('unknown')
    })

    it('marks unknown when receipt claims completed but session log is missing turn/end', () => {
      const requestId = mintImSessionRequestId()
      const receipt = {
        deliveryKey: 'key_diverged',
        sessionId: 'session_alpha',
        requestId,
        operatorId: 'op_1',
        status: 'completed' as const,
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:10.000Z',
        resultText: 'Orphaned result',
        error: null,
      }

      const promptSource = createImPromptSource(requestId)
      const sessionEvents: SessionEvent[] = [
        {
          type: 'user/message',
          seq: 0 as SessionSeq,
          time: 1,
          surfaceOp: 'append',
          data: {
            id: brandString<MessageId>('msg_reconcile_1'),
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            source: promptSource,
          },
        },
      ]

      const session = { id: 'session_alpha', events: sessionEvents }
      const result = reconcileDelivery(receipt, session)
      expect(result.state).toBe('unknown')
      if (result.state === 'unknown') {
        expect(result.reason).toContain('missing durable turn/end evidence')
      }
    })

    it('marks unknown when receipt is in admitting state but no session log record exists (crash window)', () => {
      const requestId = mintImSessionRequestId()
      const receipt = {
        deliveryKey: 'key_crashed',
        sessionId: 'session_crashed',
        requestId,
        operatorId: 'op_1',
        status: 'admitting' as const, // Pre-log admission crash
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        resultText: null,
        error: null,
      }

      // Empty session log (crashed before followup written)
      const session = { id: 'session_crashed', events: [] }

      const result = reconcileDelivery(receipt, session)
      expect(result.state).toBe('unknown')
      if (result.state === 'unknown') {
        expect(result.requestId).toBe(requestId)
        expect(result.reason).toContain('Receipt is in admitting state but session log does not contain user/message with matching rpcId')
      }
    })
  })
})


it('reopens a private DingTalk reply capability and a confirmed send without inventing a message ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-dingtalk-reply-'))
  const path = join(directory, 'ingress.sqlite')
  const deliveryKey = JSON.stringify(['dingtalk', 'app', 'corp', 'chat', 'sender', 'message'])
  const replyRoute = { kind: 'dingtalk-session-webhook' as const,
    url: 'https://oapi.dingtalk.com/robot/sendBySession?session=fixture-capability', expiresAt: Date.now() + 60000 }
  try {
    const first = await createStorageHarness(path)
    try {
      const store = new IngressStorage(await first.facility.open(ingressDomainSpec))
      await store.recordDeliveryReceived({ deliveryKey, operatorId: 'operator', targetTenantId: 'runtime', prompt: 'hello', replyRoute })
      await store.completeWithReply(deliveryKey, 'session', 'public reply')
      const record = store.getDelivery(deliveryKey)
      if (!record) throw new Error('Missing fixture delivery')
      const attempt = await store.recordOutboxAttempt(deliveryKey, record.outboxVersion)
      await store.recordOutboxSuccess(deliveryKey, attempt.outboxVersion, attempt.outboxAttempts, null)
    } finally { await first.ctx.fiber.dispose(); await first.sqlite.close() }
    const reopened = await createStorageHarness(path)
    try {
      const store = new IngressStorage(await reopened.facility.open(ingressDomainSpec))
      const restored = store.getDelivery(deliveryKey)
      expect(restored?.replyRoute).toEqual(replyRoute)
      expect(restored?.outboxStatus).toBe('sent')
      expect(restored?.outboxMessageId).toBeNull()
      await expect(store.recordOutboxAttempt(deliveryKey, restored?.outboxVersion ?? 0)).rejects.toThrow()
    } finally { await reopened.ctx.fiber.dispose(); await reopened.sqlite.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
