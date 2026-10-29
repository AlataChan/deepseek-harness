/** Real user-questions requests use durable actor-bound single-use answers. */
import { describe, expect, it, vi } from 'vitest'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import { createServiceFixture } from './service-fixture.ts'
import { mintImSessionRequestId } from '../src/source.ts'
import { TenantQuestionBroker, questionActionDomain } from '../src/question-broker.ts'

describe('Tenant question answerer', () => {
  it.each(['answer', 'duplicate', 'foreign', 'cancel', 'invalid-options', 'revoked', 'storage-failure'] as const)('settles a live question for %s', async (control) => {
    const f = await createServiceFixture()
    let broker: TenantQuestionBroker | undefined
    try {
      await f.ctx.plugin(UserQuestions)
      const agent = await f.provider.getOrCreateAgent('conversation', f.operatorId, new AbortController().signal)
      const key = JSON.stringify(['feishu', 'app', 'org', 'chat', 'sender', 'event'])
      const receipt = await f.receipts.recordAdmitting({ deliveryKey: key, sessionId: agent.session.id,
        requestId: mintImSessionRequestId(), operatorId: f.operatorId })
      let revoked = false
      const domain = await f.facility.open(questionActionDomain)
      broker = new TenantQuestionBroker(f.ctx, domain, {
        maxRecords: 10, maxPending: 2, timeoutMs: 1000, maxQuestionBytes: 1000, maxAnswerBytes: 500, maxItems: 2, maxOptions: 3,
      }, target => target === agent && !revoked ? receipt : undefined)
      const signal = new AbortController()
      const pending = f.ctx.userQuestions.ask({ agent, signal: signal.signal,
        questions: [{ id: 'choice', question: 'Choose a fixture', options: [{ label: 'A' }, { label: 'B' }] }] })
      const result = pending.then(answer => ({ answer }), (error: unknown) => ({ error }))
      await vi.waitFor(() => { expect(broker?.list(key, f.operatorId)).toHaveLength(1) })
      const card = broker.list(key, f.operatorId)[0]
      if (!card) throw new Error('Missing live question card')
      const actor = { provider: 'feishu' as const, appId: 'app', tenantId: 'org', chatId: 'chat', senderId: 'sender' }
      const answer = { answers: [{ id: 'choice', selected: [control === 'invalid-options' ? 'INVENTED' : 'A'] }] }
      if (control === 'cancel') signal.abort()
      if (control === 'revoked') revoked = true
      if (control === 'storage-failure') {
        const fault = vi.spyOn(domain.table('actions'), 'update').mockRejectedValueOnce(new Error('disk unavailable'))
        await expect(broker.answer(card.actionId, actor, f.operatorId, answer)).rejects.toThrow('disk unavailable')
        fault.mockRestore()
        signal.abort()
        await expect(result).resolves.toHaveProperty('error')
        return
      }
      const accepted = await broker.answer(card.actionId,
        control === 'foreign' ? { ...actor, senderId: 'other' } : actor, f.operatorId, answer)
      expect(accepted).toBe(control === 'answer' || control === 'duplicate')
      if (!accepted) signal.abort()
      const settled = await result
      if (accepted) expect(settled).toEqual({ answer })
      else expect(settled).toHaveProperty('error')
      expect(await broker.answer(card.actionId, actor, f.operatorId, answer)).toBe(false)
    } finally { await broker?.close(); await f.close() }
  })
})
