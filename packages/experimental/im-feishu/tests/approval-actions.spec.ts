import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ApprovalActionStore, approvalActionDomain, type ApprovalActionRecord } from '../src/approval-actions.ts'
import { parseOperatorId, parseTargetTenantId } from '../src/types.ts'
import { createServiceFixture } from './service-fixture.ts'

const config = { maxRecords: 10, maxPending: 2, timeoutMs: 1000, maxSummaryBytes: 128 }
const actor = { provider: 'feishu' as const, appId: 'app', tenantId: 'organization', chatId: 'chat', senderId: 'sender' }
const input = { operatorId: parseOperatorId('operator-a'), targetTenantId: parseTargetTenantId('runtime-a'),
  sessionId: SessionId('session-a'), requestId: 'actual-approval-audit-id', callId: ToolCallId('actual-native-or-ptc-call'),
  toolName: 'sensitive-test-tool', actor, summary: 'Tool-owned bounded summary' }

async function fixture() {
  const f = await createServiceFixture()
  const domain = await f.facility.open(approvalActionDomain)
  return { ...f, domain, actions: new ApprovalActionStore(domain, config) }
}

describe('Durable approval action reservation', () => {
  it('consumes simultaneous duplicate clicks once through SQLite serialization', async () => {
    const f = await fixture()
    try {
      const record = await f.actions.create(input)
      const decisions = await Promise.allSettled(Array.from({ length: 8 }, () => f.actions.consume(record.id, actor, input, 'allow')))
      expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(decisions.filter(result => result.status === 'rejected')).toHaveLength(7)
      expect(f.domain.table('actions').get(record.id)).toMatchObject({ state: 'consumed', decision: 'allow' })
    } finally { await f.close() }
  })

  it('rejects foreign identities and mismatched live request while preserving the pending record', async () => {
    const f = await fixture()
    try {
      const record = await f.actions.create(input)
      for (const field of ['appId', 'tenantId', 'chatId', 'senderId'] as const) {
        await expect(f.actions.consume(record.id, { ...actor, [field]: 'foreign' }, input, 'allow')).rejects.toThrow('unavailable')
      }
      for (const update of [
        { sessionId: SessionId('other-session') }, { requestId: 'other-request' }, { callId: ToolCallId('other-subcall') },
        { operatorId: parseOperatorId('other-operator') }, { targetTenantId: parseTargetTenantId('other-runtime') }, { toolName: 'other-tool' },
      ]) {
        await expect(f.actions.consume(record.id, actor, { ...input, ...update }, 'allow')).rejects.toThrow('unavailable')
      }
      expect(f.domain.table('actions').get(record.id)?.state).toBe('pending')
      await f.actions.cancel(record.id)
      await expect(f.actions.consume(record.id, actor, input, 'allow')).rejects.toThrow('unavailable')
    } finally { await f.close() }
  })

  it('keeps rejection available when call arguments cannot be displayed', async () => {
    const f = await fixture()
    try {
      const unavailable = { ...input, callId: null, summary: null }
      const record = await f.actions.create(unavailable)
      await expect(f.actions.consume(record.id, actor, unavailable, 'allow')).rejects.toThrow('arguments are unavailable')
      expect((await f.actions.consume(record.id, actor, unavailable, 'reject')).decision).toBe('reject')
    } finally { await f.close() }
  })

  it('rejects records from a previous runtime epoch and recovers persisted state without replay', async () => {
    const f = await fixture()
    try {
      const record = await f.actions.create(input)
      await f.domain.close()
      const reopened = await f.facility.open(approvalActionDomain)
      const successor = new ApprovalActionStore(reopened, config)
      expect(reopened.table('actions').get(record.id)?.state).toBe('pending')
      await expect(successor.consume(record.id, actor, input, 'allow')).rejects.toThrow('unavailable')
    } finally { await f.close() }
  })

  it('rejects expired actions and prunes them without applying a decision', async () => {
    const f = await fixture()
    try {
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const record = await f.actions.create(input)
      vi.spyOn(Date, 'now').mockReturnValue(now + 1001)
      await expect(f.actions.consume(record.id, actor, input, 'allow')).rejects.toThrow('unavailable')
      expect(await f.actions.pruneExpired()).toBe(1)
      expect(f.domain.table('actions').get(record.id)).toBeUndefined()
    } finally { vi.restoreAllMocks(); await f.close() }
  })

  it('bounds concurrent creation and summary bytes before writing', async () => {
    const f = await fixture()
    try {
      const restricted = new ApprovalActionStore(f.domain, { ...config, maxPending: 1 })
      const results = await Promise.allSettled([restricted.create(input), restricted.create(input)])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const accepted = results.find(result => result.status === 'fulfilled')
      if (accepted?.status !== 'fulfilled') throw new Error('No created action')
      await restricted.cancel(accepted.value.id)
      const large: Pick<ApprovalActionRecord, keyof typeof input> = { ...input, summary: '汉'.repeat(100) }
      await expect(restricted.create(large)).rejects.toThrow('byte limit')
    } finally { await f.close() }
  })
})
