/** Cold evidence recovery over real Session logs, with failures at durable I/O seams. */
import { expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { DecisionStore, answerRequestId, digestOf } from '../src/store.ts'
import { decisionsDomain } from '../src/schema.ts'
import { systemDecisionClock } from '../src/clock.ts'
import type { DecisionRecord } from '../src/types.ts'
import { admissionHarness, ReplyAdapter, SESSION } from './admission-world.ts'
import { testLimits } from './harness.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'question-recovery-event': { kind: 'question-recovery-event' }
  }
}

type Scenario = 'ordinary' | 'entered' | 'unentered' | 'grouped' | 'legacy-closed' | 'legacy-cancelled' | 'admitted' | 'partial-stale'

async function recovery(scenario: Scenario, fault?: Error | string, readFault?: Error | string) {
  let saved: DecisionRecord | undefined
  const model = new ReplyAdapter()
  const h = await admissionHarness(scenario === 'partial-stale' ? { reconcileMaxEvents: 1 } : {}, { persistent: true, hold: false, model, async beforeService(ctx, agent) {
    const domain = await ctx.storageDomain.open(decisionsDomain)
    try {
      const store = new DecisionStore(domain, systemDecisionClock, testLimits())
      if (scenario === 'grouped') {
        const older = await store.create({ sessionId: SESSION, question: 'An older question', choices: [], contextAnchorSeq: 0 })
        await store.cancel(older.decisionId, older.revision)
      }
      saved = await store.create({ sessionId: SESSION, question: 'Which database?', choices: ['A', 'B'],
        ...(scenario.startsWith('legacy-') ? {} : { contextAnchorSeq: 0 }) })
      const rpcId = answerRequestId(saved.decisionId)
      if (scenario === 'entered' || scenario === 'unentered' || scenario === 'legacy-closed' || scenario === 'admitted') {
        await store.reserveAnswer(saved.decisionId, saved.revision, { requestId: rpcId, digest: digestOf({ choiceOrdinal: 1 }) })
      }
      if (scenario === 'legacy-closed') await store.supersede(saved.decisionId)
      if (scenario === 'legacy-cancelled') await store.cancel(saved.decisionId, 0)
      if (scenario === 'admitted') await store.markAdmitted(saved.decisionId)
      if (scenario === 'entered' || scenario === 'ordinary' || scenario === 'grouped' || scenario === 'partial-stale') {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: scenario === 'entered'
          ? `Answer to question ${saved.decisionId}: option 1` : 'A new automated context event' }],
        source: scenario === 'entered' ? { kind: 'user', rpcId } : { kind: 'question-recovery-event' } }))
        await agent.whenIdle()
      } else agent.session.append('model/selection', { provider: 'unit', model: 'unit' })
      await ctx.sessions.flush(agent.session)
    } finally { await domain.close() }
    if (readFault !== undefined) vi.spyOn(ctx.sessionPersistence, 'open').mockRejectedValueOnce(readFault)
    if (fault !== undefined) {
      const open = ctx.storageDomain.open.bind(ctx.storageDomain)
      vi.spyOn(ctx.storageDomain, 'open').mockImplementation(async (spec) => {
        const opened = await open(spec)
        if (spec.name === decisionsDomain.name) vi.spyOn(opened.table('decisions'), 'update').mockRejectedValueOnce(fault)
        return opened
      })
    }
  } })
  if (saved === undefined) throw new Error('question was not seeded')
  return { ...h, saved, model }
}

it('groups closed and open questions while treating nonhuman input as newer context', async () => {
  const h = await recovery('grouped')
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ lifecycle: 'superseded' })
  expect(await h.service.catalog(SESSION)).toHaveLength(2)
  expect(h.model.calls).toBe(1)
})

it.each([new Error('question storage unavailable'), 'question storage unavailable'])('closes admission after a failed boot supersession: %s', async (fault) => {
  const h = await recovery('ordinary', fault)
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ lifecycle: 'open' })
  expect(await h.service.submit(h.saved.decisionId, h.saved.revision, answerRequestId(h.saved.decisionId), { choiceOrdinal: 1 }))
    .toMatchObject({ outcome: 'reconciliation_required' })
  expect(h.model.calls).toBe(1)
})

it.each([new Error('question storage unavailable'), 'question storage unavailable'])('keeps the reservation after boot admission indexing fails: %s', async (fault) => {
  const h = await recovery('entered', fault)
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ answerIndex: 'submitting' })
  expect(await h.service.applyFacts(h.saved.decisionId, { entered: true })).toMatchObject({ answerIndex: 'admitted' })
  expect(h.model.calls).toBe(1)
})

it.each([new Error('question storage unavailable'), 'question storage unavailable'])('keeps the slot reserved when boot uncertainty indexing fails: %s', async (fault) => {
  const h = await recovery('unentered', fault)
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ answerIndex: 'submitting' })
  expect(h.model.calls).toBe(0)
})

it('marks a superseded legacy reservation unknown when no durable anchor can verify its answer', async () => {
  const h = await recovery('legacy-closed')
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ lifecycle: 'superseded', answerIndex: 'needs_reconciliation' })
})


it.each([new Error('Session read failed'), 'Session read failed'])('refuses answers when cold Session evidence cannot be read: %s', async (error) => {
  const h = await recovery('unentered', undefined, error)
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ answerIndex: 'needs_reconciliation' })
  expect(h.model.calls).toBe(0)
})

it.each([new Error('uncertain index failed'), 'uncertain index failed'])('contains a failed uncertainty write after an unreadable Session: %s', async (error) => {
  const h = await recovery('unentered', error, new Error('Session read failed'))
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ answerIndex: 'submitting' })
})

it('does not reopen a closed legacy question without Session evidence', async () => {
  const h = await recovery('legacy-cancelled')
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ lifecycle: 'cancelled' })
})

it('retains an already admitted index without replaying its human answer', async () => {
  const h = await recovery('admitted')
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ answerIndex: 'admitted' })
  expect(h.model.calls).toBe(0)
})

it('supersedes verified newer input even when the remaining Session scan exceeds its budget', async () => {
  const h = await recovery('partial-stale')
  expect(await h.service.get(h.saved.decisionId)).toMatchObject({ lifecycle: 'superseded' })
})
